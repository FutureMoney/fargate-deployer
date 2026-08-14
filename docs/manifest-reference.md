# Manifest reference

A manifest describes one deployable unit: a Fargate service, or a set of
scheduled tasks. One file per environment is the usual layout:

```
deploy/
  staging.yaml
  production.yaml
```

YAML and JSON are both accepted — JSON is a subset of YAML, so the same parser
handles either. Examples throughout use YAML.

- [Editor support](#editor-support)
- [Variable expansion](#variable-expansion)
- [Top level](#top-level)
- [`cluster`](#cluster)
- [`network`](#network)
- [`roles`](#roles)
- [`task`](#task)
- [`service`](#service)
- [`loadBalancer`](#loadbalancer)
- [`autoScaling`](#autoscaling)
- [`tasks`](#tasks)
- [Fargate CPU and memory combinations](#fargate-cpu-and-memory-combinations)

---

## Editor support

A JSON Schema ships with the package. Point your editor at it for autocomplete
and inline validation:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/futuremoney/fargate-deployer/main/schema/manifest.schema.json
kind: Service
```

The schema catches typos and wrong types. The CLI does the rest — the checks a
schema cannot express, such as "memory must be valid *for this CPU value*" or
"an HTTPS listener you are creating needs a certificate". Run
`fargate-deployer validate` for the authoritative answer.

## Variable expansion

Any string may reference an environment variable:

```yaml
name: api-${ENVIRONMENT}
task:
  environment:
    RELEASE: ${GITHUB_SHA}
    LOG_LEVEL: ${LOG_LEVEL:-info}   # default when unset or empty
    PRICE: $${AMOUNT}               # $$ escapes; stays literal ${AMOUNT}
```

Object keys are expanded too, so `${PREFIX}_URL:` works as a variable name.

A reference to an unset variable with no default is an **error**, not an empty
string — a manifest that quietly deploys `https://api-.example.com` is worse
than one that fails. All missing variables are reported at once.

## Top level

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `kind` | ✅ | | `Service` or `ScheduledTasks`. |
| `name` | ✅ | | Base name for the ECS service, task family, log group and stack. Lowercase letters, digits and hyphens. |
| `account` | ✅ | | 12-digit AWS account ID. **Quote it** — unquoted YAML numbers lose leading zeros. |
| `region` | ✅ | | AWS region, e.g. `us-east-1`. |
| `stackName` | | `name` | CloudFormation stack name. Set it to adopt an existing stack. |
| `tags` | | `{}` | Tags applied to every resource in the stack. |

`name` is deliberately load-bearing: it becomes the service name, the task
family, `/ecs/<name>` for logs, the target group name, and the stack name. Using
`<app>-<environment>` keeps two environments in one account from colliding.

`account` and `region` are in the manifest, not the workflow, on purpose. The
file states exactly where it deploys, so a manifest cannot be pointed at the
wrong account by editing CI.

## `cluster`

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `name` | ✅ | | Name of an existing ECS cluster. |

The cluster is never created. A cluster is cheap to make once
(`aws ecs create-cluster --cluster-name my-cluster`) and shared by everything in
the account, so it belongs with the infrastructure you own.

## `network`

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `vpcId` | ✅ | | VPC the cluster and subnets belong to. |
| `subnets` | ✅ | | Subnet IDs for the tasks. Two or more availability zones for anything load balanced. |
| `securityGroups` | | *created* | Task security groups. Omit to have one created with all egress allowed and no ingress. |
| `assignPublicIp` | | `false` | Needed for public subnets with no NAT gateway, so tasks can reach ECR. |

Private subnets with a NAT gateway are the usual choice. Public subnets work if
you set `assignPublicIp: true` — without it, a task in a public subnet cannot
pull its own image and stalls in `PENDING`.

## `roles`

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `executionRoleArn` | | *created* | Pulls the image, writes logs, reads secrets. |
| `taskRoleArn` | | *created* | The permissions your application code has at runtime. |

**Omitting these is the recommended starting point.** The roles created for you
get exactly what the task needs, derived from the rest of the manifest: pull
access to the image's repository, write access to the log group, read access to
precisely the secrets in `task.secrets`, and the SSM channel permissions ECS
Exec requires.

Supply an ARN and it is imported as **immutable** — the deployer will not add
policies to a role it does not own. Two consequences worth knowing:

- The role must already allow everything the task needs, including reading each
  secret you list. A missing secret permission shows up as a task that fails to
  start with `ResourceInitializationError`.
- `service.enableExecuteCommand` will not work against an imported task role
  unless that role already has `ssmmessages:*` permissions.

You can supply one and let the other be created.

## `task`

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `cpu` | ✅ | | Fargate CPU units. `1024` = 1 vCPU. See [valid combinations](#fargate-cpu-and-memory-combinations). |
| `memory` | ✅ | | MiB. Valid range depends on `cpu`. |
| `containerPort` | for load-balanced services | | Port the container listens on. |
| `entryPoint` | | *image* | Override the image `ENTRYPOINT`. |
| `command` | | *image* | Override the image `CMD`. argv form: `["node", "dist/app.js"]`. |
| `environment` | | `{}` | Plain environment variables. Values must be strings — quote numbers. |
| `secrets` | | `{}` | Environment variables sourced from Secrets Manager or SSM. See below. |
| `logGroupName` | | `/ecs/<name>` | CloudWatch log group. |
| `logRetentionDays` | | `30` | Retention. `0` never expires. Must be a value CloudWatch accepts. |
| `retainLogsOnDelete` | | `true` | Keep logs when the stack is deleted. See the note below. |
| `stopTimeoutSeconds` | | `120` | Grace period between `SIGTERM` and `SIGKILL`. Fargate's maximum is 120. |
| `ephemeralStorageGiB` | | `20` | Task scratch space, 21–200 GiB. |
| `runtimePlatform.cpuArchitecture` | | `X86_64` | `ARM64` runs on Graviton — cheaper, but the image must be built for it. |

### Secrets

Values are ARNs, in any of three shapes:

```yaml
task:
  secrets:
    # Whole Secrets Manager value
    API_KEY: "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/api-AbCdEf"

    # One key out of a JSON Secrets Manager secret
    DATABASE_URL: "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf:url::"

    # SSM Parameter Store
    FEATURE_FLAGS: "arn:aws:ssm:us-east-1:111122223333:parameter/prod/flags"
```

> **Quote these in YAML.** An ARN ending in `::` looks like a mapping key to a
> YAML parser and fails with *"nested mappings are not allowed"*.

The trailing `:url::` form is exactly what the AWS console shows and what ECS
task definitions use natively, so you can copy either straight in. The secret
value is fetched by ECS at task start and injected as an environment variable —
it never passes through GitHub Actions and never appears in the task definition.

Secrets are referenced by full ARN, so a secret in a different account or region
works as long as its resource policy allows the execution role.

### `retainLogsOnDelete`

The default keeps the log group when the stack is deleted, so an incident
post-mortem still has the logs of the service you just tore down. The cost is
that recreating a stack under the same name fails with *"log group already
exists"*. If you create and destroy the same stack routinely — an ephemeral
preview environment, say — set `retainLogsOnDelete: false`.

## `service`

`kind: Service` only. The whole block is optional.

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `desiredCount` | | `1` | Number of tasks. |
| `minHealthyPercent` | | `100` | Lower bound during a deployment, as a percent of desired count. |
| `maxHealthyPercent` | | `200` | Upper bound during a deployment. |
| `enableExecuteCommand` | | `true` | Allows `aws ecs execute-command` — a shell in a running task. |
| `circuitBreaker` | | `true` | Roll back automatically if a deployment never stabilises. |
| `healthCheckGracePeriodSeconds` | | *none* | Ignore load balancer health checks for this long after a task starts. Raise it for slow-booting apps. |

The defaults describe a zero-downtime rolling deploy: `100`/`200` keeps the full
task count serving while new tasks come up. With `desiredCount: 1` that means
briefly running two tasks, so make sure your app tolerates that. Set
`minHealthyPercent: 0` if it cannot, and accept a gap in service.

`circuitBreaker` is the most valuable default here. Without it, a container that
crash-loops on boot leaves the deployment retrying for hours; with it, ECS gives
up and puts the previous task definition back.

## `loadBalancer`

`kind: Service` only. Omit the whole block for a worker with no inbound traffic.

You must provide **either** `listenerArn` (attach a rule to a listener that
already exists) **or** `loadBalancerArn` (create a listener on that load
balancer). The first is the common case and the cheaper one: many services share
one ALB and one HTTPS listener, each with its own host-header rule.

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `enabled` | | `true` | Set `false` to keep the block but deploy without a load balancer. |
| `listenerArn` | one of | | Existing listener to add a rule to. |
| `loadBalancerArn` | one of | | Load balancer to create a listener on. |
| `securityGroupId` | ✅ | | The **load balancer's** security group. An ingress rule is added to the task security group allowing it in. |
| `manageSecurityGroupRules` | | `true` when `securityGroupId` is set | Set `false` to manage that ingress rule yourself. |
| `listenerPort` | | `443` | Port for a listener this stack creates. |
| `listenerProtocol` | | `HTTPS` | `HTTP` or `HTTPS`, for a listener this stack creates. |
| `certificateArn` | for created HTTPS listeners | | ACM certificate. Not needed when attaching to an existing listener. |
| `targetPort` | | `task.containerPort` | Port the target group forwards to. |
| `targetProtocol` | | `HTTP` | Protocol between load balancer and container. |
| `hostHeaders` | ✅ unless `defaultAction` | | Host header(s) routed here. String or list. |
| `pathPatterns` | | | Path pattern(s), e.g. `/api/*`. Combined with `hostHeaders` using AND. |
| `priority` | | *hash of `name`* | Listener rule priority, 1–50000. |
| `defaultAction` | | `false` | Make this the listener's default action instead of adding a rule. |
| `deregistrationDelaySeconds` | | `60` | How long to drain connections from a stopping task. |
| `targetGroupName` | | *derived from `name`* | Explicit target group name, ≤32 characters. |
| `healthCheck.path` | | `/` | Path the load balancer requests. |
| `healthCheck.intervalSeconds` | | `30` | Seconds between checks. |
| `healthCheck.timeoutSeconds` | | `5` | Must be less than the interval. |
| `healthCheck.healthyThresholdCount` | | `2` | Consecutive successes before a target is healthy. |
| `healthCheck.unhealthyThresholdCount` | | `3` | Consecutive failures before it is removed. |
| `healthCheck.healthyHttpCodes` | | `200` | e.g. `200`, `200,301`, `200-399`. |

### Listener rule priority

Two rules on one listener cannot share a priority. The default is a hash of
`name`, which is stable across deploys — CloudFormation sees no diff — and
spread across the range, but not guaranteed unique against rules created by
something else. If a deploy fails with `PriorityInUse`, set `priority`
explicitly.

### `defaultAction`

Sets this service as the listener's fallback rather than adding a rule. Only one
service per listener can do it, and it cannot be combined with `hostHeaders` or
`pathPatterns`. Use it for a single service on a dedicated load balancer where
routing rules would be ceremony.

## `autoScaling`

`kind: Service` only. Omit the block entirely for a fixed task count.

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `enabled` | | `true` | Set `false` to keep the block but pin the task count. |
| `minCapacity` | | `service.desiredCount` | Floor. Clamped to `maxCapacity`. |
| `maxCapacity` | ✅ | | Ceiling. |
| `cpuTargetPercent` | | | Target average CPU utilisation. |
| `memoryTargetPercent` | | | Target average memory utilisation. |
| `requestsPerTarget` | | | Target ALB requests per task per minute. Requires a load balancer. |
| `scaleInCooldownSeconds` | | `300` | Wait after scaling in. |
| `scaleOutCooldownSeconds` | | `60` | Wait after scaling out. |

At least one target is required — without one, capacity could never change and
the block would be inert. Setting several creates several policies; Application
Auto Scaling then scales out when *any* of them asks and scales in only when
*all* of them agree, which is the behaviour you want.

The asymmetric cooldown defaults are deliberate: add capacity quickly (60s),
remove it slowly (300s), so a brief dip in traffic does not shed tasks you are
about to need again.

## `tasks`

`kind: ScheduledTasks` only. Required, at least one entry.

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `name` | ✅ | | Job name. Unique within the manifest; becomes part of the EventBridge rule name. |
| `schedule` | ✅ | | `cron(...)` or `rate(...)`. Always UTC. |
| `description` | | | Shown on the EventBridge rule. |
| `enabled` | | `true` | `false` keeps the rule but stops it firing. |
| `command` | | `task.command` | Container command for this job. |
| `cpu` / `memory` | | `task.cpu` / `task.memory` | Per-job size. Creates a second task definition. |
| `environment` | | `{}` | Merged over `task.environment` for this job only. |
| `maxEventAgeMinutes` | | | How long EventBridge keeps trying to **start** the task. Not an execution timeout. |
| `retryAttempts` | | `0` | EventBridge retries when *starting* the task fails. |

See [scheduled tasks](scheduled-tasks.md) for the details.

## Fargate CPU and memory combinations

Fargate only accepts certain pairs. The validator checks this, but here is the
table:

| `cpu` | vCPU | Valid `memory` (MiB) |
| --- | --- | --- |
| `256` | 0.25 | 512, 1024, 1536, 2048 |
| `512` | 0.5 | 1024–4096 in 1024 steps |
| `1024` | 1 | 2048–8192 in 1024 steps |
| `2048` | 2 | 4096–16384 in 1024 steps |
| `4096` | 4 | 8192–30720 in 1024 steps |
| `8192` | 8 | 16384–61440 in 4096 steps |
| `16384` | 16 | 32768–122880 in 8192 steps |

`8192` and `16384` require the Linux/X86_64 or Linux/ARM64 platform on a recent
platform version, and are not available in every region.
