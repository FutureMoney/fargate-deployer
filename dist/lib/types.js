"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map