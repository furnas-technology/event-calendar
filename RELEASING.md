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
up trusted publishing for a package that already exists, so 0.2.0 was published by hand (without provenance).
Release was re-run to mirror 0.2.0 to GitHub Packages, the `v0.2.0` tag and release were created by hand, and
`@furnas-technology/timeline` was deprecated on npm. The trusted publisher was not actually saved then, so the first CI
publish (0.3.0) failed with `E404 Not Found` on the `PUT` until it was set up on 2026-11-08 (see below). The old Pages URL
`furnas-technology.github.io/timeline/` no longer works.

## History: first CI publish (0.3.0)

The "chore: version packages" commit for 0.3.0 (`361792b`, #9) did not publish, because the trusted publisher was not
set up yet (see above). Once it was, the next push to `main` (`c6ed1b0`, #10, a RELEASING.md-only change) ran Release,
which published 0.3.0 with provenance and tagged that commit. So `v0.3.0` is on `c6ed1b0`, not on the version commit,
and that is intentional: npm's `gitHead` and provenance for 0.3.0 both name `c6ed1b0`, and the two commits differ only
in RELEASING.md. Normally the tag lands on the version commit.

## Checking what is on npm

The user-level npm config maps `@furnas-technology` to GitHub Packages, and a scope registry wins over `--registry`, so
`npm view @furnas-technology/event-calendar` shows GitHub Packages. To see npmjs.org, skip the user config:

```sh
npm view @furnas-technology/event-calendar versions dist-tags --userconfig=/dev/null --registry=https://registry.npmjs.org
```

## npm trusted publisher (already done)

npmjs.com → `@furnas-technology/event-calendar` → Settings → Trusted Publisher:

- Provider **GitHub Actions**, organization or user `furnas-technology`, repository `event-calendar`, workflow filename
  `release.yml`, environment name **empty** (the workflow uses no GitHub environment).
- Allowed actions: **Allow `npm publish`** checked (the workflow publishes directly; without it a trusted publisher can
  only stage a release for manual approval). **Allow `npm dist-tag`** unchecked (never used).

If a CI publish fails with `E404 Not Found – PUT https://registry.npmjs.org/@furnas-technology%2fevent-calendar`, npm
did not accept the workflow as a trusted publisher: check these settings, then re-run the failed Release run.

## Repository settings (already done)

- Settings → Actions → General → Workflow permissions: **Allow GitHub Actions to create and approve pull requests**
  (the Release workflow opens the "Version Packages" PR).
- Settings → Pages → Build and deployment → Source: **GitHub Actions** (not "Deploy from a branch"), so `pages.yml`
  publishes the demos and API docs to https://furnas-technology.github.io/event-calendar/.
- Settings → Code security → **Private vulnerability reporting** enabled.
- Installing from GitHub Packages always needs a token with `read:packages`, even for public packages.
