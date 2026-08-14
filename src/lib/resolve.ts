import { listenerPriority, targetGroupName } from './naming';
import {
  AutoScalingManifest,
  LoadBalancerManifest,
  Manifest,
  ResolvedAutoScaling,
  ResolvedConfig,
  ResolvedHealthCheck,
  ResolvedLoadBalancer,
  ResolvedNetwork,
  ResolvedScheduledTask,
  ResolvedService,
  ResolvedTask,
  ServiceManifest,
  TaskManifest,
} from './types';

/**
 * Apply defaults to a validated manifest.
 *
 * Every default here is a property of ECS/ELB itself or an unambiguously safe
 * choice — never a property of somebody's particular AWS account. That is the
 * whole difference between this and an internal deployer: nothing in this file
 * knows what a VPC, ALB or cluster is called.
 */
export function resolveManifest(manifest: Manifest): ResolvedConfig {
  const common = {
    name: manifest.name,
    account: manifest.account,
    region: manifest.region,
    stackName: manifest.stackName ?? manifest.name,
    tags: manifest.tags ?? {},
    clusterName: manifest.cluster.name,
    network: resolveNetwork(manifest),
    roles: {
      executionRoleArn: manifest.roles?.executionRoleArn,
      taskRoleArn: manifest.roles?.taskRoleArn,
    },
    task: resolveTask(manifest.name, manifest.task),
  };

  if (manifest.kind === 'ScheduledTasks') {
    return {
      ...common,
      kind: 'ScheduledTasks',
      tasks: (manifest.tasks ?? []).map((task): ResolvedScheduledTask => ({
        name: task.name,
        schedule: task.schedule,
        description: task.description,
        enabled: task.enabled ?? true,
        command: task.command ?? manifest.task.command,
        cpu: task.cpu ?? manifest.task.cpu,
        memory: task.memory ?? manifest.task.memory,
        environment: { ...(manifest.task.environment ?? {}), ...(task.environment ?? {}) },
        maxEventAgeMinutes: task.maxEventAgeMinutes,
        retryAttempts: task.retryAttempts ?? 0,
      })),
    };
  }

  const service = resolveService(manifest.service);
  return {
    ...common,
    kind: 'Service',
    service,
    loadBalancer: resolveLoadBalancer(manifest.name, manifest.loadBalancer, manifest.task),
    autoScaling: resolveAutoScaling(manifest.autoScaling, service.desiredCount),
  };
}

function resolveNetwork(manifest: Manifest): ResolvedNetwork {
  return {
    vpcId: manifest.network.vpcId,
    subnets: manifest.network.subnets,
    securityGroups: manifest.network.securityGroups ?? [],
    assignPublicIp: manifest.network.assignPublicIp ?? false,
  };
}

function resolveTask(name: string, task: TaskManifest): ResolvedTask {
  return {
    cpu: task.cpu,
    memory: task.memory,
    containerPort: task.containerPort,
    entryPoint: task.entryPoint,
    command: task.command,
    environment: task.environment ?? {},
    secrets: task.secrets ?? {},
    logGroupName: task.logGroupName ?? `/ecs/${name}`,
    logRetentionDays: task.logRetentionDays ?? 30,
    retainLogsOnDelete: task.retainLogsOnDelete ?? true,
    stopTimeoutSeconds: task.stopTimeoutSeconds ?? 120,
    ephemeralStorageGiB: task.ephemeralStorageGiB,
    cpuArchitecture: task.runtimePlatform?.cpuArchitecture ?? 'X86_64',
  };
}

function resolveService(service: ServiceManifest = {}): ResolvedService {
  return {
    desiredCount: service.desiredCount ?? 1,
    minHealthyPercent: service.minHealthyPercent ?? 100,
    maxHealthyPercent: service.maxHealthyPercent ?? 200,
    enableExecuteCommand: service.enableExecuteCommand ?? true,
    circuitBreaker: service.circuitBreaker ?? true,
    healthCheckGracePeriodSeconds: service.healthCheckGracePeriodSeconds,
  };
}

function resolveLoadBalancer(
  name: string,
  lb: LoadBalancerManifest | undefined,
  task: TaskManifest,
): ResolvedLoadBalancer | undefined {
  if (!lb || lb.enabled === false) {
    return undefined;
  }

  const healthCheck: ResolvedHealthCheck = {
    path: lb.healthCheck?.path ?? '/',
    intervalSeconds: lb.healthCheck?.intervalSeconds ?? 30,
    timeoutSeconds: lb.healthCheck?.timeoutSeconds ?? 5,
    healthyThresholdCount: lb.healthCheck?.healthyThresholdCount ?? 2,
    unhealthyThresholdCount: lb.healthCheck?.unhealthyThresholdCount ?? 3,
    healthyHttpCodes: lb.healthCheck?.healthyHttpCodes ?? '200',
  };

  return {
    listenerArn: lb.listenerArn,
    loadBalancerArn: lb.loadBalancerArn,
    securityGroupId: lb.securityGroupId,
    listenerPort: lb.listenerPort ?? 443,
    listenerProtocol: lb.listenerProtocol ?? 'HTTPS',
    certificateArn: lb.certificateArn,
    // Validation guarantees one of these is set for a load-balanced service.
    targetPort: lb.targetPort ?? task.containerPort!,
    targetProtocol: lb.targetProtocol ?? 'HTTP',
    hostHeaders: toArray(lb.hostHeaders),
    pathPatterns: toArray(lb.pathPatterns),
    priority: lb.priority ?? listenerPriority(name),
    defaultAction: lb.defaultAction ?? false,
    deregistrationDelaySeconds: lb.deregistrationDelaySeconds ?? 60,
    targetGroupName: lb.targetGroupName ?? targetGroupName(name),
    manageSecurityGroupRules: lb.manageSecurityGroupRules ?? lb.securityGroupId !== undefined,
    healthCheck,
  };
}

function resolveAutoScaling(
  as: AutoScalingManifest | undefined,
  desiredCount: number,
): ResolvedAutoScaling | undefined {
  if (!as || as.enabled === false) {
    return undefined;
  }
  // A floor above the desired count would immediately scale out on the first
  // deploy, which surprises people. Clamp instead.
  const minCapacity = Math.min(as.minCapacity ?? desiredCount, as.maxCapacity);
  return {
    minCapacity,
    maxCapacity: Math.max(as.maxCapacity, minCapacity),
    cpuTargetPercent: as.cpuTargetPercent,
    memoryTargetPercent: as.memoryTargetPercent,
    requestsPerTarget: as.requestsPerTarget,
    scaleInCooldownSeconds: as.scaleInCooldownSeconds ?? 300,
    scaleOutCooldownSeconds: as.scaleOutCooldownSeconds ?? 60,
  };
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
