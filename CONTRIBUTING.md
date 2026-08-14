# Contributing

Thanks for taking a look. Bug reports, manifest fields you need, and
documentation fixes are all welcome.

## Getting set up

```bash
git clone https://github.com/futuremoney/fargate-deployer
cd fargate-deployer
npm install
npm test
```

No AWS account or credentials are needed to develop or test — the suite
synthesizes CloudFormation templates in-process and asserts on them.

```bash
npm test           # jest
npm run typecheck  # tsc --noEmit
npm run build      # compile to dist/
```

Try the CLI against the bundled examples:

```bash
npm run build
node dist/bin/cli.js validate --manifest examples/service-full.yaml
```

## Layout

```
action.yml              The Marketplace action. Composite; calls the CLI.
src/
  bin/cli.ts            The CLI. Everything the action does goes through it.
  bin/cdk-app.ts        CDK app entry, invoked by the CLI via `cdk --app`.
  lib/
    types.ts            Manifest types (input) and Resolved types (output).
    interpolate.ts      ${VAR} expansion.
    validate.ts         Validation. Collects every problem, then throws.
    resolve.ts          Defaults. The only place they are applied.
    base.ts             Shared: VPC, cluster, roles, task definitions.
    service-stack.ts    kind: Service
    scheduled-tasks-stack.ts   kind: ScheduledTasks
    secrets.ts          Secrets Manager / SSM ARN handling.
    image.ts            Image URI → CDK container image.
schema/                 JSON Schema, for editors.
examples/               Manifests and workflows. Every one is tested.
docs/                   Reference documentation.
```

The pipeline is strictly one-directional: parse → expand → validate → resolve →
synth. Each stage may assume the previous one succeeded, which is why the stack
code has so few conditionals.

## Adding a manifest field

Five places, in this order:

1. **`src/lib/types.ts`** — the optional field on the `*Manifest` interface, and
   the non-optional one on the matching `Resolved*` interface if it has a
   default.
2. **`src/lib/validate.ts`** — a check. Include a `hint` saying what to do
   instead; that hint is the whole point of the error.
3. **`src/lib/resolve.ts`** — the default, if there is one.
4. **The stack** — use it.
5. **`schema/manifest.schema.json`** — so editors know about it.

Then documentation and tests:

- A row in the table in [`docs/manifest-reference.md`](docs/manifest-reference.md).
- A validation test in `test/validate.test.ts` (what is rejected, and why).
- A synth test in `test/synth.test.ts` (what appears in the template).
- If it is interesting, a line in an example — `test/synth.test.ts` synthesizes
  every example, so they cannot rot.

### What belongs in a default

A default is fine when it is a property of ECS, ELB or EventBridge, or an
unambiguously safe choice. A default is **not** fine when it is a property of
somebody's particular AWS account — that is the mistake this project exists to
undo. If a value could differ between two organisations, it belongs in the
manifest.

### Error messages

Validation errors are read by people who have never seen this codebase and are
trying to deploy something. Say the field, say what is wrong, say what to do:

```ts
issues.add(
  'loadBalancer.certificateArn',
  'is required to create an HTTPS listener',
  'Either give an ACM certificate ARN, set `listenerProtocol: HTTP`, or attach ' +
    'to an existing listener with `listenerArn` (its certificate is used instead).',
);
```

Never throw on the first problem — append to the collector so one run reports
everything.

## Pull requests

- One change per pull request.
- `npm test` and `npm run typecheck` pass.
- New behaviour has a test.
- User-visible changes update the docs in the same pull request.
- Add a line to `CHANGELOG.md` under *Unreleased*.

## Compatibility

`@v1` moves on every `v1.x.y` release, so anything that changes a consumer's
deployed infrastructure is a breaking change — including changing a default.
A different default health check interval produces a real CloudFormation diff on
everybody's next deploy. When in doubt, add an opt-in field rather than changing
what happens by default.

## Releasing

See [`docs/publishing.md`](docs/publishing.md).
