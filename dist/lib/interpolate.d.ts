/**
 * `${VAR}` expansion over manifest strings.
 *
 * Manifests are committed to a repo, so anything that varies per run — an image
 * tag, a build number, an account ID that differs between a fork and upstream —
 * has to come from somewhere else. Rather than invent a templating language,
 * every string value in the manifest is expanded against the process environment:
 *
 *   image: ${ECR_REGISTRY}/api:${GITHUB_SHA}
 *   desiredCount: ${DESIRED_COUNT:-2}      # default when unset or empty
 *   literal: $${NOT_A_VARIABLE}            # $$ escapes
 *
 * Referencing an unset variable with no default is an error, not an empty string.
 * Silently deploying `https://api-.example.com` is worse than failing.
 */
export declare class InterpolationError extends Error {
    readonly variables: string[];
    constructor(variables: string[]);
}
/**
 * Recursively expand `${VAR}` in every string of a parsed manifest.
 *
 * Object *keys* are expanded too, so `${ENV_PREFIX}_URL: ...` works in the
 * `environment` and `secrets` maps.
 */
export declare function interpolate<T>(value: T, env?: NodeJS.ProcessEnv): T;
//# sourceMappingURL=interpolate.d.ts.map