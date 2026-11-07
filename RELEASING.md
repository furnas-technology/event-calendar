# Releasing

Day to day: add a changeset (`npx changeset`) with each user-facing change. On every push to `main` the **Release**
workflow opens or updates a "Version Packages" pull request. Merging it publishes to npm with provenance
(authenticated by npm trusted publishing, no token), then publishes the same version to GitHub Packages (using the
workflow's `GITHUB_TOKEN`; the step skips versions already there, so a failed run is retried on the next push).

## Renaming from `@furnas-technology/timeline` (one-time, for 0.2.0)

The package was first published as `@furnas-technology/timeline` (0.1.0) and renamed to
`@furnas-technology/event-calendar`, starting at 0.2.0. npm can only set up trusted publishing for a package that
already exists, so the first release under the new name goes like this:

1. On GitHub, rename the repository to `furnas-technology/event-calendar` (Settings → General). Git and web URLs
   redirect, but the old Pages URL `furnas-technology.github.io/timeline/` stops working. Locally, run
   `git remote set-url origin https://github.com/furnas-technology/event-calendar.git`.
2. Merge the rename PR. When the "Version Packages" PR for 0.2.0 is merged, the npm publish step fails because no
   trusted publisher is set up yet.
3. Publish once by hand from an up-to-date `main`: `npm publish --provenance=false`. `prepublishOnly` runs the checks
   first. Provenance can only be generated in CI, so 0.2.0 alone has none.
4. On npmjs.com → `@furnas-technology/event-calendar` → **Settings** → **Trusted Publisher**, choose **GitHub
   Actions** and enter organization `furnas-technology`, repository `event-calendar`, workflow filename `release.yml`
   (environment blank). Optionally, under **Publishing access**, choose "Require two-factor authentication and
   disallow tokens" so only the workflow can publish.
5. Re-run the failed Release job. Changesets skips the version that is already on npm, and the GitHub Packages step
   publishes 0.2.0 there. Check under https://github.com/orgs/furnas-technology/packages that the new package is
   linked to the `event-calendar` repository and its visibility is **Public**.
6. Deprecate the old package:
   `npm deprecate @furnas-technology/timeline "Renamed to @furnas-technology/event-calendar"`.

## Repository settings (already done)

- Settings → Actions → General → Workflow permissions: **Allow GitHub Actions to create and approve pull requests**
  (the Release workflow opens the "Version Packages" PR).
- Settings → Pages → Build and deployment → Source: **GitHub Actions** (not "Deploy from a branch"), so `pages.yml`
  publishes the demos and API docs to https://furnas-technology.github.io/event-calendar/.
- Settings → Code security → **Private vulnerability reporting** enabled.
- Installing from GitHub Packages always needs a token with `read:packages`, even for public packages.
