import { Manifest, ResolvedConfig } from './types';
/**
 * Apply defaults to a validated manifest.
 *
 * Every default here is a property of ECS/ELB itself or an unambiguously safe
 * choice — never a property of somebody's particular AWS account. That is the
 * whole difference between this and an internal deployer: nothing in this file
 * knows what a VPC, ALB or cluster is called.
 */
export declare function resolveManifest(manifest: Manifest): ResolvedConfig;
//# sourceMappingURL=resolve.d.ts.map