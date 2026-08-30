import { ResolvedConfig } from './types';
export interface LoadOptions {
    /** Environment used for `${VAR}` expansion. Defaults to `process.env`. */
    env?: NodeJS.ProcessEnv;
}
/**
 * Read, expand, validate and resolve a manifest file.
 *
 * The order matters: expansion happens before validation so that a value
 * supplied by `${VAR}` is checked like any other, and validation happens before
 * resolution so defaults are never applied on top of nonsense.
 */
export declare function loadManifest(manifestPath: string, options?: LoadOptions): ResolvedConfig;
/**
 * Accept `deploy/prod.yaml`, `deploy/prod` (extension inferred) or a directory
 * containing exactly one manifest.
 */
export declare function resolveManifestPath(manifestPath: string): string;
//# sourceMappingURL=manifest.d.ts.map