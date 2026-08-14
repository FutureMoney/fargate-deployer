import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

/**
 * `<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>` — including the
 * `ecr-fips` and China/GovCloud partition hosts.
 */
const ECR_URI =
  /^(\d{12})\.dkr\.ecr(?:-fips)?\.([a-z0-9-]+)\.(?:amazonaws\.com|amazonaws\.com\.cn)\/([^:@]+)(?::(.+)|@(sha256:[a-f0-9]{64}))$/;

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
export function containerImage(scope: Construct, image: string): ecs.ContainerImage {
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
export function isEcrImage(image: string): boolean {
  return ECR_URI.test(image);
}
