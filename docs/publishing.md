# Publishing to the GitHub Actions Marketplace

Notes for the maintainer. Everything here is a one-time setup, except
[cutting a release](#cutting-a-release).

- [Before the first publish](#before-the-first-publish)
  - [Create the repository](#create-the-repository)
- [Marketplace listing](#marketplace-listing)
- [Cutting a release](#cutting-a-release)
- [Version tags](#version-tags)
- [Publishing to npm](#publishing-to-npm)

---

## Before the first publish

### Create the repository

Everything is written against `futuremoney/fargate-deployer` — the README badge,
the `uses:` lines in the docs and example workflows, the JSON Schema `$id`, and
the URL printed at the bottom of a validation error. Create the repository under
that exact path and none of it needs touching.

If the namespace ever changes, this finds every reference:

```bash
grep -rl 'futuremoney/fargate-deployer' . --exclude-dir=node_modules --exclude-dir=.git \
  | xargs sed -i '' 's|futuremoney/fargate-deployer|new-org/fargate-deployer|g'
```

Use `sed -i` without the `''` on Linux.

### Requirements the Marketplace enforces

| Requirement | Where |
| --- | --- |
| `action.yml` at the repository root | ✅ present |
| `name` unique across the whole Marketplace | ✅ searched — "Fargate Deployer" was free as of the first release |
| `description` and `author` | ✅ present |
| `branding.icon` and `branding.color` from GitHub's allowed set | ✅ `upload-cloud` / `orange` |
| A `README.md` | ✅ present |
| A licence | ✅ MIT |
| The repository is public | Set when you create it |
| Two-factor authentication on the publishing account | Account settings |

Only the root `action.yml` is listed. Reusable workflows cannot be published to
the Marketplace at all — that is why this repository is built around an action
rather than the `workflow_call` files it replaces.

If "Fargate Deployer" is taken, the `name:` in `action.yml` is the only thing
that has to change; the repository name and `uses:` path are independent of it.

## Marketplace listing

1. Push a release tag (see below). GitHub shows a *"Publish this Action to the
   GitHub Marketplace"* banner on the repository home page and on the release.
2. Open the banner, accept the Marketplace terms.
3. Pick categories — **Deployment** as the primary, **Continuous integration**
   or **Utilities** as the secondary.
4. Select the release to publish. GitHub validates `action.yml`, the icon and
   colour, and the uniqueness of the name.
5. Publish.

Later releases can be published to the Marketplace from the release page
directly. The listing shows the latest published release, but users can pin any
tag.

### Badges

The CI badge in the README returns 404 while the repository is private — GitHub
serves it only to principals who can read the repository — and also before the
workflow's first run. Both resolve themselves; nothing to fix.

Two more are worth adding once the corresponding thing is live. Holding them
until then avoids shipping a README with broken images:

```markdown
[![npm](https://img.shields.io/npm/v/fargate-deployer)](https://www.npmjs.com/package/fargate-deployer)
[![Marketplace](https://img.shields.io/badge/marketplace-Fargate%20Deployer-2088FF?logo=github)](https://github.com/marketplace/actions/fargate-deployer)
```

### Making the listing land well

- The first paragraph of the README is what people skim. It says what the action
  does and shows the smallest possible usage — keep it that way.
- Add repository topics: `aws`, `ecs`, `fargate`, `deployment`, `cdk`,
  `github-actions`, `devops`.
- Set the repository description to the same one-liner as `action.yml`.

## Cutting a release

`dist/` is gitignored on `main`, so pull requests never carry build artefacts.
Released tags need it, because a consumer running
`uses: futuremoney/fargate-deployer@v1` gets a plain checkout with no build step.
[`.github/workflows/release.yml`](../.github/workflows/release.yml) handles
that.

```bash
# 1. Bump the version and update the changelog
npm version minor --no-git-tag-version
$EDITOR CHANGELOG.md

# 2. Commit and tag
git commit -am "Release v1.1.0"
git tag v1.1.0
git push origin main v1.1.0
```

The release workflow then typechecks, tests, builds, verifies the tag matches
`package.json`, commits `dist/`, and force-moves both `v1.1.0` and `v1` onto
that commit.

Finally, create a GitHub release from the tag and publish it to the Marketplace.

## Version tags

Three references, three audiences:

| Ref | Moves | For |
| --- | --- | --- |
| `@v1` | Yes, on every `v1.x.y` release | Most users. Bug fixes and features, no breaking changes |
| `@v1.2.3` | Never | Users who pin exactly |
| `@<sha>` | Never | Users with a supply-chain policy requiring immutable refs |
| `@main` | Continuously | Nobody. It has no `dist/`, so the action builds from source on every run |

Follow semver strictly — `@v1` moving under someone is only acceptable if it
cannot break them. Removing a manifest field, changing a default in a way that
alters deployed infrastructure, or renaming an action input are all major
changes.

Note that changing a *default* is more disruptive here than in most libraries: a
different default health check interval means a real CloudFormation diff on
every consumer's next deploy.

## Publishing to npm

**The action does not need npm** — it runs from the `dist/` committed on the
release tag. But the CLI does, and the docs use it in a dozen places:

```bash
npx fargate-deployer validate --manifest deploy/production.yaml
npx fargate-deployer diff --manifest deploy/production.yaml --image my-image:tag
```

`npx` resolves from the npm registry, not from GitHub. Making the repository
public does nothing for those commands — without an npm publish they fail with
`404 Not Found`.

### The first publish has to be manual

npm's trusted publishing is configured *on a package*, so the package has to
exist before you can configure it. New packages therefore have a chicken-and-egg
problem, and the only way through it is one manual publish from a terminal:

```bash
npm login          # your normal account, 2FA and all
npm run build
npm publish --access public
```

This is also the answer to *"There are security risks with this option. For
automation or CI/CD uses, please use Trusted Publishing instead."* — that warning
appears when creating a long-lived automation token. You do not need one. A
manual publish uses your interactive login, and every publish after this one uses
OIDC.

> `publishConfig` deliberately does **not** set `provenance: true`. Provenance can
> only be generated inside supported CI, so enabling it there would make this
> manual publish fail. Trusted publishing attaches provenance by itself.

### Then configure trusted publishing

On npmjs.com, open the package → Settings → **Trusted Publisher** → GitHub
Actions, and fill in:

| Field | Value |
| --- | --- |
| Organization or user | `futuremoney` |
| Repository | `fargate-deployer` |
| Workflow filename | `release.yml` |
| Environment | *(leave empty)* |
| Allowed actions | `npm publish` |

The workflow filename must match exactly — OIDC claims include the workflow path,
and a mismatch is rejected with an authentication error rather than a helpful one.

### That is the whole setup

There is nothing to configure on the GitHub side — no secret, no variable.
Once the trusted publisher is registered,
[`release.yml`](../.github/workflows/release.yml) publishes on every tag. It:

- upgrades npm first, because `setup-node` still ships npm 10.x and trusted
  publishing needs 11.5.1 or later (the job also runs Node 22, which is the
  documented minimum);
- checks whether the version is already on the registry and exits cleanly if so,
  so re-running a release does not fail;
- passes no `--provenance` flag, because trusted publishing attaches the
  attestation on its own;
- needs `id-token: write`, which is already declared.

No token is stored anywhere, and nothing expires.

The step is deliberately ungated. An earlier version made it opt-in through a
repository variable, which meant a misconfiguration showed up as a *skipped*
step and a release that quietly never reached npm. A failure to publish should
turn the release red.

### If you decide not to publish

Rewrite the `npx fargate-deployer …` examples. The closest working substitute
runs straight from a release tag, which carries a prebuilt `dist/`:

```bash
npx github:futuremoney/fargate-deployer#v1 validate --manifest deploy/production.yaml
```

That works but installs the whole dependency tree — including `aws-cdk-lib` — on
each invocation, so it is noticeably slower than a registry install.
