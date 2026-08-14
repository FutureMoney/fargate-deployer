# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because `@v1` moves on every `v1.x.y` release, a change to a **default** counts
as breaking — it produces a CloudFormation diff on every consumer's next deploy.

## [Unreleased]

## [1.0.0] - 2026-08-14

First public release. A generalised version of an internal ECS deployer, with
every account-specific value moved out of the code and into the manifest.

### Added

- **`Fargate Deployer` composite action** — builds, pushes and deploys in one
  step. OIDC or static credentials, ECR repository creation, buildx with layer
  caching, wait-for-stability with service events on failure, and a job summary.
- **`fargate-deployer` CLI** — `deploy`, `diff`, `synth`, `destroy`, `validate`
  and `inspect`. The action is a thin wrapper, so any CI system or a laptop can
  run the same command.
- **`kind: Service`** — a Fargate service with an optional ALB target group and
  listener rule, rolling deployments, deployment circuit breaker, ECS Exec, and
  CPU / memory / request-count auto scaling.
- **`kind: ScheduledTasks`** — EventBridge cron rules starting Fargate tasks,
  with per-job command, environment, size and enablement.
- **YAML and JSON manifests**, with `${VAR}` expansion and `${VAR:-default}`.
  An unset variable with no default is an error rather than an empty string.
- **Validation with actionable errors** — every problem in a file reported at
  once, each with the field path and a hint. Includes cross-field checks such as
  valid Fargate CPU/memory pairs and "an HTTPS listener you create needs a
  certificate".
- **Created-when-omitted IAM roles and security group**, with least privilege
  derived from the manifest. Supplied ARNs are imported immutably and never
  modified.
- **Secrets from Secrets Manager or SSM Parameter Store**, including a single
  key out of a JSON secret, referenced by full ARN so cross-account works.
- **ARM64 / Graviton support**, with the action defaulting its build platform to
  match `task.runtimePlatform.cpuArchitecture`.
- **JSON Schema** for editor autocomplete and validation.
- Documentation: manifest reference, AWS setup, scheduled tasks, architecture,
  troubleshooting, publishing.

### Changed from the internal deployer

- Environment-specific platform defaults — accounts, VPCs, subnets, clusters,
  public and private ALBs, listeners, certificates and IAM roles — are gone.
  Everything is a manifest field.
- `exposure: internal | external` is replaced by an explicit `listenerArn` or
  `loadBalancerArn`, since there is no shared pair of load balancers to select
  between.
- Environments are arbitrary manifest files rather than a fixed `dev` / `prod`
  pair.
- Fields moved into nested blocks (`task`, `service`, `loadBalancer`,
  `autoScaling`, `network`).
- `timeoutMinutes` is renamed `maxEventAgeMinutes` and documented accurately: it
  bounds EventBridge's retry window for *starting* a task, and is not an
  execution timeout.
- Auto scaling is off unless configured, and requires an explicit target.
  `cpuScaleDownTarget` and `memoryScaleDownTarget` are removed — they were never
  read.
- Listener rule priorities use a SHA-256 hash rather than a 16-bit one, and
  target group names get a hash suffix when truncated, both to avoid collisions.
- The load balancer is only looked up when a listener has to be created, which
  removes the need for `elasticloadbalancing:Describe*` on the common path.
- Log groups are created as real resources rather than through a custom-resource
  Lambda.
- Images are matched against a full ECR URI pattern, so registries with a port,
  digest-pinned images, and non-ECR registries all work.

[Unreleased]: https://github.com/futuremoney/fargate-deployer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/futuremoney/fargate-deployer/releases/tag/v1.0.0
