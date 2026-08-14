import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as fs from 'fs';
import * as path from 'path';
import { createStack } from '../src/lib/app';
import { loadManifest } from '../src/lib/manifest';
import { resolveManifest } from '../src/lib/resolve';
import { validateManifest } from '../src/lib/validate';
import { EXAMPLES_DIR, cleanup, scheduledManifest, serviceManifest } from './helpers';

const IMAGE = '111122223333.dkr.ecr.us-east-1.amazonaws.com/test-api:abc123';

afterAll(cleanup);

/**
 * Synthesize a manifest to a CloudFormation template.
 *
 * VPC lookups return CDK's dummy values in a unit test — enough to assert on
 * every resource this stack creates, since none of them depend on the real
 * subnet layout.
 */
function synth(manifest: Record<string, any>, image = IMAGE): Template {
  const app = new cdk.App();
  const stack = createStack({
    app,
    config: resolveManifest(validateManifest(manifest, 'test')),
    image,
  });
  return Template.fromStack(stack);
}

describe('FargateServiceStack', () => {
  const template = synth(serviceManifest());

  it('creates one Fargate service with the manifest name', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'test-api',
      LaunchType: 'FARGATE',
      DesiredCount: 1,
    });
  });

  it('enables the deployment circuit breaker with rollback by default', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it('creates a task definition with the requested size and image', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '256',
      Memory: '512',
      RequiresCompatibilities: ['FARGATE'],
      NetworkMode: 'awsvpc',
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ Name: 'test-api', PortMappings: [{ ContainerPort: 8080, Protocol: 'tcp' }] }),
      ]),
    });
  });

  it('creates a log group with the default name and retention', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/ecs/test-api',
      RetentionInDays: 30,
    });
  });

  it('creates a target group with an IP target type and health check', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Name: 'test-api',
      Port: 8080,
      Protocol: 'HTTP',
      TargetType: 'ip',
      HealthCheckPath: '/',
      Matcher: { HttpCode: '200' },
    });
  });

  it('adds a host-header listener rule rather than touching the listener default', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Conditions: [{ Field: 'host-header', HostHeaderConfig: { Values: ['test.example.com'] } }],
    });
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 0);
  });

  it('opens the task security group to the load balancer on the target port', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      FromPort: 8080,
      ToPort: 8080,
      SourceSecurityGroupId: 'sg-0abc123def4567890',
    });
  });

  it('creates a security group and both IAM roles when none are given', () => {
    template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
    template.resourceCountIs('AWS::IAM::Role', 2);
  });

  it('adds no scaling resources when auto scaling is absent', () => {
    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 0);
  });
});

describe('FargateServiceStack — supplied infrastructure', () => {
  const template = synth(
    serviceManifest({
      network: {
        vpcId: 'vpc-0abc123def4567890',
        subnets: ['subnet-0abc123def4567890'],
        securityGroups: ['sg-0999999999999999a'],
      },
      roles: {
        executionRoleArn: 'arn:aws:iam::111122223333:role/exec',
        taskRoleArn: 'arn:aws:iam::111122223333:role/task',
      },
    } as any),
  );

  it('creates no security group when one is supplied', () => {
    template.resourceCountIs('AWS::EC2::SecurityGroup', 0);
  });

  it('creates no IAM roles when both are supplied', () => {
    template.resourceCountIs('AWS::IAM::Role', 0);
  });

  it('references the supplied roles on the task definition', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ExecutionRoleArn: 'arn:aws:iam::111122223333:role/exec',
      TaskRoleArn: 'arn:aws:iam::111122223333:role/task',
    });
  });
});

describe('FargateServiceStack — no load balancer', () => {
  const manifest = serviceManifest({
    autoScaling: { maxCapacity: 5, cpuTargetPercent: 60 },
  } as any);
  delete manifest.loadBalancer;
  delete manifest.task.containerPort;
  const template = synth(manifest);

  it('creates no target group, rule or ingress', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 0);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 0);
    template.resourceCountIs('AWS::EC2::SecurityGroupIngress', 0);
  });

  it('still scales on CPU', () => {
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: 1,
      MaxCapacity: 5,
    });
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
      TargetTrackingScalingPolicyConfiguration: Match.objectLike({
        TargetValue: 60,
        PredefinedMetricSpecification: { PredefinedMetricType: 'ECSServiceAverageCPUUtilization' },
      }),
    });
  });
});

describe('FargateServiceStack — creating a listener', () => {
  const template = synth(
    serviceManifest({
      loadBalancer: {
        loadBalancerArn:
          'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/alb/1234567890abcdef',
        securityGroupId: 'sg-0abc123def4567890',
        certificateArn: 'arn:aws:acm:us-east-1:111122223333:certificate/abc-123',
        hostHeaders: 'test.example.com',
      },
    } as any),
  );

  it('creates an HTTPS listener with the certificate and a 404 default', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
      Certificates: [{ CertificateArn: 'arn:aws:acm:us-east-1:111122223333:certificate/abc-123' }],
      DefaultActions: [
        Match.objectLike({ Type: 'fixed-response', FixedResponseConfig: Match.objectLike({ StatusCode: '404' }) }),
      ],
    });
  });
});

