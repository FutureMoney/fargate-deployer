import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
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
export declare function buildSecrets(scope: Construct, secretArns: Record<string, string>): Record<string, ecs.Secret>;
/**
 * Split `arn:...:secret:name-AbCdEf:jsonKey:versionStage:versionId` into the
 * bare secret ARN and the optional JSON key.
 *
 * A Secrets Manager ARN has exactly seven colon-separated segments; anything
 * after that is the ECS-specific `:json-key:version-stage:version-id` suffix.
 */
export declare function splitSecretsManagerArn(arn: string): {
    secretArn: string;
    jsonField?: string;
};
//# sourceMappingURL=secrets.d.ts.map