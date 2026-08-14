import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { buildContext, buildTaskDefinition } from './base';
import { ResolvedScheduledTasksConfig } from './types';

export interface ScheduledTasksStackProps extends cdk.StackProps {
  config: ResolvedScheduledTasksConfig;
  /** Full image URI to run, e.g. `111122223333.dkr.ecr.us-east-1.amazonaws.com/jobs:abc123`. */
  image: string;
}

/**
 * A set of cron jobs: one EventBridge rule per job, each starting a Fargate task.
 *
 * Jobs that share the manifest's CPU and memory share a single task definition;
 * a job that overrides either gets its own, because task size is a property of
 * the task definition rather than of the RunTask call. Command and environment
 * differences are handled with per-rule container overrides, so they never cause
 * an extra task definition.
 */
export class ScheduledTasksStack extends cdk.Stack {
  readonly rules: events.Rule[] = [];

  constructor(scope: Construct, id: string, props: ScheduledTasksStackProps) {
    super(scope, id, props);

    const { config, image } = props;
    const context = buildContext(this, config, image);

    // CDK gives each EcsTask target its own EventBridge invoke role by default.
    // One shared role for the whole stack keeps a ten-job manifest from adding
    // ten near-identical roles to the account.
    const invokeRole = new iam.Role(this, 'EventsInvokeRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
      description: `EventBridge invoke role for ${config.name}`,
    });

    /** Task definitions keyed by `cpu/memory`, created on first use. */
    const definitions = new Map<string, { taskDefinition: ecs.FargateTaskDefinition; containerName: string }>();

    const taskDefinitionFor = (cpu: number, memory: number) => {
      const key = `${cpu}/${memory}`;
      const existing = definitions.get(key);
      if (existing) {
        return existing;
      }
      const isDefaultSize = cpu === config.task.cpu && memory === config.task.memory;
      const built = buildTaskDefinition(this, config, context, {
        idSuffix: isDefaultSize ? '' : `-${cpu}-${memory}`,
        family: isDefaultSize ? config.name : `${config.name}-${cpu}-${memory}`,
        cpu,
        memory,
      });
      built.taskDefinition.grantRun(invokeRole);
      const entry = {
        taskDefinition: built.taskDefinition,
        containerName: built.container.containerName,
      };
      definitions.set(key, entry);
      return entry;
    };

    for (const task of config.tasks) {
      const { taskDefinition, containerName } = taskDefinitionFor(task.cpu, task.memory);

      const rule = new events.Rule(this, `Rule-${task.name}`, {
        ruleName: `${config.name}-${task.name}`,
        description: task.description ?? `${config.name}: ${task.name}`,
        schedule: events.Schedule.expression(task.schedule),
        enabled: task.enabled,
      });

      // Only send overrides that actually differ from the task definition —
      // an empty override block makes every RunTask call look like a change.
      const environmentOverride = diffEnvironment(config.task.environment, task.environment);
      const commandOverride =
        JSON.stringify(task.command) === JSON.stringify(config.task.command) ? undefined : task.command;

      const hasOverrides = commandOverride !== undefined || environmentOverride.length > 0;

      rule.addTarget(
        new targets.EcsTask({
          cluster: context.cluster,
          taskDefinition,
          taskCount: 1,
          subnetSelection: context.subnetSelection,
          securityGroups: context.securityGroups,
          assignPublicIp: config.network.assignPublicIp,
          role: invokeRole,
          retryAttempts: task.retryAttempts,
          ...(hasOverrides && {
            containerOverrides: [
              {
                containerName,
                ...(commandOverride !== undefined && { command: commandOverride }),
                ...(environmentOverride.length > 0 && { environment: environmentOverride }),
              },
            ],
          }),
          ...(task.maxEventAgeMinutes !== undefined && {
            maxEventAge: cdk.Duration.minutes(task.maxEventAgeMinutes),
          }),
        }),
      );

      this.rules.push(rule);
    }

    new cdk.CfnOutput(this, 'ClusterNameOutput', {
      key: 'ClusterName',
      value: config.clusterName,
      description: 'ECS cluster name',
    });
    new cdk.CfnOutput(this, 'RuleNamesOutput', {
      key: 'RuleNames',
      value: this.rules.map((r) => r.ruleName).join(','),
      description: 'EventBridge rule names created by this stack',
    });
  }
}

/** Environment entries in `task` that differ from the shared `base`. */
function diffEnvironment(
  base: Record<string, string>,
  task: Record<string, string>,
): Array<{ name: string; value: string }> {
  return Object.entries(task)
    .filter(([name, value]) => base[name] !== value)
    .map(([name, value]) => ({ name, value }));
}
