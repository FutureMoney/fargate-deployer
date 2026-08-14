import { ManifestError } from '../src/lib/errors';
import { validateManifest } from '../src/lib/validate';
import { scheduledManifest, serviceManifest } from './helpers';

/** Validate and return the issue paths, so tests assert on *which* field failed. */
function issuePaths(manifest: unknown): string[] {
  try {
    validateManifest(manifest, 'test');
    return [];
  } catch (error) {
    if (error instanceof ManifestError) {
      return error.issues.map((i) => i.path);
    }
    throw error;
  }
}

describe('validateManifest', () => {
  it('accepts a minimal service manifest', () => {
    expect(issuePaths(serviceManifest())).toEqual([]);
  });

  it('accepts a minimal scheduled-tasks manifest', () => {
    expect(issuePaths(scheduledManifest())).toEqual([]);
  });

  it('reports every problem at once rather than the first', () => {
    const paths = issuePaths({ kind: 'Nope', name: 'Bad Name' });
    expect(paths).toEqual(
      expect.arrayContaining(['kind', 'name', 'account', 'region', 'cluster', 'network', 'task']),
    );
  });

  describe('identity', () => {
    it('rejects an uppercase or spaced name', () => {
      expect(issuePaths(serviceManifest({ name: 'My Service' } as any))).toContain('name');
    });

    it('rejects an account ID that is not 12 digits', () => {
      expect(issuePaths(serviceManifest({ account: '1234' } as any))).toContain('account');
    });

    it('rejects an account ID given as a number', () => {
      expect(issuePaths(serviceManifest({ account: 111122223333 } as any))).toContain('account');
    });
  });

  describe('Fargate task sizes', () => {
    it('rejects a CPU value Fargate does not offer', () => {
      const m = serviceManifest();
      m.task.cpu = 300;
      expect(issuePaths(m)).toContain('task.cpu');
    });

    it('rejects memory outside the range allowed for the CPU', () => {
      const m = serviceManifest();
      m.task = { cpu: 256, memory: 8192, containerPort: 8080 };
      expect(issuePaths(m)).toContain('task.memory');
    });

    it('rejects memory that is not a multiple of the step', () => {
      const m = serviceManifest();
      m.task = { cpu: 512, memory: 1500, containerPort: 8080 };
      expect(issuePaths(m)).toContain('task.memory');
    });

    it('accepts each documented cpu/memory pair', () => {
      for (const [cpu, memory] of [
        [256, 512],
        [512, 1024],
        [1024, 8192],
        [4096, 30720],
        [16384, 122880],
      ]) {
        const m = serviceManifest();
        m.task = { cpu, memory, containerPort: 8080 };
        expect(issuePaths(m)).toEqual([]);
      }
    });
  });

  describe('load balancer', () => {
    it('requires a listener or load balancer ARN', () => {
      const m = serviceManifest();
      delete m.loadBalancer.listenerArn;
      expect(issuePaths(m)).toContain('loadBalancer');
    });

    it('requires a certificate when creating an HTTPS listener', () => {
      const m = serviceManifest();
      m.loadBalancer = {
        loadBalancerArn:
          'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/alb/1234567890abcdef',
        securityGroupId: 'sg-0abc123def4567890',
        hostHeaders: 'test.example.com',
      };
      expect(issuePaths(m)).toContain('loadBalancer.certificateArn');
    });

    it('does not require a certificate for an HTTP listener', () => {
      const m = serviceManifest();
      m.loadBalancer = {
        loadBalancerArn:
          'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/alb/1234567890abcdef',
        securityGroupId: 'sg-0abc123def4567890',
        listenerProtocol: 'HTTP',
        listenerPort: 80,
        hostHeaders: 'test.example.com',
      };
      expect(issuePaths(m)).toEqual([]);
    });

    it('does not require a certificate when attaching to an existing listener', () => {
      expect(issuePaths(serviceManifest())).toEqual([]);
    });

    it('requires a routing condition unless the service is the listener default', () => {
      const m = serviceManifest();
      delete m.loadBalancer.hostHeaders;
      expect(issuePaths(m)).toContain('loadBalancer.hostHeaders');
    });

    it('accepts defaultAction with no conditions', () => {
      const m = serviceManifest();
      delete m.loadBalancer.hostHeaders;
      m.loadBalancer.defaultAction = true;
      expect(issuePaths(m)).toEqual([]);
    });

    it('rejects defaultAction combined with conditions', () => {
      const m = serviceManifest();
      m.loadBalancer.defaultAction = true;
      expect(issuePaths(m)).toContain('loadBalancer.defaultAction');
    });

    it('requires the ALB security group unless rule management is turned off', () => {
      const m = serviceManifest();
      delete m.loadBalancer.securityGroupId;
      expect(issuePaths(m)).toContain('loadBalancer.securityGroupId');

      m.loadBalancer.manageSecurityGroupRules = false;
      expect(issuePaths(m)).toEqual([]);
    });

    it('rejects a health check timeout that is not shorter than the interval', () => {
      const m = serviceManifest();
      m.loadBalancer.healthCheck = { intervalSeconds: 10, timeoutSeconds: 10 };
      expect(issuePaths(m)).toContain('loadBalancer.healthCheck.timeoutSeconds');
    });

    it('requires a container port for a load-balanced service', () => {
      const m = serviceManifest();
      delete m.task.containerPort;
      expect(issuePaths(m)).toContain('task.containerPort');
    });

    it('accepts a service with no load balancer and no container port', () => {
      const m = serviceManifest();
      delete m.loadBalancer;
      delete m.task.containerPort;
      expect(issuePaths(m)).toEqual([]);
    });
  });

  describe('auto scaling', () => {
    it('requires maxCapacity', () => {
      const m = serviceManifest({ autoScaling: { cpuTargetPercent: 70 } } as any);
      expect(issuePaths(m)).toContain('autoScaling.maxCapacity');
    });

    it('requires at least one scaling target', () => {
      const m = serviceManifest({ autoScaling: { maxCapacity: 4 } } as any);
      expect(issuePaths(m)).toContain('autoScaling');
    });

    it('rejects a minimum above the maximum', () => {
      const m = serviceManifest({
        autoScaling: { minCapacity: 10, maxCapacity: 4, cpuTargetPercent: 70 },
      } as any);
      expect(issuePaths(m)).toContain('autoScaling.minCapacity');
    });

    it('rejects request scaling without a load balancer', () => {
      const m = serviceManifest({ autoScaling: { maxCapacity: 4, requestsPerTarget: 100 } } as any);
      delete m.loadBalancer;
      expect(issuePaths(m)).toContain('autoScaling.requestsPerTarget');
    });
  });

  describe('secrets', () => {
    it('accepts Secrets Manager and SSM ARNs', () => {
      const m = serviceManifest();
      m.task.secrets = {
        A: 'arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf',
        B: 'arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf:password::',
        C: 'arn:aws:ssm:us-east-1:111122223333:parameter/prod/key',
      };
      expect(issuePaths(m)).toEqual([]);
    });

    it('rejects a plain secret name', () => {
      const m = serviceManifest();
      m.task.secrets = { A: 'prod/db' };
      expect(issuePaths(m)).toContain('task.secrets.A');
    });
  });

  describe('environment maps', () => {
    it('rejects a non-string value and says to quote it', () => {
      const m = serviceManifest();
      m.task.environment = { PORT: 8080 };
      const error = (() => {
        try {
          validateManifest(m, 'test');
        } catch (e) {
          return e as ManifestError;
        }
        throw new Error('expected a validation error');
      })();
      expect(error.issues[0].path).toBe('task.environment.PORT');
      expect(error.issues[0].hint).toContain('Quote it');
    });
  });

  describe('scheduled tasks', () => {
    it('requires at least one job', () => {
      expect(issuePaths(scheduledManifest({ tasks: [] } as any))).toContain('tasks');
    });

    it('rejects a schedule that is not cron or rate', () => {
      const m = scheduledManifest({ tasks: [{ name: 'a', schedule: '0 6 * * *' }] } as any);
      expect(issuePaths(m)).toContain('tasks[0].schedule');
    });

    it('rejects duplicate job names', () => {
      const m = scheduledManifest({
        tasks: [
          { name: 'a', schedule: 'rate(1 hour)' },
          { name: 'a', schedule: 'rate(2 hours)' },
        ],
      } as any);
      expect(issuePaths(m)).toContain('tasks[1].name');
    });

    it('validates per-task cpu/memory overrides against Fargate sizes', () => {
      const m = scheduledManifest({
        tasks: [{ name: 'a', schedule: 'rate(1 hour)', cpu: 256, memory: 30720 }],
      } as any);
      expect(issuePaths(m)).toContain('tasks[0].memory');
    });
  });

  describe('kind mismatches', () => {
    it('rejects tasks on a Service', () => {
      const m = serviceManifest({ tasks: [{ name: 'a', schedule: 'rate(1 hour)' }] } as any);
      expect(issuePaths(m)).toContain('tasks');
    });

    it('rejects loadBalancer on ScheduledTasks', () => {
      const m = scheduledManifest({ loadBalancer: { listenerArn: 'arn:aws:elasticloadbalancing:x' } } as any);
      expect(issuePaths(m)).toContain('loadBalancer');
    });
  });
});
