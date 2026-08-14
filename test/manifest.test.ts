import { InterpolationError, interpolate } from '../src/lib/interpolate';
import { loadManifest } from '../src/lib/manifest';
import { resolveManifest } from '../src/lib/resolve';
import { validateManifest } from '../src/lib/validate';
import { cleanup, scheduledManifest, serviceManifest, writeManifest } from './helpers';

afterAll(cleanup);

function resolve(manifest: Record<string, any>) {
  return resolveManifest(validateManifest(manifest, 'test'));
}

describe('interpolate', () => {
  it('expands ${VAR} from the environment', () => {
    expect(interpolate({ a: 'x-${FOO}-y' }, { FOO: 'bar' })).toEqual({ a: 'x-bar-y' });
  });

  it('expands object keys as well as values', () => {
    expect(interpolate({ '${K}_URL': 'v' }, { K: 'API' })).toEqual({ API_URL: 'v' });
  });

  it('uses the :- default when a variable is unset or empty', () => {
    expect(interpolate({ a: '${NOPE:-fallback}' }, {})).toEqual({ a: 'fallback' });
    expect(interpolate({ a: '${EMPTY:-fallback}' }, { EMPTY: '' })).toEqual({ a: 'fallback' });
  });

  it('throws listing every missing variable rather than substituting empty strings', () => {
    expect(() => interpolate({ a: '${ONE}', b: ['${TWO}'] }, {})).toThrow(InterpolationError);
    try {
      interpolate({ a: '${ONE}', b: ['${TWO}'] }, {});
    } catch (error) {
      expect((error as InterpolationError).variables).toEqual(['ONE', 'TWO']);
    }
  });

  it('treats $$ as a literal dollar sign', () => {
    expect(interpolate({ a: '$${NOT_A_VAR}' }, {})).toEqual({ a: '${NOT_A_VAR}' });
  });

  it('leaves non-strings alone', () => {
    expect(interpolate({ n: 8080, b: true, z: null }, {})).toEqual({ n: 8080, b: true, z: null });
  });
});

describe('loadManifest', () => {
  it('reads YAML', () => {
    const config = loadManifest(writeManifest(serviceManifest(), 'prod.yaml'));
    expect(config.name).toBe('test-api');
  });

  it('reads JSON', () => {
    const config = loadManifest(writeManifest(serviceManifest(), 'prod.json'));
    expect(config.name).toBe('test-api');
  });

  it('infers the extension when the path has none', () => {
    const file = writeManifest(serviceManifest(), 'prod.yaml');
    const config = loadManifest(file.replace(/\.yaml$/, ''));
    expect(config.name).toBe('test-api');
  });

  it('expands ${VAR} before validating', () => {
    const file = writeManifest(serviceManifest({ name: '${APP}-prod' } as any));
    expect(loadManifest(file, { env: { APP: 'billing' } }).name).toBe('billing-prod');
  });

  it('reports a missing file with the paths it tried', () => {
    expect(() => loadManifest('/tmp/definitely-not-here/prod')).toThrow(/Manifest not found/);
  });
});

describe('resolveManifest — defaults', () => {
  it('defaults the stack name to the manifest name', () => {
    expect(resolve(serviceManifest()).stackName).toBe('test-api');
  });

  it('defaults the log group to /ecs/<name> with 30 day retention', () => {
    const config = resolve(serviceManifest());
    expect(config.task.logGroupName).toBe('/ecs/test-api');
    expect(config.task.logRetentionDays).toBe(30);
    expect(config.task.retainLogsOnDelete).toBe(true);
  });

  it('defaults an empty security group list, meaning "create one"', () => {
    expect(resolve(serviceManifest()).network.securityGroups).toEqual([]);
  });

  it('leaves role ARNs undefined, meaning "create them"', () => {
    const config = resolve(serviceManifest());
    expect(config.roles.executionRoleArn).toBeUndefined();
    expect(config.roles.taskRoleArn).toBeUndefined();
  });

  it('defaults the target port to the container port', () => {
    const config = resolve(serviceManifest());
    expect(config.kind === 'Service' && config.loadBalancer?.targetPort).toBe(8080);
  });

  it('normalises a single host header into a list', () => {
    const config = resolve(serviceManifest());
    expect(config.kind === 'Service' && config.loadBalancer?.hostHeaders).toEqual([
      'test.example.com',
    ]);
  });

  it('omits the load balancer entirely when the block is absent', () => {
    const m = serviceManifest();
    delete m.loadBalancer;
    const config = resolve(m);
    expect(config.kind === 'Service' && config.loadBalancer).toBeUndefined();
  });

  it('omits auto scaling entirely when the block is absent', () => {
    const config = resolve(serviceManifest());
    expect(config.kind === 'Service' && config.autoScaling).toBeUndefined();
  });

  it('derives a stable listener priority from the name', () => {
    const first = resolve(serviceManifest());
    const second = resolve(serviceManifest());
    const other = resolve(serviceManifest({ name: 'different-api' } as any));
    const priority = (c: any) => c.loadBalancer.priority;
    expect(priority(first)).toBe(priority(second));
    expect(priority(first)).not.toBe(priority(other));
    expect(priority(first)).toBeGreaterThanOrEqual(1);
    expect(priority(first)).toBeLessThanOrEqual(50000);
  });

  it('clamps the scaling minimum to the desired count', () => {
    const config = resolve(
      serviceManifest({
        service: { desiredCount: 1 },
        autoScaling: { maxCapacity: 4, cpuTargetPercent: 70 },
      } as any),
    );
    expect(config.kind === 'Service' && config.autoScaling?.minCapacity).toBe(1);
  });
});

describe('resolveManifest — scheduled tasks', () => {
  const config = resolve(
    scheduledManifest({
      task: { cpu: 256, memory: 512, environment: { SHARED: 'yes' }, command: ['node', 'app.js'] },
      tasks: [
        { name: 'a', schedule: 'rate(1 hour)' },
        {
          name: 'b',
          schedule: 'cron(0 3 * * ? *)',
          cpu: 1024,
          memory: 2048,
          environment: { EXTRA: 'true' },
          enabled: false,
        },
      ],
    } as any),
  ) as any;

  it('defaults enabled to true and honours an explicit false', () => {
    expect(config.tasks[0].enabled).toBe(true);
    expect(config.tasks[1].enabled).toBe(false);
  });

  it('inherits cpu, memory and command from the task block', () => {
    expect(config.tasks[0].cpu).toBe(256);
    expect(config.tasks[0].memory).toBe(512);
    expect(config.tasks[0].command).toEqual(['node', 'app.js']);
  });

  it('applies per-task overrides over the shared values', () => {
    expect(config.tasks[1].cpu).toBe(1024);
    expect(config.tasks[1].memory).toBe(2048);
  });

  it('merges per-task environment over the shared environment', () => {
    expect(config.tasks[0].environment).toEqual({ SHARED: 'yes' });
    expect(config.tasks[1].environment).toEqual({ SHARED: 'yes', EXTRA: 'true' });
  });

  it('defaults retryAttempts to 0', () => {
    expect(config.tasks[0].retryAttempts).toBe(0);
  });
});
