# Scheduled tasks

`kind: ScheduledTasks` deploys cron jobs: one EventBridge rule per job, each
starting a Fargate task that runs to completion and exits.

Everything else works the same as a service — the same manifest fields for
cluster, network, roles, image and secrets; the same action; the same CLI.

- [A complete manifest](#a-complete-manifest)
- [Schedule expressions](#schedule-expressions)
- [Per-job overrides](#per-job-overrides)
- [How many task definitions you get](#how-many-task-definitions-you-get)
- [Disabling a job](#disabling-a-job)
- [Retries and `maxEventAgeMinutes`](#retries-and-maxeventageminutes)
- [Running a job by hand](#running-a-job-by-hand)
- [Watching jobs](#watching-jobs)

---

## A complete manifest

```yaml
kind: ScheduledTasks
name: data-sync
account: "111122223333"
region: us-east-1

cluster:
  name: production

network:
  vpcId: vpc-0abc123def4567890
  subnets:
    - subnet-0abc123def4567890
    - subnet-0fed987cba6543210

task:
  cpu: 256
  memory: 512
  environment:
    NODE_ENV: production
  secrets:
    DATABASE_URL: "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf:url::"

tasks:
  - name: balances-sync
    description: Pull account balances from the custodian
    schedule: cron(0 6 * * ? *)
    command: ["node", "dist/jobs/balances-sync.js"]

  - name: hourly-prices
    schedule: rate(1 hour)
    command: ["node", "dist/jobs/prices.js"]

  - name: heavy-reconcile
    schedule: cron(0 3 ? * SUN *)
    command: ["node", "dist/jobs/reconcile.js"]
    cpu: 1024
    memory: 4096
    environment:
      BATCH_SIZE: "500"
    maxEventAgeMinutes: 60
```

## Schedule expressions

**All schedules are UTC.** EventBridge has no time zone concept for rules, so a
job that must run at 06:00 local time needs a different expression in summer and
winter. Pick a UTC time and live with the drift, or run hourly and let the job
decide.

### `rate(...)`

```
rate(5 minutes)   rate(1 hour)   rate(7 days)
```

Singular for 1, plural above. The first run happens roughly when the rule is
created, not on a boundary — `rate(1 hour)` deployed at 14:37 fires at ~15:37.

### `cron(...)`

Six fields, **not** the five of Unix cron:

```
cron(minutes hours day-of-month month day-of-week year)
```

Exactly one of day-of-month and day-of-week must be `?` — you cannot constrain
both.

| Expression | Meaning |
| --- | --- |
| `cron(0 6 * * ? *)` | 06:00 UTC daily |
| `cron(30 2 * * ? *)` | 02:30 UTC daily |
| `cron(0 3 ? * SUN *)` | 03:00 UTC on Sundays |
| `cron(0 0 1 * ? *)` | Midnight UTC on the first of each month |
| `cron(*/15 * * * ? *)` | Every 15 minutes |
| `cron(0 9-17 ? * MON-FRI *)` | Hourly, 09:00–17:00 UTC, weekdays |

`cron(0 6 * * *)` — the Unix five-field form — is rejected by the validator
before it reaches AWS.

## Per-job overrides

Each entry inherits from the shared `task` block and may override:

| Field | Effect |
| --- | --- |
| `command` | Container command for this job. Most jobs set this. |
| `environment` | Merged **over** `task.environment`, for this job only. |
| `cpu` / `memory` | Task size. Creates a second task definition — see below. |
| `enabled` | `false` keeps the rule and stops it firing. |
| `maxEventAgeMinutes` | How long EventBridge keeps trying to start the task. |
| `retryAttempts` | Retries when *starting* the task fails. |

Anything not listed — image, secrets, log group, roles, network — is shared by
every job in the manifest.

## How many task definitions you get

CPU and memory are properties of a *task definition*, not of the call that
starts a task. So:

- Every job using the manifest's default `cpu`/`memory` shares **one** task
  definition, and differs only by container overrides on its rule.
- Every distinct `cpu`/`memory` pair gets its own, with a family name of
  `<name>-<cpu>-<memory>`.

In the example above that is two: `data-sync` and `data-sync-1024-4096`.

Command and environment differences never cost you a task definition — they ride
along as per-rule container overrides. The deployer only sends an override where
a job genuinely differs from the shared configuration, so a rule for a job that
adds nothing carries no override block at all.

## Disabling a job

```yaml
- name: legacy-export
  schedule: cron(30 2 * * ? *)
  enabled: false
```

The rule stays in place with `State: DISABLED`, so the schedule and history are
preserved and re-enabling is a one-line change. Deleting the entry removes the
rule.

## Retries and `maxEventAgeMinutes`

Both apply to EventBridge **starting** the task, not to the task's own run:

- `retryAttempts` (default `0`) — retries when the `RunTask` call fails, for
  instance because the cluster briefly has no capacity.
- `maxEventAgeMinutes` — how long EventBridge keeps trying before giving up.

Neither will stop a task that has started. A job that hangs runs until it exits
or you stop it. If a job must not overrun, enforce that inside the job — a
watchdog timer that exits non-zero.

Overlap is not prevented either. `rate(1 hour)` on a job that takes 90 minutes
gives you two copies running. Guard with an advisory lock in your datastore if
that matters.

## Running a job by hand

Useful for testing a new job without waiting for its schedule:

```bash
aws events list-rules --name-prefix data-sync

aws ecs run-task \
  --cluster production \
  --task-definition data-sync \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-0abc123def4567890],securityGroups=[sg-0abc123def4567890]}' \
  --overrides '{"containerOverrides":[{"name":"data-sync","command":["node","dist/jobs/balances-sync.js"]}]}'
```

The container name matches the manifest `name`.

## Watching jobs

All jobs write to one log group, `/ecs/<name>` by default, with a stream per
task:

```bash
aws logs tail /ecs/data-sync --follow
```

EventBridge does not alarm on a job that fails — the rule succeeded, it started
the task. To catch failures, alarm on the ECS task state-change event with a
non-zero exit code, or have the job report its own success to CloudWatch.
