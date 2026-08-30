/**
 * A user-facing configuration error.
 *
 * Because the public deployer defaults almost nothing about *your* AWS account,
 * a bad manifest is the single most likely failure mode. These errors are meant
 * to be read by someone who has never seen this codebase: they carry the field
 * path, what was wrong, and — where possible — what to do instead.
 */
export declare class ManifestError extends Error {
    readonly issues: ManifestIssue[];
    constructor(source: string, issues: ManifestIssue[]);
    private static format;
}
export interface ManifestIssue {
    /** Dotted path into the manifest, e.g. `loadBalancer.healthCheck.timeoutSeconds`. */
    path: string;
    message: string;
    hint?: string;
}
/** Collects issues so a user sees every problem at once, not one per run. */
export declare class IssueCollector {
    private readonly issues;
    add(path: string, message: string, hint?: string): void;
    get length(): number;
    throwIfAny(source: string): void;
}
//# sourceMappingURL=errors.d.ts.map