import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { containerImage } from './image';
import { buildSecrets } from './secrets';
import { ResolvedConfig } from './types';

/**
 * Everything the two stacks share: looking up the VPC, resolving (or creating)
 * the task security group and IAM roles, and assembling task definitions.
 *
 * Kept as free functions rather than a base class so each stack still reads top
 * to bottom. The context is built once per stack because several of these
 * resources — the log group, the imported secrets, the ECR repository — are
 * shared by every task definition in the stack and must not be created twice.
 */

export interface StackContext {
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  securityGroups: ec2.ISecurityGroup[];
  subnetSelection: ec2.SubnetSelection;
  executionRole: iam.IRole;
  taskRole: iam.IRole;
  image: ecs.ContainerImage;
  secrets: Record<string, ecs.Secret>;
  logGroup: logs.ILogGroup;
}

export function buildContext(scope: Construct, config: ResolvedConfig, image: string): StackContext {
  // `fromLookup` reads the real VPC at synth time, which is what makes explicit
  // subnet IDs safe to use — CDK can confirm they belong to this VPC.
  const vpc = ec2.Vpc.fromLookup(scope, 'Vpc', { vpcId: config.network.vpcId });

  const securityGroups: ec2.ISecurityGroup[] =
    config.network.securityGroups.length === 0
      ? [
          new ec2.SecurityGroup(scope, 'TaskSecurityGroup', {
            vpc,
            description: `Tasks for ${config.name}`,
            allowAllOutbound: true,
          }),
        ]
      : config.network.securityGroups.map((id) =>
          ec2.SecurityGroup.fromSecurityGroupId(scope, `SecurityGroup-${id}`, id, {
            // Imported groups are assumed to allow egress already; saying so
            // stops CDK adding a redundant allow-all egress rule to a security
            // group that other workloads may share.
            allowAllOutbound: true,
          }),
        );

  const cluster = ecs.Cluster.fromClusterAttributes(scope, 'Cluster', {
    clusterName: config.clusterName,
    vpc,
    securityGroups,
  });

  return {
    vpc,
    cluster,
    securityGroups,
    subnetSelection: { subnetFilters: [ec2.SubnetFilter.byIds(config.network.subnets)] },
    // Roles are resolved once per stack rather than per task definition, so a
    // scheduled-tasks manifest with several task sizes still produces one pair.
    // A created role starts empty and picks up exactly what the task needs —
    // image pull, log writes, secret reads, ECS Exec — through CDK's grants.
    // An imported one is immutable and receives none of them.
    executionRole: config.roles.executionRoleArn
      ? iam.Role.fromRoleArn(scope, 'ExecutionRole', config.roles.executionRoleArn, {
          mutable: false,
        })
      : new iam.Role(scope, 'ExecutionRole', {
          assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
          description: `Task execution role for ${config.name}`,
        }),
    taskRole: config.roles.taskRoleArn
      ? iam.Role.fromRoleArn(scope, 'TaskRole', config.roles.taskRoleArn, { mutable: false })
      : new iam.Role(scope, 'TaskRole', {
          assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
          description: `Task role for ${config.name}`,
        }),
    image: containerImage(scope, image),
    secrets: buildSecrets(scope, config.task.secrets),
    logGroup: buildLogGroup(scope, config),
  };
}

export interface TaskDefinitionOptions {
  /** Suffix for construct IDs, so several task definitions can coexist in one stack. */
  idSuffix?: string;
  /** Family name. Defaults to the config name. */
  family?: string;
  cpu?: number;
  memory?: number;
  environment?: Record<string, string>;
  command?: string[];
  /** Add a port mapping. Omitted for scheduled tasks. */
  containerPort?: number;
}

export interface BuiltTaskDefinition {
  taskDefinition: ecs.FargateTaskDefinition;
  container: ecs.ContainerDefinition;
}

export function buildTaskDefinition(
  scope: Construct,
  config: ResolvedConfig,
  context: StackContext,
  options: TaskDefinitionOptions = {},
): BuiltTaskDefinition {
  const suffix = options.idSuffix ?? '';
  const task = config.task;

  const taskDefinition = new ecs.FargateTaskDefinition(scope, `TaskDefinition${suffix}`, {
    family: options.family ?? config.name,
    cpu: options.cpu ?? task.cpu,
    memoryLimitMiB: options.memory ?? task.memory,
    executionRole: context.executionRole,
    taskRole: context.taskRole,
    runtimePlatform: {
      cpuArchitecture:
        task.cpuArchitecture === 'ARM64' ? ecs.CpuArchitecture.ARM64 : ecs.CpuArchitecture.X86_64,
      operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    },
    ...(task.ephemeralStorageGiB !== undefined && {
      ephemeralStorageGiB: task.ephemeralStorageGiB,
    }),
  });

  const container = taskDefinition.addContainer(`Container${suffix}`, {
    containerName: config.name,
    image: context.image,
    environment: options.environment ?? task.environment,
    secrets: context.secrets,
    entryPoint: task.entryPoint,
    command: options.command ?? task.command,
    logging: ecs.LogDrivers.awsLogs({
      streamPrefix: config.name,
      logGroup: context.logGroup,
    }),
    stopTimeout: cdk.Duration.seconds(task.stopTimeoutSeconds),
    ...(options.containerPort !== undefined && {
      portMappings: [{ containerPort: options.containerPort, protocol: ecs.Protocol.TCP }],
    }),
  });

  return { taskDefinition, container };
}

/**
 * One log group per stack, shared by every task definition in it.
 *
 * Created explicitly rather than through CDK's `logRetention` option so that
 * retention is a property of a real resource instead of a custom-resource
 * Lambda — one fewer permission the deploying principal needs, and one fewer
 * Lambda left behind in the account.
 */
function buildLogGroup(scope: Construct, config: ResolvedConfig): logs.ILogGroup {
  return new logs.LogGroup(scope, 'LogGroup', {
    logGroupName: config.task.logGroupName,
    retention:
      config.task.logRetentionDays === 0
        ? logs.RetentionDays.INFINITE
        : (config.task.logRetentionDays as logs.RetentionDays),
    // Retaining is the safe default for an audit trail, but it means a destroyed
    // stack leaves the group behind and recreating it fails with "already
    // exists". `task.retainLogsOnDelete: false` is the way out.
    removalPolicy: config.task.retainLogsOnDelete
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY,
  });
}
