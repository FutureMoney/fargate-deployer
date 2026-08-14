# Troubleshooting

Failures grouped by where they happen, with what each one actually means.

- [Manifest errors](#manifest-errors)
- [Deployment errors](#deployment-errors)
- [Tasks that will not start](#tasks-that-will-not-start)
- [Load balancer problems](#load-balancer-problems)
- [Scheduled task problems](#scheduled-task-problems)
- [Getting more detail](#getting-more-detail)

---

## Manifest errors

### `Nested mappings are not allowed in compact mappings`

A Secrets Manager ARN ending in `::` looks like a YAML mapping key. Quote it:

```yaml
# wrong
DATABASE_URL: arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf:url::

# right
DATABASE_URL: "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf:url::"
```

### `account: must be a 12-digit AWS account ID as a string`

YAML parsed it as a number. Quote it — and note that an account ID with a
leading zero silently loses it if you do not.

### `task.environment.PORT: must be a string, got number`

Container environment values are always strings. `PORT: "8080"`.

### `Manifest references environment variables that are not set`

A `${VAR}` in the manifest has no value. Either export it, or give a default:
`${LOG_LEVEL:-info}`.

### `loadBalancer.securityGroupId: is required so the ALB can reach your tasks`

Without it, the deployer cannot open the task security group to the load
balancer, and every target would fail its health check. Supply the load
balancer's security group, or set `manageSecurityGroupRules: false` if you
maintain that rule yourself.

## Deployment errors

### `This stack uses assets, so the toolkit stack must be deployed`

The account and region are not bootstrapped:

```bash
npx cdk bootstrap aws://111122223333/us-east-1
```

### `Need to perform AWS calls for account ..., but no credentials have been configured`

The workflow did not authenticate. Check that:

- the job has `permissions: id-token: write` (required for OIDC);
- the trust policy's `sub` condition matches the repository *and* the ref that
  is running — a tag push does not match `refs/heads/main`;
- `role-to-assume` is the role ARN, not the OIDC provider ARN.

### `User is not authorized to perform sts:AssumeRole on resource cdk-hnb659fds-...`

The deploy role cannot assume the bootstrap roles. See
[aws-setup.md](aws-setup.md#permissions-policy). If you bootstrapped with a
custom `--qualifier`, the `hnb659fds` in the policy needs replacing.

### `Priority 'NNNNN' is currently in use` / `PriorityInUse`

Two listener rules want the same priority. The default is a hash of the service
name, which is stable but not globally unique. Set one explicitly:

```yaml
loadBalancer:
  priority: 150
```

### `Target group name 'x' already exists`

Target group names are unique per account and region, and two services whose
names share a long prefix can collide after truncation. Set
`loadBalancer.targetGroupName` explicitly.

### `Log group already exists`

A previous stack was destroyed but its log group was retained. Either delete it,
point `task.logGroupName` somewhere new, or set `task.retainLogsOnDelete: false`
so it goes away next time.

### `Resource is not in the state stackUpdateComplete` / stack stuck in `UPDATE_ROLLBACK_FAILED`

CloudFormation could not roll back cleanly. In the console, choose *Stack
actions → Continue update rollback*, skipping the resource that is stuck, then
deploy again.

### The deploy succeeds but nothing changed

Only the image tag changed and you deployed the same tag twice — the template is
identical, so CloudFormation does nothing. Tag with the commit SHA (the
default), not `latest`.

## Tasks that will not start

Start here:

```bash
aws ecs describe-services --cluster my-cluster --services my-service \
  --query 'services[0].events[0:10].[createdAt,message]' --output text

aws ecs describe-tasks --cluster my-cluster \
  --tasks $(aws ecs list-tasks --cluster my-cluster --service-name my-service \
    --desired-status STOPPED --query 'taskArns[0]' --output text) \
  --query 'tasks[0].[stoppedReason,containers[0].reason]' --output text
```

### `CannotPullContainerError`

The task cannot reach ECR. Almost always networking:

- private subnets need a NAT gateway, or VPC endpoints for `ecr.api`, `ecr.dkr`,
  `s3` and `logs`;
- public subnets need `network.assignPublicIp: true`;
- a supplied execution role may lack ECR pull permission. Omit `roles` and let
  the deployer create one, or add `AmazonECSTaskExecutionRolePolicy`.

### `ResourceInitializationError: unable to pull secrets or registry auth`

The execution role cannot read a secret in `task.secrets`, or cannot reach
Secrets Manager. Check the ARN is exact — including the six-character suffix —
and that a supplied execution role has `secretsmanager:GetSecretValue` on it.
Roles created by the deployer get this automatically.

### `Essential container in task exited`

The application crashed. Read the logs:

```bash
aws logs tail /ecs/my-service --follow --since 10m
```

### Tasks start, then are killed a minute later

They are failing the load balancer health check. See below.

### `exec format error`

The image architecture does not match the task. Building on an Apple Silicon
machine produces `arm64`; the default task platform is `X86_64`. Either set
`task.runtimePlatform.cpuArchitecture: ARM64` — cheaper, and the action then
builds for arm64 automatically — or build with `--platform linux/amd64`.

## Load balancer problems

### Targets are `unhealthy`

In order of likelihood:

1. **The health check path 404s.** The default is `/`. Set
   `loadBalancer.healthCheck.path` to something your app actually serves.
2. **The app is slow to boot.** Set
   `service.healthCheckGracePeriodSeconds: 60` or more.
3. **The security group is wrong.** `loadBalancer.securityGroupId` must be the
   *load balancer's* group, not the tasks'.
4. **Wrong port.** `targetPort` must be the port the container listens on, and
   the app must bind `0.0.0.0`, not `127.0.0.1`.
5. **A non-200 response.** A health endpoint returning 204 or a redirect needs
   `healthCheck.healthyHttpCodes: "200-399"`.

### 503 from the load balancer

No healthy target for the rule. Either the above, or the rule matches a host
header no service is serving.

### The rule never matches

Host header conditions are exact (with `*` wildcards). `api.example.com` does
not match `www.api.example.com`. Check the rule in the console, and check
whether a lower-numbered priority rule is catching the request first.

## Scheduled task problems

### The rule never fires

- Schedules are **UTC**. `cron(0 6 * * ? *)` is 06:00 UTC.
- EventBridge cron has six fields; a five-field Unix expression is rejected by
  the validator, so if you got this far the syntax is valid.
- Check the rule is enabled: `aws events describe-rule --name my-app-my-job`.

### The rule fires but no task runs

```bash
aws events describe-rule --name my-app-my-job
aws logs tail /ecs/my-app --since 1h
```

Common causes are the same as any task that will not start — image pull,
secrets, subnets. `FailedInvocations` on the rule's CloudWatch metrics confirms
EventBridge could not start the task at all.

### Two copies of a job are running

EventBridge does not prevent overlap. If a job can outrun its schedule, guard it
with a lock in your datastore.

## Getting more detail

```bash
# Check a manifest without touching AWS
npx fargate-deployer validate --manifest deploy/production.yaml

# See exactly what would change
npx fargate-deployer diff --manifest deploy/production.yaml --image my-image:tag

# Print the generated CloudFormation
npx fargate-deployer synth --manifest deploy/production.yaml --image my-image:tag

# Verbose CDK output
npx fargate-deployer deploy -m deploy/production.yaml -i my-image:tag -- --verbose
```

In a workflow, pass CDK flags through:

```yaml
- uses: futuremoney/fargate-deployer@v1
  with:
    manifest: deploy/production.yaml
    cdk-args: --verbose
```

Still stuck? Open an issue with the manifest (secrets redacted), the failing
step's log, and the output of `fargate-deployer validate`.
