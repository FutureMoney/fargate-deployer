"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterpolationError = void 0;
exports.interpolate = interpolate;
const PATTERN = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
class InterpolationError extends Error {
    variables;
    constructor(variables) {
        super(`Manifest references environment variable${variables.length === 1 ? '' : 's'} ` +
            `that ${variables.length === 1 ? 'is' : 'are'} not set: ${variables.join(', ')}.\n` +
            'Set them in the environment, or give a default with ${VAR:-fallback}.');
        this.variables = variables;
        this.name = 'InterpolationError';
    }
}
exports.InterpolationError = InterpolationError;
/**
 * Recursively expand `${VAR}` in every string of a parsed manifest.
 *
 * Object *keys* are expanded too, so `${ENV_PREFIX}_URL: ...` works in the
 * `environment` and `secrets` maps.
 */
function interpolate(value, env = process.env) {
    const missing = new Set();
    const result = walk(value, env, missing);
    if (missing.size > 0) {
        throw new InterpolationError([...missing].sort());
    }
    return result;
}
function walk(value, env, missing) {
    if (typeof value === 'string') {
        return expand(value, env, missing);
    }
    if (Array.isArray(value)) {
        return value.map((item) => walk(item, env, missing));
    }
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            out[expand(key, env, missing)] = walk(val, env, missing);
        }
        return out;
    }
    return value;
}
function expand(input, env, missing) {
    return input.replace(PATTERN, (match, name, fallback) => {
        if (match === '$$') {
            return '$';
        }
        const current = env[name];
        if (current !== undefined && current !== '') {
            return current;
        }
        if (fallback !== undefined) {
            return fallback;
        }
        missing.add(name);
        return match;
    });
}
//# sourceMappingURL=interpolate.js.map