import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { interpolate } from './interpolate';
import { resolveManifest } from './resolve';
import { ResolvedConfig } from './types';
import { validateManifest } from './validate';

/** Extensions tried when `--manifest` names a file without one. */
const EXTENSIONS = ['.yaml', '.yml', '.json'];

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
export function loadManifest(manifestPath: string, options: LoadOptions = {}): ResolvedConfig {
  const resolvedPath = resolveManifestPath(manifestPath);
  const relative = path.relative(process.cwd(), resolvedPath);
  // A path outside the working directory reads better absolute than as a
  // stack of `../`.
  const source = relative && !relative.startsWith('..') ? relative : path.resolve(resolvedPath);
  const text = fs.readFileSync(resolvedPath, 'utf-8');

  let parsed: unknown;
  try {
    // `yaml` parses JSON too — JSON is a subset — so one code path covers both.
    parsed = parseYaml(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${source}:\n  ${message}`);
  }

  if (parsed === null || parsed === undefined) {
    throw new Error(`${source} is empty.`);
  }

  const expanded = interpolate(parsed, options.env ?? process.env);
  const manifest = validateManifest(expanded, source);
  return resolveManifest(manifest);
}

/**
 * Accept `deploy/prod.yaml`, `deploy/prod` (extension inferred) or a directory
 * containing exactly one manifest.
 */
export function resolveManifestPath(manifestPath: string): string {
  if (fs.existsSync(manifestPath)) {
    const stat = fs.statSync(manifestPath);
    if (stat.isFile()) {
      return manifestPath;
    }
    if (stat.isDirectory()) {
      const candidates = fs
        .readdirSync(manifestPath)
        .filter((f) => EXTENSIONS.includes(path.extname(f)))
        .sort();
      if (candidates.length === 1) {
        return path.join(manifestPath, candidates[0]);
      }
      throw new Error(
        candidates.length === 0
          ? `No manifest found in directory ${manifestPath}.`
          : `${manifestPath} contains several manifests (${candidates.join(', ')}). ` +
            'Point --manifest at one of them.',
      );
    }
  }

  for (const ext of EXTENSIONS) {
    const candidate = `${manifestPath}${ext}`;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Manifest not found: ${manifestPath}\n` +
      `Tried ${manifestPath} and ${EXTENSIONS.map((e) => manifestPath + e).join(', ')}.`,
  );
}
