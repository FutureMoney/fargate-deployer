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
exports.buildSecrets = buildSecrets;
exports.splitSecretsManagerArn = splitSecretsManagerArn;
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
/**
 * Turn a `{ ENV_NAME: arn }` map into ECS secret references.
 *
 * Two sources are supported, told apart by the ARN's service field:
 *
 *   Secrets Manager, whole value
 *     arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf
 *   Secrets Manager, one key out of a JSON secret
 *     arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf:password::
 *   SSM Parameter Store
 *     arn:aws:ssm:us-east-1:111122223333:parameter/prod/api-key
 *
 * The trailing `:password::` form is what the AWS console shows and what ECS
 * task definitions use natively, so manifests can be copied straight from
 * either. ARNs are imported by ARN rather than by name so that secrets in a
 * different account or region still work.
 */
function buildSecrets(scope, secretArns) {
    const secrets = {};
    for (const [name, arn] of Object.entries(secretArns)) {
        secrets[name] = arn.includes(':ssm:')
            ? fromParameterStore(scope, name, arn)
            : fromSecretsManager(scope, name, arn);
    }
    return secrets;
}
function fromSecretsManager(scope, name, arn) {
    const { secretArn, jsonField } = splitSecretsManagerArn(arn);
    const secret = secretsmanager.Secret.fromSecretCompleteArn(scope, `Secret-${name}`, secretArn);
    return ecs.Secret.fromSecretsManager(secret, jsonField);
}
function fromParameterStore(scope, name, arn) {
    // arn:aws:ssm:<region>:<account>:parameter/path/to/param → /path/to/param
    const parameterName = arn.slice(arn.indexOf(':parameter') + ':parameter'.length);
    const parameter = ssm.StringParameter.fromStringParameterName(scope, `Parameter-${name}`, parameterName);
    return ecs.Secret.fromSsmParameter(parameter);
}
/**
 * Split `arn:...:secret:name-AbCdEf:jsonKey:versionStage:versionId` into the
 * bare secret ARN and the optional JSON key.
 *
 * A Secrets Manager ARN has exactly seven colon-separated segments; anything
 * after that is the ECS-specific `:json-key:version-stage:version-id` suffix.
 */
function splitSecretsManagerArn(arn) {
    const parts = arn.split(':');
    if (parts.length <= 7) {
        return { secretArn: arn };
    }
    const jsonField = parts[7];
    return {
        secretArn: parts.slice(0, 7).join(':'),
        jsonField: jsonField === '' ? undefined : jsonField,
    };
}
//# sourceMappingURL=secrets.js.map