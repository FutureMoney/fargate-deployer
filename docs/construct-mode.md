# Construct mode: using this inside your own CDK app

Two ways to deploy the same stacks:

| | **CLI mode** | **Construct mode** |
| --- | --- | --- |
| Use when | The repository has a Dockerfile and a manifest, and no CDK of its own | The repository already owns CDK infrastructure |
| Deploys via | The action, or `npx fargate-deployer deploy` | Your own `cdk deploy --all` |
| The package is | Run by CI; nothing in your `package.json` | A dependency you `import` |
| Image comes from | The action builds and pushes it | Whatever you already use |

- [Why it exists](#why-it-exists)
- [The shape](#the-shape)
- [Wiring your resources into the service](#wiring-your-resources-into-the-service)
- [Building the image](#building-the-image)
- [What is exported](#what-is-exported)
- [Things to know](#things-to-know)

---

## Why it exists

**The CLI synthesises its own single-stack app.** It creates one `cdk.App`, adds
one stack to it, and deploys that. If your repository has other stacks — a
queue, a bucket, a table — the CLI never sees them. They simply do not deploy,
and nothing warns you.

That is the whole reason for construct mode: import the stack into the app you
already have, so one `cdk deploy --all` covers everything and CloudFormation
sequences it for you.

## The shape

```ts
import * as cdk from 'aws-cdk-lib';
import { createStack, loadManifest } from 'fargate-deployer';

const app = new cdk.App();

// Your own infrastructure, unchanged.
const infra = new MyInfraStack(app, 'my-infra');

// The service, from the same manifest CI would use.
createStack({
  app,
  config: loadManifest('deploy/production.yaml'),
  image: process.env.IMAGE!,
});
```

```bash
cdk deploy --all
```

`createStack` adds a **sibling stack** to your app. It does not nest inside one
of your stacks — `FargateServiceStack` extends `cdk.Stack`, so it cannot be
instantiated in another stack's scope. In practice that is what you want: the
service has its own lifecycle and tears down cleanly on its own.

## Wiring your resources into the service

This is the part CLI mode cannot do. `loadManifest` returns a plain object, so
anything CDK owns can be patched in before the stack is built:

```ts
const config = loadManifest('deploy/production.yaml');

config.task.environment.QUEUE_URL = infra.queue.queueUrl;
config.task.environment.TABLE_NAME = infra.table.tableName;
config.roles.taskRoleArn = infra.taskRole.roleArn;

createStack({ app, config, image: process.env.IMAGE! });
```

Those values are CDK tokens, not strings, and CDK resolves them at synth time
into a cross-stack reference:

```json
"Environment": [
  { "Name": "QUEUE_URL",
    "Value": { "Fn::ImportValue": "my-infra:ExportsOutputRefJobs..." } }
]
```

CloudFormation then creates the export on your stack, the import on the
service's, and a dependency between them — so deploy order is correct and your
queue cannot be deleted while the service still references it.

The manifest carries the forty lines that are the same every time; TypeScript
carries the parts that have to reference real resources.

> Note the split of responsibilities for secrets. `task.secrets` takes **ARNs**,
> and ECS resolves them when the task starts — so a secret created in your own
> stack is wired as `config.task.secrets.FOO = mySecret.secretArn`, not by
> reading its value.

## Building the image

Construct mode does not build anything — `image` is a URI you supply. If you
already push to ECR in CI, pass that tag through:

```yaml
- id: build
  uses: docker/build-push-action@v7
  with:
    push: true
    tags: ${{ steps.ecr.outputs.registry }}/api:${{ github.sha }}

- run: npx cdk deploy --all
  env:
    IMAGE: ${{ steps.ecr.outputs.registry }}/api:${{ github.sha }}
```

Any registry works, not only ECR — see
[the image section of the manifest reference](manifest-reference.md).

## What is exported

```ts
import {
  createStack,          // add a stack for a resolved manifest to an app
  loadManifest,         // read + expand ${VAR} + validate + apply defaults
  validateManifest,     // validate a parsed object, no defaults applied
  resolveManifest,      // apply defaults to a validated manifest
  FargateServiceStack,  // the stacks themselves, if you want them directly
  ScheduledTasksStack,
  buildSecrets,         // { NAME: arn } -> ecs.Secret, the same parsing
  containerImage,       // image URI -> ecs.ContainerImage
} from 'fargate-deployer';
```

Using a stack directly, rather than through `createStack`:

```ts
new FargateServiceStack(app, 'api-production', {
  env: { account: config.account, region: config.region },
  config,                        // must be kind: 'Service'
  image: process.env.IMAGE!,
});
```

`createStack` only adds the stack name, environment, tags and description around
this, and picks the right class for the manifest's `kind`.

## Things to know

- **Both modes need `cdk bootstrap`.** Construct mode does not avoid it.
- **`${VAR}` expansion still applies.** `loadManifest` expands against
  `process.env`, so `RELEASE_SHA: ${GITHUB_SHA}` works the same as in CI.
- **Validation still applies**, and throws `ManifestError` with the same field
  paths and hints the CLI prints.
- **Skip `loadManifest` entirely** if you would rather not keep a YAML file:
  build a `ResolvedConfig` in TypeScript and hand it to `createStack`. You lose
  the validation, so prefer a manifest unless you have a reason.
- **`cdk diff` shows the service alongside your own resources**, which is the
  main day-to-day benefit of having them in one app.
