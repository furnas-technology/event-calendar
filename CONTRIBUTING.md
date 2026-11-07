# Contributing

Thanks for helping improve `@furnas-technology/event-calendar`.

## Setup

Requires Node 22 or newer.

```sh
npm install
npm run dev     # demo page with a synthetic media plan (examples/)
npm test
```

## Project layout

| Path                   | Purpose                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `src/calendar/`        | Calendar dates (Luxon, UTC-midnight), broadcast and Gregorian calendars, period helpers  |
| `src/layout/`          | Pure, DOM-free layout: normalise → group → bars → lanes → totals → positions             |
| `src/render/`          | Theme and canvas renderer (draws a finished layout)                                      |
| `src/interaction/`     | Hit testing and tooltip placement                                                        |
| `src/eventCalendar.ts` | The `EventCalendar` class: DOM, resizing, navigation, pointer events                     |
| `test/`                | Vitest: calendar and layout unit tests, canvas renderer (node canvas), DOM tests (jsdom) |

Most behaviour lives in the layout layer and can be tested without a browser — please add a test there for any change
in grouping, totals, lanes or positions.

## Before opening a pull request

```sh
npm run lint        # Biome (lint + format); `npm run lint:fix` to apply fixes
npm run typecheck
npm test
npm run build
npx changeset       # if the published package changes
```

Keep the public API strictly typed (no `any`), avoid runtime dependencies other than the `luxon` peer, and never
mutate the caller's rows.
