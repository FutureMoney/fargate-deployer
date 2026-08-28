# Fargate Deployer

[![CI](https://github.com/futuremoney/fargate-deployer/actions/workflows/ci.yml/badge.svg)](https://github.com/futuremoney/fargate-deployer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Deploy a container to **AWS ECS Fargate** from a single declarative manifest — a
long-running service behind an Application Load Balancer, or a set of
EventBridge-scheduled tasks.

```yaml
- uses: futuremoney/fargate-deployer@v1
  with:
    manifest: deploy/production.yaml
    role-to-assume: arn:aws:iam::111122223333:role/github-actions-deploy
```

That one step builds your image, pushes it to ECR, deploys the stack, and waits
until ECS reports the service healthy. Your repository needs a `Dockerfile` and
a manifest — no CDK app, no Node.js toolchain, no CloudFormation templates, no
`aws ecs update-service` scripting.

---

## Contents

- [Why this exists](#why-this-exists)
- [Quickstart](#quickstart)
- [What it creates, and what you bring](#what-it-creates-and-what-you-bring)
- [Action inputs](#action-inputs)
- [Action outputs](#action-outputs)
- [Scheduled tasks](#scheduled-tasks)
- [Calling it as a reusable workflow](#calling-it-as-a-reusable-workflow)
- [Running it outside GitHub Actions](#running-it-outside-github-actions)
- [Using the constructs in your own CDK app](#using-the-constructs-in-your-own-cdk-app)
- [Documentation](#documentation)

---

## Why this exists

Most teams running Fargate already own the expensive, long-lived pieces: a VPC,
an ECS cluster, one or two load balancers, a wildcard certificate. What they
deploy over and over is the cheap part — a task definition, a service, a target
group, a listener rule.

Existing options make that repetitive part harder than it should be. Writing CDK
or Terraform per service means every team maintains infrastructure code to
express the same six resources. `aws ecs update-service` scripting handles a new
image but not a new port, health check or environment variable. Full-blown
platforms want to own your VPC.

This action takes the middle path: **you own the shared infrastructure, it owns
the per-service resources.** You describe the service in about twenty lines of
YAML, and it deploys the same way every time, in any account, for anybody.

It is a public, generalised version of an internal deployer that has shipped
production services for a couple of years. Everything account-specific that used
to be hardcoded is now a manifest field.

## Quickstart

### 1. Bootstrap the account, once

The deployer runs on AWS CDK, which needs a one-time bootstrap per account and
region:

```bash
npx cdk bootstrap aws://111122223333/us-east-1
```

### 2. Create a deploy role

Set up GitHub OIDC and a role your workflow can assume — no long-lived AWS keys
in your repository. [`docs/aws-setup.md`](docs/aws-setup.md) has the trust
policy, the permissions policy, and a copy-pasteable CloudFormation template.

### 3. Write a manifest

`deploy/production.yaml`:

```yaml
kind: Service
name: hello-api
account: "111122223333"
region: us-east-1

cluster:
  name: my-cluster

network:
  vpcId: vpc-0abc123def4567890
  subnets:
    - subnet-0abc123def4567890
    - subnet-0fed987cba6543210

task:
  cpu: 256
  memory: 512
  containerPort: 8080
  environment:
    NODE_ENV: production
  secrets:
    DATABASE_URL: "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf:url::"

loadBalancer:
  listenerArn: arn:aws:elasticloadbalancing:us-east-1:111122223333:listener/app/my-alb/1234567890abcdef/abcdef1234567890
  securityGroupId: sg-0abc123def4567890
  hostHeaders: hello.example.com
  healthCheck:
    path: /health
```

Check it before you push anything — this touches no AWS APIs:

```bash
npx fargate-deployer validate --manifest deploy/production.yaml
```

### 4. Add the workflow

`.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write # required for OIDC

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: futuremoney/fargate-deployer@v1
        with:
          manifest: deploy/production.yaml
          role-to-assume: arn:aws:iam::111122223333:role/github-actions-deploy
```

Push to `main`. More patterns — multiple environments, promoting an image from
staging to production, pull-request diffs — are in
[`examples/workflows/`](examples/workflows/).

## What it creates, and what you bring

The split is deliberate. Anything shared between services, expensive to replace,
or dangerous to delete stays yours.

| You bring (referenced by ARN or ID) | It creates (owned by the stack) |
| --- | --- |
| VPC and subnets | ECS task definition |
| ECS cluster | ECS service, or EventBridge rules |
| Application Load Balancer and listener | ALB target group and listener rule |
| ACM certificate | CloudWatch log group |
| Secrets Manager secrets / SSM parameters | Task security group *(if you don't supply one)* |
| IAM roles *(optional)* | Task and execution IAM roles *(if you don't supply them)* |
| | Auto-scaling target and policies |

Everything in the right column is deleted cleanly when you delete the stack.
Nothing in the left column is ever modified, with one deliberate exception: when
you give `loadBalancer.securityGroupId`, an ingress rule is added so the load
balancer can reach your tasks. Set `manageSecurityGroupRules: false` to manage
that yourself.

**Roles and security groups are the accessibility knob.** Omit them and you get
working defaults with the exact permissions the task needs — image pull, log
writes, read access to precisely the secrets you listed, and ECS Exec. Supply
them and the deployer treats them as immutable and touches nothing.

## Action inputs

Only `manifest` is required.

### What to deploy

| Input | Default | Description |
| --- | --- | --- |
| `manifest` | — | **Required.** Path to the manifest, e.g. `deploy/production.yaml`. |
| `image` | *build one* | Deploy this exact image instead of building. Skips build and push entirely. |
| `command` | `deploy` | `deploy`, `diff`, `synth`, `validate` or `destroy`. |

### AWS authentication

| Input | Default | Description |
| --- | --- | --- |
| `role-to-assume` | — | IAM role ARN to assume via GitHub OIDC. **Recommended.** Needs `permissions: id-token: write`. |
| `role-session-name` | `fargate-deployer` | Session name for the assumed role. |
| `role-external-id` | — | External ID, if the role's trust policy requires one. |
| `role-duration-seconds` | `3600` | Session lifetime. Raise it if a slow rollout can outlast an hour. |
| `aws-access-key-id` | — | Static access key, when OIDC is not available. |
| `aws-secret-access-key` | — | Secret key that goes with it. |
| `aws-session-token` | — | Required when the key and secret are *temporary* STS credentials. |
| `aws-region` | *from manifest* | Override the region. |

Credentials go in `with:`, not `secrets:` — an action has no `secrets:` block.
The values are still masked in logs. If you would rather pass them as `secrets:`,
[call the reusable workflow](#calling-it-as-a-reusable-workflow) instead. A
worked example using access keys is in
[`examples/workflows/iam-access-keys.yml`](examples/workflows/iam-access-keys.yml).

Four combinations are supported, and one non-combination:

| What you set | What happens |
| --- | --- |
| `role-to-assume` | OIDC. No stored credentials. **Recommended.** |
| `aws-access-key-id` + `aws-secret-access-key` | Static IAM user credentials. |
| …plus `aws-session-token` | Temporary STS credentials. |
| …plus `role-to-assume` | Assume that role *from* those keys — the usual pattern when a low-privilege CI user chains into a deploy role. |
| Nothing | The credential step is skipped, and whatever the job already has is used — credentials set by an earlier step, or a self-hosted runner's instance profile. |

### Image build

| Input | Default | Description |
| --- | --- | --- |
| `ecr-repository` | *manifest `name`* | ECR repository to push to. |
| `create-ecr-repository` | `true` | Create the repository if it does not exist. |
| `image-tag` | `github.sha` | Tag for the built image. |
| `push-latest` | `false` | Also tag the image `latest`. |
| `dockerfile` | `Dockerfile` | Path to the Dockerfile, relative to `context`. |
| `context` | `.` | Docker build context. |
| `build-args` | — | `KEY=VALUE` per line. Visible in image history — not for secrets. |
| `build-secrets` | — | `KEY=VALUE` per line, read in the build via `RUN --mount=type=secret,id=KEY`. |
| `platforms` | *from manifest* | Build platform. Follows `task.runtimePlatform.cpuArchitecture`. |
| `provenance` | `false` | Attach SLSA provenance. Off because the resulting image index is not usable by ECS. |

### Deployment behaviour

| Input | Default | Description |
| --- | --- | --- |
| `bootstrap` | `false` | Run `cdk bootstrap` first. Useful for a brand-new account; turn it off afterwards. |
| `wait-for-stability` | `true` | Wait for ECS to report the service stable, and print recent service events on failure. |
| `cdk-args` | — | Extra flags passed straight to the CDK CLI. |
| `working-directory` | `.` | Directory that `manifest` and `context` are relative to. |
| `node-version` | `20` | Node.js used to run the deployer itself, not your build. |

## Action outputs

| Output | Description |
| --- | --- |
| `image` | Full image URI that was deployed |
| `image-digest` | Digest of the pushed image |
| `stack-name` | CloudFormation stack name |
| `service-name` | ECS service name (`Service` manifests) |
| `cluster` | ECS cluster deployed into |
| `region` / `account` | Target region and account from the manifest |
| `kind` | `Service` or `ScheduledTasks` |
| `log-group` | CloudWatch log group the tasks write to |

## Scheduled tasks

Change `kind` and the same action deploys cron jobs instead — one EventBridge
rule per entry, each starting a Fargate task:

```yaml
kind: ScheduledTasks
name: data-sync
account: "111122223333"
region: us-east-1

cluster: { name: my-cluster }
network:
  vpcId: vpc-0abc123def4567890
  subnets: [subnet-0abc123def4567890]

task:
  cpu: 256
  memory: 512

tasks:
  - name: nightly-sync
    schedule: cron(0 6 * * ? *) # 06:00 UTC
    command: ["node", "dist/jobs/sync.js"]

  - name: hourly-prices
    schedule: rate(1 hour)
    command: ["node", "dist/jobs/prices.js"]
```

See [`docs/scheduled-tasks.md`](docs/scheduled-tasks.md) for schedule syntax,
per-job overrides, and how to disable a job without deleting it.

## Calling it as a reusable workflow

The action is the primary interface, but a `workflow_call` wrapper ships
alongside it for callers who prefer that shape — most often because AWS
credentials already arrive through a `secrets:` block, which an action cannot
accept:

```yaml
jobs:
  deploy:
    uses: futuremoney/fargate-deployer/.github/workflows/fargate-deploy.yml@v1
    with:
      manifest: deploy/development.yaml
    secrets:
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID_DEVELOPMENT }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY_DEVELOPMENT }}
```

It brings its own job, so there is no `runs-on`, no `steps`, and no
`actions/checkout`. Extra inputs it adds over the action: `environment` (to
apply a GitHub environment's protection rules) and `runner`. Extra secrets:
`AWS_SESSION_TOKEN` and `BUILD_SECRETS`.

Two things to know. Reusable workflows cannot be listed on the Marketplace —
only actions can — so this is referenced by path rather than by name. And it
adds a job boundary, so `permissions` and `environment` apply to the whole
called workflow rather than to one step.

See [`examples/workflows/reusable-workflow-with-secrets.yml`](examples/workflows/reusable-workflow-with-secrets.yml).

## Running it outside GitHub Actions

The action is a thin wrapper around a CLI, so the exact command CI runs also
runs on your laptop, in GitLab CI, or from a Makefile:

```bash
npx fargate-deployer validate --manifest deploy/production.yaml
npx fargate-deployer diff     --manifest deploy/production.yaml --image my-image:tag
npx fargate-deployer deploy   --manifest deploy/production.yaml --image my-image:tag
npx fargate-deployer destroy  --manifest deploy/production.yaml --image my-image:tag
```

It uses your ambient AWS credentials, the same as any other AWS CLI tool.

## Using the constructs in your own CDK app

If your repository already has a CDK app, add the stack to it rather than
deploying a second one:

```ts
import * as cdk from 'aws-cdk-lib';
import { loadManifest, createStack } from 'fargate-deployer';

const app = new cdk.App();

createStack({
  app,
  config: loadManifest('deploy/production.yaml'),
  image: process.env.IMAGE!,
});

new MyDatabaseStack(app, 'database');
```

`FargateServiceStack` and `ScheduledTasksStack` are exported directly if you
want to construct them yourself.

## Documentation

| | |
| --- | --- |
| [Manifest reference](docs/manifest-reference.md) | Every field, its default, and when to set it |
| [AWS setup](docs/aws-setup.md) | Bootstrap, OIDC, IAM policies, prerequisites |
| [Scheduled tasks](docs/scheduled-tasks.md) | Cron jobs in depth |
| [Architecture](docs/architecture.md) | What is created, how it is named, why |
| [Troubleshooting](docs/troubleshooting.md) | Common failures and what they mean |
| [Contributing](CONTRIBUTING.md) | Development setup and release process |

## License

[MIT](LICENSE)