describe('FargateServiceStack — all three scaling policies', () => {
  const template = synth(
    serviceManifest({
      service: { desiredCount: 2 },
      autoScaling: {
        minCapacity: 2,
        maxCapacity: 10,
        cpuTargetPercent: 70,
        memoryTargetPercent: 80,
        requestsPerTarget: 1000,
      },
    } as any),
  );

  it('creates one policy per configured target', () => {
    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalingPolicy', 3);
  });

  it('scales on request count against this service’s target group', () => {
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
      TargetTrackingScalingPolicyConfiguration: Match.objectLike({
        TargetValue: 1000,
        PredefinedMetricSpecification: Match.objectLike({
          PredefinedMetricType: 'ALBRequestCountPerTarget',
        }),
      }),
    });
  });
});

describe('ScheduledTasksStack', () => {
  const template = synth(
    scheduledManifest({
      task: { cpu: 256, memory: 512, environment: { SHARED: 'yes' } },
      tasks: [
        { name: 'nightly', schedule: 'cron(0 6 * * ? *)', command: ['node', 'nightly.js'] },
        { name: 'hourly', schedule: 'rate(1 hour)', command: ['node', 'hourly.js'] },
        { name: 'heavy', schedule: 'rate(1 day)', cpu: 1024, memory: 2048 },
        { name: 'off', schedule: 'rate(1 day)', enabled: false },
      ],
    } as any),
    '111122223333.dkr.ecr.us-east-1.amazonaws.com/jobs:abc123',
  );

  it('creates one EventBridge rule per job', () => {
    template.resourceCountIs('AWS::Events::Rule', 4);
  });

  it('names rules <manifest>-<job> and carries the schedule through', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'test-jobs-nightly',
      ScheduleExpression: 'cron(0 6 * * ? *)',
      State: 'ENABLED',
    });
  });

  it('disables a job marked enabled: false without removing the rule', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'test-jobs-off',
      State: 'DISABLED',
    });
  });

  it('shares one task definition across jobs of the default size, plus one for the override', () => {
    template.resourceCountIs('AWS::ECS::TaskDefinition', 2);
    template.hasResourceProperties('AWS::ECS::TaskDefinition', { Cpu: '256', Memory: '512' });
    template.hasResourceProperties('AWS::ECS::TaskDefinition', { Cpu: '1024', Memory: '2048' });
  });

  it('passes the per-job command as a container override', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const nightly = Object.values(rules).find((r: any) => r.Properties.Name === 'test-jobs-nightly') as any;
    const input = JSON.parse(nightly.Properties.Targets[0].Input);
    expect(input.containerOverrides[0].command).toEqual(['node', 'nightly.js']);
  });

  it('sends no environment override when a job adds nothing to the shared environment', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const nightly = Object.values(rules).find((r: any) => r.Properties.Name === 'test-jobs-nightly') as any;
    const input = JSON.parse(nightly.Properties.Targets[0].Input);
    expect(input.containerOverrides[0].environment).toBeUndefined();
  });

  it('creates three roles for the whole stack, not per task definition or rule', () => {
    // Execution + task + one shared EventBridge invoke role. CDK's default
    // would be two per task definition and one per rule.
    template.resourceCountIs('AWS::IAM::Role', 3);
  });

  it('creates no load balancer or scaling resources', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 0);
    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 0);
  });
});

describe('secrets', () => {
  it('injects Secrets Manager values, including a single JSON key', () => {
    const manifest = serviceManifest();
    manifest.task.secrets = {
      WHOLE: 'arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf',
      ONE_KEY: 'arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf:password::',
      PARAM: 'arn:aws:ssm:us-east-1:111122223333:parameter/prod/key',
    };
    const template = synth(manifest);
    const taskDefs = template.findResources('AWS::ECS::TaskDefinition');
    const secrets = Object.values(taskDefs)[0].Properties.ContainerDefinitions[0].Secrets;
    const byName = Object.fromEntries(secrets.map((s: any) => [s.Name, s.ValueFrom]));

    expect(byName.WHOLE).toBe('arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf');
    expect(byName.ONE_KEY).toBe(
      'arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf:password::',
    );
    expect(byName.PARAM).toEqual(expect.anything());
  });
});

describe('images', () => {
  it('imports an ECR repository so the execution role is granted pull access', () => {
    const template = synth(serviceManifest());
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['ecr:BatchGetImage']),
          }),
        ]),
      }),
    });
  });

  it('accepts a non-ECR image reference', () => {
    const template = synth(serviceManifest(), 'ghcr.io/example/api:v1.2.3');
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ Image: 'ghcr.io/example/api:v1.2.3' }),
      ]),
    });
  });

  it('accepts an image pinned by digest', () => {
    const digest = 'sha256:' + 'a'.repeat(64);
    const template = synth(
      serviceManifest(),
      `111122223333.dkr.ecr.us-east-1.amazonaws.com/test-api@${digest}`,
    );
    const taskDefs = template.findResources('AWS::ECS::TaskDefinition');
    const image = Object.values(taskDefs)[0].Properties.ContainerDefinitions[0].Image;
    expect(JSON.stringify(image)).toContain(digest);
  });
});

describe('bundled examples', () => {
  const files = fs.readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.yaml'));

  it('ships at least one example', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s validates and synthesizes', (file) => {
    const config = loadManifest(path.join(EXAMPLES_DIR, file), {
      env: { ...process.env, GITHUB_SHA: 'abc123' },
    });
    const app = new cdk.App();
    const stack = createStack({ app, config, image: IMAGE });
    expect(Template.fromStack(stack).toJSON().Resources).toBeDefined();
  });
});
