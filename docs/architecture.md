# Architecture

How the pieces fit together, what ends up in AWS, and why the boundaries sit
where they do.

- [The pipeline](#the-pipeline)
- [Configuration layers](#configuration-layers)
- [What a Service stack contains](#what-a-service-stack-contains)
- [What a ScheduledTasks stack contains](#what-a-scheduledtasks-stack-contains)
- [Naming](#naming)
- [Why CDK](#why-cdk)
- [Design decisions](#design-decisions)

---

## The pipeline

```
 manifest.yaml
      │
      ▼
 ${VAR} expansion ──── missing variable? stop here
      │
      ▼
   validation ──────── bad manifest? report every problem at once
      │
      ▼
   resolution ──────── apply defaults; nothing is optional after this
      │
      ▼
   CDK synth ───────── one CloudFormation template
      │
      ▼
   cdk deploy ──────── create/update the stack
      │
      ▼
 wait for stability ── print recent service events on failure
```

Each stage runs to completion before the next begins, so a mistake is caught as
early as it can be. A typo in the manifest costs you five seconds, not a Docker
build and a rolled-back deployment.

## Configuration layers

The internal deployer this grew out of had two layers: hardcoded per-environment
platform defaults, and a small per-application manifest. That works when one
team owns both. Published, it does not — nobody else's account has your VPC.

So there is one layer. Everything account-specific is in the manifest, and the
only defaults left are properties of ECS and ELB themselves, or unambiguously
safe choices:

| Defaulted | Value | Why it is safe to default |
| --- | --- | --- |
| Log group | `/ecs/<name>` | Derived from the manifest, not the account |
| Log retention | 30 days | A cost/utility middle ground; overridable |
| Deployment bounds | 100% / 200% | Standard zero-downtime rolling deploy |
| Circuit breaker | on, with rollback | A crash-looping deploy should stop, not retry for hours |
| Health check | `/`, 30s, 5s timeout | The ELB defaults |
| Deregistration delay | 60s | Shorter than ELB's 300s default; still drains normal requests |
| Scale-out / scale-in cooldown | 60s / 300s | Add capacity fast, remove it slowly |
| Stop timeout | 120s | Fargate's maximum, so graceful shutdown gets the most room |

`resolve.ts` is the only place defaults are applied. The stacks receive a fully
resolved config and never ask "was this set?", which is why the stack code stays
short enough to read in one sitting.

## What a Service stack contains

Created and owned by the stack:

| Resource | Notes |
| --- | --- |
| `AWS::ECS::TaskDefinition` | One container, named after the manifest |
| `AWS::ECS::Service` | Rolling deployment, circuit breaker, ECS Exec |
| `AWS::Logs::LogGroup` | Retained on delete by default |
| `AWS::ElasticLoadBalancingV2::TargetGroup` | IP target type, health check |
| `AWS::ElasticLoadBalancingV2::ListenerRule` | Host header and/or path conditions |
| `AWS::EC2::SecurityGroupIngress` | Load balancer → tasks, on the target port |
| `AWS::EC2::SecurityGroup` | Only if `network.securityGroups` is omitted |
| `AWS::IAM::Role` ×2 | Only if `roles` is omitted |
| `AWS::ApplicationAutoScaling::*` | Only if `autoScaling` is present |
| `AWS::ElasticLoadBalancingV2::Listener` | Only if `loadBalancerArn` was given instead of `listenerArn` |

Referenced, never modified: the VPC, subnets, cluster, load balancer, listener,
certificate, secrets, and any IAM roles or security groups you supplied.

The default path attaches a rule to an **existing listener**. That is both the
cheap option — one ALB serves many services — and the low-permission one: no
`elasticloadbalancing:Describe*` on the load balancer is required, because
nothing looks it up.

## What a ScheduledTasks stack contains

| Resource | Notes |
| --- | --- |
| `AWS::ECS::TaskDefinition` | One per distinct cpu/memory pair, not per job |
| `AWS::Events::Rule` | One per job |
| `AWS::IAM::Role` | EventBridge's invoke role, created by CDK |
| `AWS::Logs::LogGroup` | Shared by every job |
| `AWS::IAM::Role` ×2 | Task and execution roles, if `roles` is omitted |

Per-job command and environment differences are container overrides on the rule,
which is why they cost nothing extra. See
[scheduled tasks](scheduled-tasks.md#how-many-task-definitions-you-get).

## Naming

Everything derives from the manifest `name`, so one field determines the whole
footprint and two environments never collide:

| Thing | Name |
| --- | --- |
| CloudFormation stack | `stackName`, defaulting to `name` |
| ECS service | `name` |
| Task definition family | `name` (plus `-<cpu>-<memory>` for size overrides) |
| Container | `name` |
| Log group | `/ecs/<name>` |
| Target group | `name`, truncated to 32 characters with a hash suffix if needed |
| EventBridge rule | `<name>-<job>` |
| Listener rule priority | SHA-256 of `name`, modulo 50000 |

The truncation hash matters: two services whose names share the first 26
characters would otherwise land on the same target group name and the second
deploy would fail. The priority hash is stable across deploys, so CloudFormation
sees no diff on redeploy, but it is not globally unique — set
`loadBalancer.priority` if you collide.

## Why CDK

The stack is described in TypeScript and synthesized to CloudFormation.
CloudFormation does the actual work, which buys three things worth having:

- **Rollback.** A failed deploy reverts. There is no half-applied state to
  reason about at 3am.
- **Drift-free updates.** Redeploying is a diff, not a recreate. Changing a
  health check path does not replace the service.
- **Clean teardown.** `destroy` removes exactly what the stack created and
  nothing else.

The cost is the one-time `cdk bootstrap` per account and region. That is a real
imposition on a first-time user, and it is why the action has a `bootstrap`
input — but doing it once by hand keeps the workflow's permissions much smaller.

## Design decisions

**Account and region live in the manifest, not the workflow.** A manifest states
exactly where it deploys. Nobody can point staging at production by editing a
CI variable.

**An unset `${VAR}` is an error.** Substituting an empty string turns a missing
variable into a subtly broken deploy — `https://api-.example.com`, an empty
`hostHeader`. Failing costs one CI run; the alternative costs an incident.

**Imported roles are immutable.** When you supply a role ARN, the deployer never
adds a policy to it. Silently widening a role that other things depend on is not
a favour. The cost is that you must grant secret access yourself — documented in
the [manifest reference](manifest-reference.md#roles).

**Roles and security groups are created when omitted.** The strictest position —
require every ARN — would make the first deploy hard for exactly the people who
most need a working default. Created roles get least privilege derived from the
manifest, and supplying your own is always available.

**One log group per stack, created explicitly.** Using CDK's `logRetention`
option would deploy a custom-resource Lambda to set retention, which needs extra
permissions and leaves a Lambda in the account. A plain `AWS::Logs::LogGroup`
does the same job.

**`kind` in the manifest, not a separate action.** The internal version had two
CLIs and two reusable workflows for services and scheduled tasks; they drifted.
One self-describing manifest keeps the shared behaviour genuinely shared.
