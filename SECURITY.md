# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's [private vulnerability reporting](https://github.com/futuremoney/fargate-deployer/security/advisories/new)
(Security → Report a vulnerability). It notifies the maintainers privately and
keeps the report hidden until a fix ships.

If you cannot use it, open a public issue asking for a private channel — with no
details of the vulnerability itself — and a maintainer will follow up.

Please include the version or tag, a description of the impact, and the smallest
manifest or workflow that reproduces it. You will get an acknowledgement within
three working days and an assessment within ten.

## Supported versions

| Version | Supported |
| --- | --- |
| `v1.x` | ✅ |
| `< v1` | ❌ |

Fixes land on the latest minor of the supported major, and `@v1` is moved to
point at them.

## What this action can do, by design

Worth understanding before assessing a report — some of this looks alarming but
is the intended contract:

- **It runs with your AWS credentials.** A workflow that can run this action can
  deploy to whatever its role permits. The role, not the action, is the security
  boundary — see [docs/aws-setup.md](docs/aws-setup.md) for a least-privilege
  policy.
- **The manifest is trusted input.** It is read from your repository and can name
  any cluster, subnet, role or secret ARN the deploy role can reach. Treat a pull
  request that edits a manifest exactly as you would treat one that edits a
  workflow file.
- **`${VAR}` expansion reads the process environment.** A manifest can therefore
  interpolate any environment variable present in the job. It cannot read files
  or run commands.
- **Secrets are passed by ARN, never by value.** The manifest holds references;
  ECS resolves them at task start. Secret *values* never pass through the action,
  the CloudFormation template, or the logs.
- **It shells out to the CDK CLI**, which assumes your account's CDK bootstrap
  roles. Those roles are typically privileged. This is ordinary CDK behaviour.

## Things that would be vulnerabilities

- A secret value appearing in logs, the job summary, a CloudFormation template,
  or an action output.
- A manifest value escaping into a shell command, a CloudFormation resource, or
  an IAM policy in a way its author did not intend.
- The action reaching AWS resources outside those named in the manifest.
- A created IAM role receiving permissions beyond what the manifest's task needs.
- Any path by which a fork's pull request could obtain credentials.

## Pull requests from forks

The example workflows use `pull_request`, which does **not** expose secrets to a
fork. If you adapt one to `pull_request_target` — which does — you take on the
responsibility of never checking out or executing the fork's code.

## Supply chain

`dist/` is committed on release tags so consumers need no build step. It is built
in CI by [`release.yml`](.github/workflows/release.yml) from the tagged source,
never committed by hand, and its provenance is the release workflow run.

Third-party actions are pinned to major version tags. If your threat model needs
immutable references, pin this action by commit SHA:

```yaml
uses: futuremoney/fargate-deployer@<full-40-char-sha>
```
