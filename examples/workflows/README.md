# Example workflows

Copy one into your application repository as `.github/workflows/deploy.yml` and
adjust the manifest path, account ID and secret names.

| File | What it shows |
| --- | --- |
| [`deploy.yml`](deploy.yml) | The smallest useful workflow: deploy on push to `main` using OIDC. **Start here.** |
| [`iam-access-keys.yml`](iam-access-keys.yml) | Static IAM access keys instead of OIDC, deploying a single staging environment. |
| [`deploy-multi-environment.yml`](deploy-multi-environment.yml) | Development then production, promoting the exact image rather than rebuilding it. |
| [`pull-request-diff.yml`](pull-request-diff.yml) | Post the CloudFormation diff as a pull request comment, using a read-only role. |
| [`scheduled-tasks.yml`](scheduled-tasks.yml) | Deploying a `kind: ScheduledTasks` manifest. |
| [`reusable-workflow-with-secrets.yml`](reusable-workflow-with-secrets.yml) | Calling the `workflow_call` wrapper, where AWS credentials arrive in a `secrets:` block. |

## Which credential style?

Prefer OIDC (`role-to-assume`) — nothing long-lived is stored, and the role's
trust policy pins which repository and branch may assume it. See
[`docs/aws-setup.md`](../../docs/aws-setup.md).

Reach for access keys only when OIDC is not available: an account without the
GitHub identity provider, a runner outside GitHub's network, or an in-flight
migration. `iam-access-keys.yml` covers that case.
