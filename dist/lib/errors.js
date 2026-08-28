"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssueCollector = exports.ManifestError = void 0;
/**
 * A user-facing configuration error.
 *
 * Because the public deployer defaults almost nothing about *your* AWS account,
 * a bad manifest is the single most likely failure mode. These errors are meant
 * to be read by someone who has never seen this codebase: they carry the field
 * path, what was wrong, and — where possible — what to do instead.
 */
class ManifestError extends Error {
    issues;
    constructor(source, issues) {
        super(ManifestError.format(source, issues));
        this.name = 'ManifestError';
        this.issues = issues;
    }
    static format(source, issues) {
        const lines = [
            `${issues.length} problem${issues.length === 1 ? '' : 's'} in ${source}:`,
            '',
        ];
        for (const issue of issues) {
            lines.push(`  ✗ ${issue.path}: ${issue.message}`);
            if (issue.hint) {
                lines.push(`      ${issue.hint}`);
            }
        }
        lines.push('', 'See https://github.com/futuremoney/fargate-deployer/blob/main/docs/manifest-reference.md');
        return lines.join('\n');
    }
}
exports.ManifestError = ManifestError;
/** Collects issues so a user sees every problem at once, not one per run. */
class IssueCollector {
    issues = [];
    add(path, message, hint) {
        this.issues.push({ path, message, hint });
    }
    get length() {
        return this.issues.length;
    }
    throwIfAny(source) {
        if (this.issues.length > 0) {
            throw new ManifestError(source, this.issues);
        }
    }
}
exports.IssueCollector = IssueCollector;
//# sourceMappingURL=errors.js.map