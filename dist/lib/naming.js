"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.targetGroupName = targetGroupName;
exports.listenerPriority = listenerPriority;
exports.shortHash = shortHash;
const crypto_1 = require("crypto");
/** Max length AWS allows for an ALB target group name. */
const TARGET_GROUP_NAME_MAX = 32;
/** ALB listener rules must sit in [1, 50000]. */
const MAX_LISTENER_PRIORITY = 50000;
function shortHash(input, length = 6) {
    return (0, crypto_1.createHash)('sha256').update(input).digest('hex').slice(0, length);
}
/**
 * Derive an ALB target group name from the service name.
 *
 * Target group names are limited to 32 characters, may only contain letters,
 * digits and hyphens, and may not start or end with one. When truncation is
 * needed we append a hash of the full name so two services whose names share a
 * long prefix don't collide on the same target group.
 */
function targetGroupName(name) {
    const sanitized = name
        .replace(/[^A-Za-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+/, '');
    if (sanitized.length <= TARGET_GROUP_NAME_MAX) {
        return trimTrailingHyphens(sanitized) || `tg-${shortHash(name)}`;
    }
    const suffix = `-${shortHash(name)}`;
    const head = sanitized.slice(0, TARGET_GROUP_NAME_MAX - suffix.length);
    return `${trimTrailingHyphens(head)}${suffix}`;
}
function trimTrailingHyphens(value) {
    return value.replace(/-+$/, '');
}
/**
 * Derive a stable listener rule priority from the service name.
 *
 * A listener rejects two rules with the same priority, and several services
 * usually share one listener. Hashing the name keeps the priority stable across
 * deploys (so CloudFormation sees no diff) while spreading names across the
 * range. Collisions are possible but unlikely; `loadBalancer.priority` is the
 * escape hatch and the resulting CloudFormation error names it.
 */
function listenerPriority(name) {
    const digest = (0, crypto_1.createHash)('sha256').update(name).digest();
    const value = digest.readUInt32BE(0);
    return (value % MAX_LISTENER_PRIORITY) + 1;
}
//# sourceMappingURL=naming.js.map