import { formatFacts, inspectFacts } from '../src/lib/inspect';
import { loadManifest } from '../src/lib/manifest';
import { cleanup, scheduledManifest, serviceManifest, writeManifest } from './helpers';

/**
 * `inspect` is the contract between the CLI and the GitHub Action — the action
 * appends its output straight to $GITHUB_OUTPUT. A renamed or dropped key breaks
 * the action silently, so the keys are asserted here rather than just the values.
 *
 * Deliberately imports the source rather than running `dist/bin/cli.js`: the test
 * job runs before the build, so a test that shells out to the built CLI fails on
 * a clean checkout.
 */
function inspect(manifest: unknown): Record<string, string> {
  return inspectFacts(loadManifest(writeManifest(manifest)));
}

afterEach(cleanup);

describe('inspectFacts', () => {
  it('emits the keys the action consumes', () => {
    expect(Object.keys(inspect(serviceManifest()))).toEqual(
      expect.arrayContaining([
        'kind',
        'name',
        'stack-name',
        'account',
        'region',
        'cluster',
        'log-group',
        'architecture',
      ]),
    );
  });

  it('reports the build platform for the manifest architecture', () => {
    expect(inspect(serviceManifest())['architecture']).toBe('linux/amd64');
    const arm = serviceManifest();
    arm.task.runtimePlatform = { cpuArchitecture: 'ARM64' };
    expect(inspect(arm)['architecture']).toBe('linux/arm64');
  });

  it('derives the load balancer ARN from the listener ARN', () => {
    expect(inspect(serviceManifest())['load-balancer-arn']).toBe(
      'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/alb/1234567890abcdef',
    );
  });

  it('prefers an explicit loadBalancerArn over deriving one', () => {
    const manifest = serviceManifest();
    manifest.loadBalancer = {
      loadBalancerArn:
        'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/other/9999888877776666',
      certificateArn: 'arn:aws:acm:us-east-1:111122223333:certificate/abc',
      securityGroupId: 'sg-0abc123def4567890',
      hostHeaders: 'test.example.com',
    };
    expect(inspect(manifest)['load-balancer-arn']).toContain('other/9999888877776666');
  });

  it('joins multiple host headers with commas', () => {
    const manifest = serviceManifest();
    manifest.loadBalancer.hostHeaders = ['a.example.com', 'b.example.com'];
    expect(inspect(manifest)['host-headers']).toBe('a.example.com,b.example.com');
  });

  it('omits host-headers when the service is the listener default action', () => {
    const manifest = serviceManifest();
    delete manifest.loadBalancer.hostHeaders;
    manifest.loadBalancer.defaultAction = true;
    const facts = inspect(manifest);
    expect(facts['load-balancer-arn']).toBeDefined();
    expect(facts['host-headers']).toBeUndefined();
  });

  it('omits both for a service with no load balancer', () => {
    const manifest = serviceManifest();
    delete manifest.loadBalancer;
    const facts = inspect(manifest);
    expect(facts['load-balancer-arn']).toBeUndefined();
    expect(facts['host-headers']).toBeUndefined();
  });

  it('omits both for scheduled tasks', () => {
    const facts = inspect(scheduledManifest());
    expect(facts['load-balancer-arn']).toBeUndefined();
    expect(facts['host-headers']).toBeUndefined();
  });
});

describe('formatFacts', () => {
  it('renders key=value lines for $GITHUB_OUTPUT', () => {
    const lines = formatFacts({ kind: 'Service', region: 'us-east-1' }).split('\n');
    expect(lines).toEqual(['kind=Service', 'region=us-east-1']);
  });

  it('leaves a value containing = intact, splitting only on the first', () => {
    const [line] = formatFacts({ 'host-headers': 'a.example.com' }).split('\n');
    expect(line).toBe('host-headers=a.example.com');
  });
});
