## What and why

<!-- What changes, and what problem it solves. -->

## Checklist

- [ ] `npm test` and `npm run typecheck` pass
- [ ] New behaviour has a test
- [ ] Docs updated ([manifest reference](../docs/manifest-reference.md) for a new
      field, [README](../README.md) for a new action input or output)
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`

## Compatibility

`@v1` moves on every `v1.x.y` release, so anything below needs a major bump —
tick any that apply, or state that none do:

- [ ] Removes or renames a manifest field, action input, or action output
- [ ] Changes a **default**, which produces a CloudFormation diff on every
      consumer's next deploy
- [ ] Changes which AWS resources are created, replaced, or deleted
- [ ] Requires a new IAM permission on the deploy role

<!-- If none apply, say so: "No compatibility impact." -->
