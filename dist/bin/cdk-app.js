#!/usr/bin/env node
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
/**
 * CDK app entry point.
 *
 * Never run this directly — the `fargate-deployer` CLI invokes it via
 * `cdk --app "node cdk-app.js"`, passing the manifest path and image through the
 * environment because that is the only channel the CDK CLI gives an app.
 */
const cdk = __importStar(require("aws-cdk-lib"));
const app_1 = require("../lib/app");
const manifest_1 = require("../lib/manifest");
const manifestPath = process.env.FARGATE_DEPLOYER_MANIFEST;
const image = process.env.FARGATE_DEPLOYER_IMAGE;
if (!manifestPath || !image) {
    throw new Error('cdk-app.js is invoked by the fargate-deployer CLI and needs ' +
        'FARGATE_DEPLOYER_MANIFEST and FARGATE_DEPLOYER_IMAGE in the environment. ' +
        'Run `fargate-deployer deploy --manifest <path> --image <uri>` instead.');
}
const app = new cdk.App();
(0, app_1.createStack)({ config: (0, manifest_1.loadManifest)(manifestPath), image, app });
app.synth();
//# sourceMappingURL=cdk-app.js.map