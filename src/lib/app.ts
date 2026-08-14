import * as cdk from 'aws-cdk-lib';
import { FargateServiceStack } from './service-stack';
import { ScheduledTasksStack } from './scheduled-tasks-stack';
import { ResolvedConfig } from './types';

export interface AppOptions {
  config: ResolvedConfig;
  /** Full image URI to deploy. */
  image: string;
  /** Existing app to add the stack to. A new one is created when omitted. */
  app?: cdk.App;
}

/**
 * Build the single-stack CDK app the CLI synthesizes.
 *
 * Exported so it can be reused: if you already have a CDK app of your own, pass
 * it in and this adds the stack to it rather than creating a second one.
 */
export function createStack(options: AppOptions): cdk.Stack {
  const { config, image } = options;
  const app = options.app ?? new cdk.App();

  const props = {
    stackName: config.stackName,
    env: { account: config.account, region: config.region },
    description:
      config.kind === 'Service'
        ? `Fargate service ${config.name} (fargate-deployer)`
        : `Scheduled tasks ${config.name} (fargate-deployer)`,
    tags: config.tags,
  };

  const stack =
    config.kind === 'Service'
      ? new FargateServiceStack(app, config.stackName, { ...props, config, image })
      : new ScheduledTasksStack(app, config.stackName, { ...props, config, image });

  cdk.Tags.of(stack).add('ManagedBy', 'fargate-deployer');
  return stack;
}
