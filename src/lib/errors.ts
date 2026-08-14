/**
 * A user-facing configuration error.
 *
 * Because the public deployer defaults almost nothing about *your* AWS account,
 * a bad manifest is the single most likely failure mode. These errors are meant
 * to be read by someone who has never seen this codebase: they carry the field
 * path, what was wrong, and — where possible — what to do instead.
 */
export class ManifestError extends Error {
  readonly issues: ManifestIssue[];

  constructor(source: string, issues: ManifestIssue[]) {
    super(ManifestError.format(source, issues));
    this.name = 'ManifestError';
    this.issues = issues;
  }

  private static format(source: string, issues: ManifestIssue[]): string {
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

export interface ManifestIssue {
  /** Dotted path into the manifest, e.g. `loadBalancer.healthCheck.timeoutSeconds`. */
  path: string;
  message: string;
  hint?: string;
}

/** Collects issues so a user sees every problem at once, not one per run. */
export class IssueCollector {
  private readonly issues: ManifestIssue[] = [];

  add(path: string, message: string, hint?: string): void {
    this.issues.push({ path, message, hint });
  }

  get length(): number {
    return this.issues.length;
  }

  throwIfAny(source: string): void {
    if (this.issues.length > 0) {
      throw new ManifestError(source, this.issues);
    }
  }
}
