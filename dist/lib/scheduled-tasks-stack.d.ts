import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
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
export declare class ScheduledTasksStack extends cdk.Stack {
    readonly rules: events.Rule[];
    constructor(scope: Construct, id: string, props: ScheduledTasksStackProps);
}
//# sourceMappingURL=scheduled-tasks-stack.d.ts.map