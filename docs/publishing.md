# Publishing to the GitHub Actions Marketplace

Notes for the maintainer. Everything here is a one-time setup, except
[cutting a release](#cutting-a-release).

- [Before the first publish](#before-the-first-publish)
  - [Create the repository](#create-the-repository)
- [Marketplace listing](#marketplace-listing)
- [Cutting a release](#cutting-a-release)
- [Version tags](#version-tags)
- [Publishing to npm as well](#publishing-to-npm-as-well)

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
| `name` unique across the whole Marketplace | Check before publishing — "Fargate Deployer" may be taken |
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

## Publishing to npm as well

The package is set up to publish (`main`, `types`, `bin`, `files`) so people can
use the CLI directly with `npx fargate-deployer` or import the constructs into
their own CDK app. This is optional — the action works without it.

```bash
npm publish --access public
```

If you skip npm, remove the `npx fargate-deployer` examples from the README and
the docs, or reword them to use `node dist/bin/cli.js` from a checkout.
