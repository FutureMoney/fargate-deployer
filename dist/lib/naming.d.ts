declare function shortHash(input: string, length?: number): string;
/**
 * Derive an ALB target group name from the service name.
 *
 * Target group names are limited to 32 characters, may only contain letters,
 * digits and hyphens, and may not start or end with one. When truncation is
 * needed we append a hash of the full name so two services whose names share a
 * long prefix don't collide on the same target group.
 */
export declare function targetGroupName(name: string): string;
/**
 * Derive a stable listener rule priority from the service name.
 *
 * A listener rejects two rules with the same priority, and several services
 * usually share one listener. Hashing the name keeps the priority stable across
 * deploys (so CloudFormation sees no diff) while spreading names across the
 * range. Collisions are possible but unlikely; `loadBalancer.priority` is the
 * escape hatch and the resulting CloudFormation error names it.
 */
export declare function listenerPriority(name: string): number;
export { shortHash };
//# sourceMappingURL=naming.d.ts.map