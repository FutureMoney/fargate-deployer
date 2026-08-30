"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadManifest = loadManifest;
exports.resolveManifestPath = resolveManifestPath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml_1 = require("yaml");
const interpolate_1 = require("./interpolate");
const resolve_1 = require("./resolve");
const validate_1 = require("./validate");
/** Extensions tried when `--manifest` names a file without one. */
const EXTENSIONS = ['.yaml', '.yml', '.json'];
/**
 * Read, expand, validate and resolve a manifest file.
 *
 * The order matters: expansion happens before validation so that a value
 * supplied by `${VAR}` is checked like any other, and validation happens before
 * resolution so defaults are never applied on top of nonsense.
 */
function loadManifest(manifestPath, options = {}) {
    const resolvedPath = resolveManifestPath(manifestPath);
    const relative = path.relative(process.cwd(), resolvedPath);
    // A path outside the working directory reads better absolute than as a
    // stack of `../`.
    const source = relative && !relative.startsWith('..') ? relative : path.resolve(resolvedPath);
    const text = fs.readFileSync(resolvedPath, 'utf-8');
    let parsed;
    try {
        // `yaml` parses JSON too — JSON is a subset — so one code path covers both.
        parsed = (0, yaml_1.parse)(text);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not parse ${source}:\n  ${message}`);
    }
    if (parsed === null || parsed === undefined) {
        throw new Error(`${source} is empty.`);
    }
    const expanded = (0, interpolate_1.interpolate)(parsed, options.env ?? process.env);
    const manifest = (0, validate_1.validateManifest)(expanded, source);
    return (0, resolve_1.resolveManifest)(manifest);
}
/**
 * Accept `deploy/prod.yaml`, `deploy/prod` (extension inferred) or a directory
 * containing exactly one manifest.
 */
function resolveManifestPath(manifestPath) {
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
            throw new Error(candidates.length === 0
                ? `No manifest found in directory ${manifestPath}.`
                : `${manifestPath} contains several manifests (${candidates.join(', ')}). ` +
                    'Point --manifest at one of them.');
        }
    }
    for (const ext of EXTENSIONS) {
        const candidate = `${manifestPath}${ext}`;
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error(`Manifest not found: ${manifestPath}\n` +
        `Tried ${manifestPath} and ${EXTENSIONS.map((e) => manifestPath + e).join(', ')}.`);
}
//# sourceMappingURL=manifest.js.map