import { execFileSync } from 'child_process';
import * as path from 'path';
import { cleanup, scheduledManifest, serviceManifest, writeManifest } from './helpers';

/**
 * `inspect` is the contract between the CLI and the GitHub Action — the action
 * appends its output straight to $GITHUB_OUTPUT. A renamed or dropped key breaks
 * the action silently, so the keys are asserted here rather than just the values.
 */
const CLI = path.join(__dirname, '..', 'dist', 'bin', 'cli.js');

function inspect(manifest: unknown): Record<string, string> {
  const file = writeManifest(manifest);
  const stdout = execFileSync(process.execPath, [CLI, 'inspect', '--manifest', file], {
    encoding: 'utf-8',
  });
  return Object.fromEntries(
    stdout
      .trim()
      .split('\n')
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

afterEach(cleanup);

describe('inspect', () => {
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

  it('derives the load balancer ARN from the listener ARN', () => {
    expect(inspect(serviceManifest())['load-balancer-arn']).toBe(
      'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/alb/1234567890abcdef',
    );
  });

  it('prefers an explicit loadBalancerArn over deriving one', () => {
    const manifest = serviceManifest({
      loadBalancer: {
        loadBalancerArn:
          'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/other/9999888877776666',
        certificateArn: 'arn:aws:acm:us-east-1:111122223333:certificate/abc',
        securityGroupId: 'sg-0abc123def4567890',
        hostHeaders: 'test.example.com',
      },
    } as any);
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
