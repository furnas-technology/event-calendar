# CLAUDE.md

`@furnas-technology/event-calendar` — framework-free, canvas-rendered event calendar: Gantt-style bars under nested
row headings (strict TypeScript, Luxon peer dependency). Public repo `furnas-technology/event-calendar`; demos at
https://furnas-technology.github.io/event-calendar/. Renamed from `@furnas-technology/timeline` (0.1.0) in 0.2.0.

## Origin

Extracted from the Angular 6 timeline in `~/Development/inplan-mcp-a6` (`src/app/components/timeline`). Commit
`7d5b7f1a` in that repo is the reference for grouping, totals and pro-rata month allocation (HEAD there has totals
stubbed out with `ARF` comments). Parity tests live in `test/layout.test.ts` ("totals (parity with commit 7d5b7f1a)").
An older abandoned attempt is in `~/Development/timeline-angular-2024` — reference only.

## Layout

- `src/calendar/` — calendar dates are Luxon `DateTime`s at UTC midnight (exact day math); broadcast, Gregorian and
  fiscal calendars. Months must be numbered within their year so `(year, number)` advances by one per month.
- `src/layout/` — pure, DOM-free: normalize → group tree → bars → lanes → totals → positions (`computeLayout`).
- `src/render/` — theme + canvas renderer (draws a finished layout). `src/interaction/` — hit test, tooltip.
- `src/eventCalendar.ts` — `EventCalendar` class (DOM, ResizeObserver, DPR, navigation, pointer/drag events).
- `examples/` — Vite demo gallery (dance, advertising, hurricanes, contracts); `examples/data/README.md` has sources.

## Commands

```sh
npm run dev          # demo gallery
npm test             # Vitest (node + jsdom; canvas via @napi-rs/canvas)
npm run typecheck    # library + examples
npm run lint         # Biome (rules copied from @furnas-technology/biome-config; tabs, single quotes, 120 cols)
npm run build        # tsup → dist (ESM, CJS, d.ts)
npm run check:pkg    # publint + attw
```

## Conventions

- Never mutate caller rows; no runtime dependencies besides `luxon`; no `any` in the public API.
- Tooltip strings are inserted as text, never HTML.
- TypeScript is pinned to 6.0.x — TS 7 breaks tsup's d.ts build and TypeDoc.
- Add a changeset (`npx changeset`) for user-facing changes.

## Release

Changesets: pushes to `main` open/update a "Version Packages" PR; merging it publishes to npm with provenance via npm
trusted publishing (OIDC, no token), then mirrors the version to GitHub Packages with `GITHUB_TOKEN` (the user's other
`@furnas-technology` packages live there, so their apps map the scope to `npm.pkg.github.com`; see `RELEASING.md`).
Pushing, merging the version PR and publishing need the user's go-ahead.

## Open items

- The rename to `event-calendar` is not released yet. Follow "Renaming" in `RELEASING.md`: rename the GitHub repo,
  publish 0.2.0 by hand (trusted publishing needs the package to exist), set up the trusted publisher, re-run Release
  for GitHub Packages, deprecate `@furnas-technology/timeline`.
