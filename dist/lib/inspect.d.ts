import { ResolvedConfig } from './types';
/**
 * The facts a CI job needs from a manifest before it can talk to AWS.
 *
 * This is the contract between the CLI and the GitHub Action: the action runs
 * `fargate-deployer inspect` and appends the output straight to `$GITHUB_OUTPUT`,
 * so every key here is an action output or the input to a later step. Renaming
 * one silently breaks the action, which is why it lives in a pure function with
 * its own tests rather than inline in the CLI.
 */
export declare function inspectFacts(config: ResolvedConfig): Record<string, string>;
/** Render the facts as the `key=value` lines `$GITHUB_OUTPUT` expects. */
export declare function formatFacts(facts: Record<string, string>): string;
//# sourceMappingURL=inspect.d.ts.map