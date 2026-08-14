import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';
import { Manifest } from '../src/lib/types';

export const EXAMPLES_DIR = path.join(__dirname, '..', 'examples');

/** A valid Service manifest, for tests that mutate one field at a time. */
export function serviceManifest(overrides: Partial<Manifest> = {}): Record<string, any> {
  return {
    kind: 'Service',
    name: 'test-api',
    account: '111122223333',
    region: 'us-east-1',
    cluster: { name: 'test-cluster' },
    network: {
      vpcId: 'vpc-0abc123def4567890',
      subnets: ['subnet-0abc123def4567890', 'subnet-0fed987cba6543210'],
    },
    task: { cpu: 256, memory: 512, containerPort: 8080 },
    loadBalancer: {
      listenerArn:
        'arn:aws:elasticloadbalancing:us-east-1:111122223333:listener/app/alb/1234567890abcdef/abcdef1234567890',
      securityGroupId: 'sg-0abc123def4567890',
      hostHeaders: 'test.example.com',
    },
    ...overrides,
  };
}

/** A valid ScheduledTasks manifest. */
export function scheduledManifest(overrides: Partial<Manifest> = {}): Record<string, any> {
  return {
    kind: 'ScheduledTasks',
    name: 'test-jobs',
    account: '111122223333',
    region: 'us-east-1',
    cluster: { name: 'test-cluster' },
    network: {
      vpcId: 'vpc-0abc123def4567890',
      subnets: ['subnet-0abc123def4567890'],
    },
    task: { cpu: 256, memory: 512 },
    tasks: [{ name: 'nightly', schedule: 'cron(0 6 * * ? *)' }],
    ...overrides,
  };
}

/** Write a manifest to a temp file and return its path. Cleaned up by `cleanup()`. */
const tempDirs: string[] = [];

export function writeManifest(manifest: unknown, filename = 'manifest.yaml'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fargate-deployer-'));
  tempDirs.push(dir);
  const file = path.join(dir, filename);
  fs.writeFileSync(file, filename.endsWith('.json') ? JSON.stringify(manifest) : stringify(manifest));
  return file;
}

export function cleanup(): void {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
