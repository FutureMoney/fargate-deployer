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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.interpolate = exports.InterpolationError = exports.ManifestError = exports.isEcrImage = exports.containerImage = exports.splitSecretsManagerArn = exports.buildSecrets = exports.ScheduledTasksStack = exports.FargateServiceStack = exports.resolveManifest = exports.validateManifest = exports.resolveManifestPath = exports.loadManifest = exports.createStack = void 0;
/**
 * Programmatic entry point.
 *
 * Use this when you already have a CDK app and want the Fargate stack inside it
 * alongside your other infrastructure, rather than deploying it on its own:
 *
 *   import { loadManifest, createStack } from 'fargate-deployer';
 *
 *   const app = new cdk.App();
 *   createStack({ app, config: loadManifest('deploy/prod.yaml'), image });
 *   new MyOtherStack(app, 'other');
 */
var app_1 = require("./lib/app");
Object.defineProperty(exports, "createStack", { enumerable: true, get: function () { return app_1.createStack; } });
var manifest_1 = require("./lib/manifest");
Object.defineProperty(exports, "loadManifest", { enumerable: true, get: function () { return manifest_1.loadManifest; } });
Object.defineProperty(exports, "resolveManifestPath", { enumerable: true, get: function () { return manifest_1.resolveManifestPath; } });
var validate_1 = require("./lib/validate");
Object.defineProperty(exports, "validateManifest", { enumerable: true, get: function () { return validate_1.validateManifest; } });
var resolve_1 = require("./lib/resolve");
Object.defineProperty(exports, "resolveManifest", { enumerable: true, get: function () { return resolve_1.resolveManifest; } });
var service_stack_1 = require("./lib/service-stack");
Object.defineProperty(exports, "FargateServiceStack", { enumerable: true, get: function () { return service_stack_1.FargateServiceStack; } });
var scheduled_tasks_stack_1 = require("./lib/scheduled-tasks-stack");
Object.defineProperty(exports, "ScheduledTasksStack", { enumerable: true, get: function () { return scheduled_tasks_stack_1.ScheduledTasksStack; } });
var secrets_1 = require("./lib/secrets");
Object.defineProperty(exports, "buildSecrets", { enumerable: true, get: function () { return secrets_1.buildSecrets; } });
Object.defineProperty(exports, "splitSecretsManagerArn", { enumerable: true, get: function () { return secrets_1.splitSecretsManagerArn; } });
var image_1 = require("./lib/image");
Object.defineProperty(exports, "containerImage", { enumerable: true, get: function () { return image_1.containerImage; } });
Object.defineProperty(exports, "isEcrImage", { enumerable: true, get: function () { return image_1.isEcrImage; } });
var errors_1 = require("./lib/errors");
Object.defineProperty(exports, "ManifestError", { enumerable: true, get: function () { return errors_1.ManifestError; } });
var interpolate_1 = require("./lib/interpolate");
Object.defineProperty(exports, "InterpolationError", { enumerable: true, get: function () { return interpolate_1.InterpolationError; } });
Object.defineProperty(exports, "interpolate", { enumerable: true, get: function () { return interpolate_1.interpolate; } });
__exportStar(require("./lib/types"), exports);
//# sourceMappingURL=index.js.map