# Releasing

Day to day: add a changeset (`npx changeset`) with each user-facing change. On every push to `main` the **Release**
workflow opens or updates a "Version Packages" pull request. Merging it publishes to npm with provenance
(authenticated by npm trusted publishing, no token), then publishes the same version to GitHub Packages (using the
workflow's `GITHUB_TOKEN`; the step skips versions already there, so a failed run is retried on the next push).

## Publishing by hand

Normally only the Release workflow publishes. If you ever need to publish from your machine (as for 0.2.0, see
below), note that the user-level npm config maps `@furnas-technology` to GitHub Packages, so override the scope
registry explicitly. Provenance can only be generated in CI.

```sh
npm login --registry=https://registry.npmjs.org
npm publish --provenance=false --@furnas-technology:registry=https://registry.npmjs.org
```

Changesets only creates the `vX.Y.Z` tag and GitHub release when it publishes, so after a manual publish create them
yourself on the "chore: version packages" commit (`git tag -a vX.Y.Z <sha>`, push, `gh release create`), with that
version's CHANGELOG section as the notes. Re-running the Release job then mirrors the version to GitHub Packages.

## History: rename from `@furnas-technology/timeline` (done, 0.2.0)

0.1.0 was published as `@furnas-technology/timeline`. On 2026-11-07 the repository was renamed to
`furnas-technology/event-calendar` and 0.2.0 was published as `@furnas-technology/event-calendar`. npm can only set
up trusted publishing for a package that already exists, so 0.2.0 was published by hand (without provenance). Then
the trusted publisher was set up (organization `furnas-technology`, repository `event-calendar`, workflow
`release.yml`), Release was re-run to mirror 0.2.0 to GitHub Packages, the `v0.2.0` tag and release were created by
hand, and `@furnas-technology/timeline` was deprecated on npm. The old Pages URL
`furnas-technology.github.io/timeline/` no longer works.

## Repository settings (already done)

- Settings → Actions → General → Workflow permissions: **Allow GitHub Actions to create and approve pull requests**
  (the Release workflow opens the "Version Packages" PR).
- Settings → Pages → Build and deployment → Source: **GitHub Actions** (not "Deploy from a branch"), so `pages.yml`
  publishes the demos and API docs to https://furnas-technology.github.io/event-calendar/.
- Settings → Code security → **Private vulnerability reporting** enabled.
- Installing from GitHub Packages always needs a token with `read:packages`, even for public packages.
