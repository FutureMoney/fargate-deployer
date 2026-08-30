import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
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
export declare function containerImage(scope: Construct, image: string): ecs.ContainerImage;
/** True when the URI points at a private ECR repository. */
export declare function isEcrImage(image: string): boolean;
//# sourceMappingURL=image.d.ts.map