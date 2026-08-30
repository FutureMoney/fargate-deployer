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
exports.containerImage = containerImage;
exports.isEcrImage = isEcrImage;
const ecr = __importStar(require("aws-cdk-lib/aws-ecr"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
/**
 * `<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>` — including the
 * `ecr-fips` and China/GovCloud partition hosts.
 */
const ECR_URI = /^(\d{12})\.dkr\.ecr(?:-fips)?\.([a-z0-9-]+)\.(?:amazonaws\.com|amazonaws\.com\.cn)\/([^:@]+)(?::(.+)|@(sha256:[a-f0-9]{64}))$/;
/**
 * Build a container image reference from an image URI.
 *
 * ECR images are imported as repositories rather than as plain registry strings
 * so that CDK grants the execution role pull permission automatically — which
 * matters most in the case this tool is designed for, where the execution role
 * was created for you and has no hand-written policy. Everything else (Docker
 * Hub, GHCR, ECR Public, a private registry) falls through to a registry
 * reference, optionally with credentials from Secrets Manager.
 */
function containerImage(scope, image) {
    const match = ECR_URI.exec(image);
    if (!match) {
        return ecs.ContainerImage.fromRegistry(image);
    }
    const [, account, region, repositoryName, tag, digest] = match;
    const repository = ecr.Repository.fromRepositoryAttributes(scope, 'EcrRepository', {
        repositoryName,
        repositoryArn: `arn:aws:ecr:${region}:${account}:repository/${repositoryName}`,
    });
    // `fromEcrRepository` resolves a `sha256:…` argument as a digest, not a tag.
    return ecs.ContainerImage.fromEcrRepository(repository, digest ?? tag);
}
/** True when the URI points at a private ECR repository. */
function isEcrImage(image) {
    return ECR_URI.test(image);
}
//# sourceMappingURL=image.js.map