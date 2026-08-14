/**
 * Manifest types.
 *
 * Two layers, deliberately kept apart:
 *
 *  - `*Manifest` types describe what a user writes in `deploy/<env>.yaml`. Almost
 *    everything is optional, because most of it has a defensible default.
 *  - `Resolved*` types describe what the CDK stacks consume. Nothing is optional
 *    unless the stack genuinely treats absence as a distinct case (e.g. "no ALB",
 *    "create the role for me").
 *
 * `resolve.ts` is the only thing that turns the first into the second, so the
 * stacks never have to ask "was this defaulted?".
 */

export type ManifestKind = 'Service' | 'ScheduledTasks';

export type Protocol = 'HTTP' | 'HTTPS';

export type CpuArchitecture = 'X86_64' | 'ARM64';

// ---------------------------------------------------------------------------
// Shared blocks
// ---------------------------------------------------------------------------

export interface ClusterManifest {
  /** Name of an existing ECS cluster to deploy into. */
  name: string;
}

export interface NetworkManifest {
  /** VPC the cluster and subnets live in. */
  vpcId: string;
  /** Subnet IDs to place tasks in. At least one; two or more AZs recommended. */
  subnets: string[];
  /**
   * Security groups for the tasks. Omit to have one created for you
   * (all egress allowed, no ingress except the ALB rule described below).
   */
  securityGroups?: string[];
  /** Give tasks a public IP. Required when using public subnets without a NAT gateway. */
  assignPublicIp?: boolean;
}

export interface RolesManifest {
  /**
   * Existing task execution role (pulls the image, writes logs, reads secrets).
   * Omit to have one created with `AmazonECSTaskExecutionRolePolicy` plus read
   * access to exactly the secrets this task uses.
   */
  executionRoleArn?: string;
  /**
   * Existing task role (the permissions your application code gets).
   * Omit to have an empty one created.
   */
  taskRoleArn?: string;
}

export interface RuntimePlatformManifest {
  /** `ARM64` runs on Graviton — cheaper, but your image must be built for it. */
  cpuArchitecture?: CpuArchitecture;
}

