/**
 * Programmatic entry point.
 *
 * Use this when you already have a CDK app and want the Fargate stack inside it
 * alongside your other infrastructure, rather than deploying it on its own:
 *
 *   import { loadManifest, createStack } from 'fargate-deployer';
 *
 *   const app = new cdk.App();
 *   createStack({ app, config: loadManifest('deploy/prod.yaml'), image });
 *   new MyOtherStack(app, 'other');
 */
export { createStack, AppOptions } from './lib/app';
export { loadManifest, resolveManifestPath, LoadOptions } from './lib/manifest';
export { validateManifest } from './lib/validate';
export { inspectFacts, formatFacts } from './lib/inspect';
export { resolveManifest } from './lib/resolve';
export { FargateServiceStack, FargateServiceStackProps } from './lib/service-stack';
export { ScheduledTasksStack, ScheduledTasksStackProps } from './lib/scheduled-tasks-stack';
export { buildSecrets, splitSecretsManagerArn } from './lib/secrets';
export { containerImage, isEcrImage } from './lib/image';
export { ManifestError, ManifestIssue } from './lib/errors';
export { InterpolationError, interpolate } from './lib/interpolate';
export * from './lib/types';
//# sourceMappingURL=index.d.ts.map