export interface TaskManifest {
  /** Fargate CPU units: 256, 512, 1024, 2048, 4096, 8192, 16384. */
  cpu: number;
  /** Memory in MiB. Valid values depend on `cpu` — see the manifest reference. */
  memory: number;
  /** Port the container listens on. Required for `Service` when a load balancer is configured. */
  containerPort?: number;
  /** Override the image `ENTRYPOINT`. */
  entryPoint?: string[];
  /** Override the image `CMD`. */
  command?: string[];
  /** Plain environment variables. */
  environment?: Record<string, string>;
  /**
   * Secrets injected as environment variables.
   * Values are Secrets Manager ARNs (optionally `...:jsonKey::`) or SSM Parameter
   * Store ARNs. See the manifest reference for the exact formats.
   */
  secrets?: Record<string, string>;
  /** CloudWatch Logs group. Defaults to `/ecs/<name>`. */
  logGroupName?: string;
  /** Log retention. Defaults to 30 days. Use 0 for never expire. */
  logRetentionDays?: number;
  /**
   * Keep the log group when the stack is deleted. Defaults to `true`.
   * Set `false` if you tear this stack down and recreate it under the same
   * name, otherwise the retained group makes the next create fail.
   */
  retainLogsOnDelete?: boolean;
  /** Grace period between SIGTERM and SIGKILL. Defaults to 120s (the Fargate maximum). */
  stopTimeoutSeconds?: number;
  /** Task-scoped scratch space, 21–200 GiB. Defaults to the Fargate default of 20 GiB. */
  ephemeralStorageGiB?: number;
  /** CPU architecture / OS for the task. */
  runtimePlatform?: RuntimePlatformManifest;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface HealthCheckManifest {
  /** Path the ALB requests. Defaults to `/`. */
  path?: string;
  /** Seconds between checks. Defaults to 30. */
  intervalSeconds?: number;
  /** Seconds before a check is considered failed. Defaults to 5. Must be < `intervalSeconds`. */
  timeoutSeconds?: number;
  /** Consecutive successes before a target is healthy. Defaults to 2. */
  healthyThresholdCount?: number;
  /** Consecutive failures before a target is unhealthy. Defaults to 3. */
  unhealthyThresholdCount?: number;
  /** Accepted status codes, e.g. `"200"`, `"200,301"`, `"200-399"`. Defaults to `"200"`. */
  healthyHttpCodes?: string;
}

export interface LoadBalancerManifest {
  /**
   * Set `false` to deploy a service with no load balancer (a worker, say).
   * Defaults to `true` when the `loadBalancer` block is present.
   */
  enabled?: boolean;
  /**
   * ARN of an existing listener to attach a routing rule to. This is the
   * recommended shape: many services share one ALB and one listener.
   * Provide either this or `loadBalancerArn`.
   */
  listenerArn?: string;
  /**
   * ARN of an existing load balancer. A listener is created on it when
   * `listenerArn` is not given.
   */
  loadBalancerArn?: string;
  /**
   * Security group attached to the ALB. When set, an ingress rule is added to the
   * task security group allowing the ALB to reach the container port.
   */
  securityGroupId?: string;
  /** Port for a listener created by this stack. Defaults to 443. */
  listenerPort?: number;
  /** Protocol for a listener created by this stack. Defaults to `HTTPS`. */
  listenerProtocol?: Protocol;
  /** ACM certificate for an `HTTPS` listener created by this stack. */
  certificateArn?: string;
  /** Port the target group forwards to. Defaults to `task.containerPort`. */
  targetPort?: number;
  /** Protocol the target group speaks to the container. Defaults to `HTTP`. */
  targetProtocol?: Protocol;
  /** Host header(s) routed to this service. */
  hostHeaders?: string | string[];
  /** Path pattern(s) routed to this service, e.g. `/api/*`. */
  pathPatterns?: string | string[];
  /**
   * Listener rule priority (1–50000). Defaults to a stable hash of the service
   * name. Set explicitly if you hit a collision on a busy listener.
   */
  priority?: number;
  /**
   * Make this service the listener's *default* action instead of adding a rule.
   * Only valid with no `hostHeaders`/`pathPatterns`, and only one service per
   * listener can do it.
   */
  defaultAction?: boolean;
  /** Seconds to keep draining connections to a stopping task. Defaults to 60. */
  deregistrationDelaySeconds?: number;
  /** Explicit target group name. Defaults to a sanitised, ≤32 char form of `name`. */
  targetGroupName?: string;
  /** Add an ingress rule for the ALB on the task security group. Defaults to `true`. */
  manageSecurityGroupRules?: boolean;
  healthCheck?: HealthCheckManifest;
}

export interface ServiceManifest {
  /** Number of tasks to run. Defaults to 1. */
  desiredCount?: number;
  /** Lower bound during a deployment, as a percent of desired count. Defaults to 100. */
  minHealthyPercent?: number;
  /** Upper bound during a deployment, as a percent of desired count. Defaults to 200. */
  maxHealthyPercent?: number;
  /** Enable ECS Exec (`aws ecs execute-command`). Defaults to `true`. */
  enableExecuteCommand?: boolean;
  /** Roll back automatically when a deployment fails to stabilise. Defaults to `true`. */
  circuitBreaker?: boolean;
  /** Ignore load balancer health checks for this many seconds after a task starts. */
  healthCheckGracePeriodSeconds?: number;
}

export interface AutoScalingManifest {
  /** Defaults to `true` when the `autoScaling` block is present. */
  enabled?: boolean;
  /** Floor for task count. Defaults to `service.desiredCount`. */
  minCapacity?: number;
  /** Ceiling for task count. Required when auto scaling is enabled. */
  maxCapacity: number;
  /** Target average CPU utilisation, as a percent. */
  cpuTargetPercent?: number;
  /** Target average memory utilisation, as a percent. */
  memoryTargetPercent?: number;
  /** Target ALB requests per task per minute. Requires a load balancer. */
  requestsPerTarget?: number;
  /** Seconds to wait after scaling in. Defaults to 300. */
  scaleInCooldownSeconds?: number;
  /** Seconds to wait after scaling out. Defaults to 60. */
  scaleOutCooldownSeconds?: number;
}

// ---------------------------------------------------------------------------
// Scheduled tasks
// ---------------------------------------------------------------------------

export interface ScheduledTaskManifest {
  /** Job name. Used for the EventBridge rule name, so unique within the manifest. */
  name: string;
  /** `cron(0 6 * * ? *)` or `rate(1 hour)`. Always UTC. */
  schedule: string;
  /** Shown on the EventBridge rule. */
  description?: string;
  /** Set `false` to keep the rule but stop it firing. Defaults to `true`. */
  enabled?: boolean;
  /** Container command for this job. Falls back to `task.command`, then the image `CMD`. */
  command?: string[];
  /** Per-job CPU override. Note: this changes the *task definition* used, so it applies per job. */
  cpu?: number;
  /** Per-job memory override. */
  memory?: number;
  /** Extra environment merged over `task.environment` for this job only. */
  environment?: Record<string, string>;
  /**
   * How long EventBridge keeps retrying to *start* this task, in minutes.
   * This is not a task execution timeout — the task itself runs until it exits.
   */
  maxEventAgeMinutes?: number;
  /** EventBridge retry attempts when starting the task fails. Defaults to 0. */
  retryAttempts?: number;
}

// ---------------------------------------------------------------------------
// Top-level manifest
// ---------------------------------------------------------------------------

export interface Manifest {
  kind: ManifestKind;
  /** Base name for the service / task family / stack. Lowercase letters, digits and hyphens. */
  name: string;
  /** 12-digit AWS account ID to deploy into. */
  account: string;
  /** AWS region to deploy into. */
  region: string;
  /** CloudFormation stack name. Defaults to `name`. */
  stackName?: string;
  /** Tags applied to every resource in the stack. */
  tags?: Record<string, string>;
  cluster: ClusterManifest;
  network: NetworkManifest;
  roles?: RolesManifest;
  task: TaskManifest;
  /** `Service` only. */
  service?: ServiceManifest;
  /** `Service` only. Omit entirely for a service with no load balancer. */
  loadBalancer?: LoadBalancerManifest;
  /** `Service` only. Omit entirely for a fixed task count. */
  autoScaling?: AutoScalingManifest;
  /** `ScheduledTasks` only. At least one job. */
  tasks?: ScheduledTaskManifest[];
}

// ---------------------------------------------------------------------------
// Resolved shapes consumed by the stacks
// ---------------------------------------------------------------------------

export interface ResolvedNetwork {
  vpcId: string;
  subnets: string[];
  /** Empty means "create one". */
  securityGroups: string[];
  assignPublicIp: boolean;
}

export interface ResolvedRoles {
  executionRoleArn?: string;
  taskRoleArn?: string;
}

export interface ResolvedTask {
  cpu: number;
  memory: number;
  containerPort?: number;
  entryPoint?: string[];
  command?: string[];
  environment: Record<string, string>;
  secrets: Record<string, string>;
  logGroupName: string;
  logRetentionDays: number;
  retainLogsOnDelete: boolean;
  stopTimeoutSeconds: number;
  ephemeralStorageGiB?: number;
  cpuArchitecture: CpuArchitecture;
}

export interface ResolvedHealthCheck {
  path: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  healthyThresholdCount: number;
  unhealthyThresholdCount: number;
  healthyHttpCodes: string;
}

export interface ResolvedLoadBalancer {
  listenerArn?: string;
  loadBalancerArn?: string;
  securityGroupId?: string;
  listenerPort: number;
  listenerProtocol: Protocol;
  certificateArn?: string;
  targetPort: number;
  targetProtocol: Protocol;
  hostHeaders: string[];
  pathPatterns: string[];
  priority: number;
  defaultAction: boolean;
  deregistrationDelaySeconds: number;
  targetGroupName: string;
  manageSecurityGroupRules: boolean;
  healthCheck: ResolvedHealthCheck;
}

export interface ResolvedService {
  desiredCount: number;
  minHealthyPercent: number;
  maxHealthyPercent: number;
  enableExecuteCommand: boolean;
  circuitBreaker: boolean;
  healthCheckGracePeriodSeconds?: number;
}

export interface ResolvedAutoScaling {
  minCapacity: number;
  maxCapacity: number;
  cpuTargetPercent?: number;
  memoryTargetPercent?: number;
  requestsPerTarget?: number;
  scaleInCooldownSeconds: number;
  scaleOutCooldownSeconds: number;
}

export interface ResolvedScheduledTask {
  name: string;
  schedule: string;
  description?: string;
  enabled: boolean;
  command?: string[];
  cpu: number;
  memory: number;
  environment: Record<string, string>;
  maxEventAgeMinutes?: number;
  retryAttempts: number;
}

interface ResolvedCommon {
  name: string;
  account: string;
  region: string;
  stackName: string;
  tags: Record<string, string>;
  clusterName: string;
  network: ResolvedNetwork;
  roles: ResolvedRoles;
  task: ResolvedTask;
}

export interface ResolvedServiceConfig extends ResolvedCommon {
  kind: 'Service';
  service: ResolvedService;
  /** Undefined means "no load balancer". */
  loadBalancer?: ResolvedLoadBalancer;
  /** Undefined means "fixed task count". */
  autoScaling?: ResolvedAutoScaling;
}

export interface ResolvedScheduledTasksConfig extends ResolvedCommon {
  kind: 'ScheduledTasks';
  tasks: ResolvedScheduledTask[];
}

export type ResolvedConfig = ResolvedServiceConfig | ResolvedScheduledTasksConfig;
