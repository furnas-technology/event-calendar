# @furnas-technology/event-calendar

A framework-free, canvas-rendered **event calendar** for TypeScript: events drawn as Gantt-style bars across the
calendar, under nested row headings, with automatic lane packing, **sub-totals and grand totals per level**, and
**per-month totals** — on a **broadcast**, **Gregorian** or **fiscal-year** calendar. Dates are handled with
[Luxon](https://moment.github.io/luxon/).

Formerly published as `@furnas-technology/timeline` (0.1.0).

**[Live demos](https://furnas-technology.github.io/event-calendar/)** — dance competitions, an advertising plan, Atlantic
hurricanes (NOAA) and U.S. federal contracts (USAspending) · **[API reference](https://furnas-technology.github.io/event-calendar/api/)**

It grew out of a media-planning flowchart, so it is good at "who is running what, when, and what does it cost per
month", but it is fully generic: you describe your row type `T` and which properties drive grouping, dates and metrics.

- **Generic over your data** — no required fields; accessors for start/end, group levels, metrics.
- **Nested row headings** at any depth, each level with its own sort (label asc/desc or a comparator over group metrics).
- **Lane packing** — non-overlapping bars share a lane; optional merging of overlapping bars.
- **Sub-totals, grand totals and per-month totals** for any numeric metric, with `sum`/`avg`/`min`/`max`/`count` or a
  custom aggregate, and pro-rata/active/start/end allocation into months.
- **Broadcast calendar** (Mon–Sun weeks, 4/5-week months), Gregorian or fiscal year (e.g. Oct–Sep, Jul–Jun), or plug
  in your own `TimeCalendar`.
- **Year-over-year mode** — every year overlaid on one 12-month axis, coloured by year.
- **Interactive** — hover tooltips, click events, drag bars to move them (with async accept/revert).
- **Responsive and crisp** — follows its container width (ResizeObserver), sharp on high-DPI screens.
- **Strict TypeScript**, ESM + CJS, no runtime dependencies besides the `luxon` peer.

## Install

```sh
npm install @furnas-technology/event-calendar luxon
```

Each release is also published to GitHub Packages, so this works unchanged if your `.npmrc` maps
`@furnas-technology` to `https://npm.pkg.github.com` (GitHub Packages needs a token with `read:packages`).

## Quick start

```ts
import { EventCalendar, type EventCalendarConfig } from '@furnas-technology/event-calendar';

// Your own row type — any shape. The config below tells the event calendar which properties hold the dates, the grouping
// keys and the numbers to total; nothing here is required by the library.
interface Item {
	id: string;
	category: string;
	name: string;
	start: string; // '2024-03-04'
	end: string; // inclusive
	amount: number;
}

const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const config: EventCalendarConfig<Item> = {
	start: (r) => r.start,
	end: (r) => r.end,
	rowId: (r) => r.id,
	groupBy: [
		{ key: (r) => r.category, subtotal: true },
		{ key: (r) => r.name, sort: (a, b) => (b.metrics.amount ?? 0) - (a.metrics.amount ?? 0) },
	],
	metrics: [{ id: 'amount', label: 'Amount', value: (r) => r.amount, format: (n) => num.format(n) }],
	totals: { grand: true },
	calendar: 'gregorian',
};

const calendar = new EventCalendar(document.getElementById('plan')!, config, items);

calendar.on('click', ({ rows }) => console.log('clicked', rows));
```

The event calendar fills its container's width and grows vertically to fit its rows. Call `calendar.destroy()` when you
remove it.

### Using it from a framework

The library owns one DOM element, so wrap it in whatever lifecycle your framework has:

```tsx
// React
useEffect(() => {
	const t = new EventCalendar(ref.current!, config, rows);
	return () => t.destroy();
}, []);
useEffect(() => calendarRef.current?.setData(rows), [rows]);
```

```ts
// Angular
ngAfterViewInit() { this.calendar = new EventCalendar(this.host.nativeElement, config, this.rows); }
ngOnDestroy() { this.calendar?.destroy(); }
```

```ts
// Vue
onMounted(() => (calendar = new EventCalendar(el.value!, config, rows.value)));
onBeforeUnmount(() => calendar?.destroy());
```

## Configuration

| Option                     | Type                                              | Default        |                                                                                                                                |
| -------------------------- | ------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `start`, `end`             | `(row) => DateInput`                              | —              | Inclusive date range of a row.                                                                                                 |
| `groupBy`                  | `GroupLevel<T>[]`                                 | —              | Row hierarchy, outermost first. May be empty.                                                                                  |
| `metrics`                  | `MetricDef<T>[]`                                  | `[]`           | Numeric values to aggregate and total.                                                                                         |
| `totals`                   | `TotalsOptions`                                   | —              | Grand total, per-month cells, which metrics.                                                                                   |
| `bars`                     | `BarOptions<T>`                                   | —              | Labels, colours, icons, merging.                                                                                               |
| `tooltip`                  | `(bar, metrics) => string \| HTMLElement \| null` | built-in       | Strings are inserted as **text**, never HTML.                                                                                  |
| `calendar`                 | `'broadcast' \| 'gregorian' \| TimeCalendar`      | `'broadcast'`  |                                                                                                                                |
| `zone`                     | IANA zone                                         | system zone    | How `Date`/epoch/timestamp inputs are read; "today".                                                                           |
| `locale`                   | BCP 47                                            | `'en-US'`      | Month labels, default number format, sorting.                                                                                  |
| `view`                     | `ViewOptions`                                     | all data       | `mode`, initial `start`, visible `months`, `range`, `hideEmptyGroups`.                                                         |
| `theme`                    | `DeepPartial<Theme>`                              | `defaultTheme` | Fonts, sizes, colours.                                                                                                         |
| `editable`                 | `boolean`                                         | `false`        | Allow dragging bars (continuous mode).                                                                                         |
| `rowId`                    | `(row) => string \| number`                       | index          | Stable identity of a row.                                                                                                      |
| `emptyLabel`               | `string`                                          | `'(blank)'`    | Heading for empty group keys.                                                                                                  |
| `controls`                 | `ControlsOptions`                                 | none shown     | Built-in view controls above the drawing, each opt-in.                                                                         |
| `fixedRowHeadings`         | `boolean \| 'auto'`                               | `'auto'`       | Keep row headings in place while the time grid scrolls. `'auto'`: when the window is at least `fixedRowHeadingsMinWidth` wide. |
| `fixedRowHeadingsMinWidth` | `number`                                          | `768`          | Breakpoint (px of window width) for `fixedRowHeadings: 'auto'`.                                                                |
| `maxHeight`                | `number \| string`                                | none           | Largest height (px or CSS length, e.g. `'75vh'`); taller content scrolls inside, with the time axis pinned.                    |
| `tooltipOnClick`           | `boolean`                                         | `true`         | A click or tap pins the tooltip open (Escape or a press elsewhere closes it).                                                  |

### Dates

`DateInput` is `string | Date | number | DateTime`. The event calendar works in **calendar dates** (no time of day):

- ISO **date-only** strings such as `'2024-03-01'` are taken literally — the recommended format.
- `Date` objects and epoch milliseconds are read in `zone`. Note `new Date('2024-03-01')` is UTC midnight in
  JavaScript, which is the previous day in the Americas — prefer the string.
- A Luxon `DateTime` contributes its own year/month/day.

Rows with an unparseable date are skipped and listed in `layout.skippedRows`.

### Group levels

```ts
interface GroupLevel<T> {
	key: (row: T) => string | number | null | undefined; // identity
	label?: (row: T) => string; // heading text, defaults to String(key)
	sort?: 'asc' | 'desc' | 'none' | ((a: GroupInfo<T>, b: GroupInfo<T>) => number);
	subtotal?: boolean; // a total row under every group at this level
}
```

`GroupInfo` gives a comparator the group's `key`, `label`, `level`, original `rows` and aggregated `metrics`, so
"largest spend first" is `(a, b) => (b.metrics.cost ?? 0) - (a.metrics.cost ?? 0)`.

Row headings get one column per level, wide enough for every label (and for the label and value of any total row)
as long as all columns fit in `theme.maxHeaderRatio` (40 %) of the width. When they don't, each column falls back to
the larger of the 80th-percentile label and 85 % of the widest label, so one very long name is truncated rather than
squeezing the grid, and columns are scaled down to the budget if needed.

### Metrics

```ts
interface MetricDef<T> {
	id: string;
	label: string;
	value: (row: T) => number | null | undefined;
	aggregate?: 'sum' | 'avg' | 'min' | 'max' | 'count' | ((values: readonly number[]) => number); // 'sum'
	allocate?: 'prorata' | 'active' | 'start' | 'end' | 'none'; // 'prorata' for sum, otherwise 'active'
	format?: (value: number) => string;
	formatPeriod?: (value: number) => string; // month cells of total rows (often narrow); default: format
}
```

Aggregates are always computed from the **raw row values** in a group (never by averaging sub-averages), so `avg`,
`min` and `max` are correct at every level.

### Totals

```ts
totals: {
	grand?: boolean;          // grand total at the bottom (default false)
	periods?: boolean;        // per-month cells (default true)
	metrics?: string[];       // metric ids shown, one line each (default: all)
	hideRedundant?: boolean;  // default true, see below
	label?: string;           // default 'Total'
}
```

With one metric a total row reads `Total … value`; with several, each line is named after its metric (`Cost`,
`Impressions`) and the shaded row marks it as a total. Use `MetricDef.formatPeriod` for compact month cells (`$61M`).

Sub-totals are switched on per level with `GroupLevel.subtotal`. For example, a media plan grouped by media group ›
media type › vehicle with a cost metric (as in the advertising demo):

```
 Broadcast │ Metro TV │ Channel 9 │ ████ $84,500          ████ $51,300
           │          │           │                          ████ $55,400
           │ Total             $191,200 │  $81,482 │  $3,018 │  $2,094 │ $55,318   ← sub-total, level 1
 Total                         $242,000 │ $129,863 │  $5,437 │  …                  ← sub-total, level 0
 …
 Total                         $530,000 │ $129,863 │ $58,537 │  …                  ← grand total
                                ▲             ▲
              aggregate of all rows    allocation into each visible month
```

- **The header value** aggregates every row of the group that is visible in the window (full row values).
- **Month cells** hold each row's value allocated into that month, after clipping the row to the visible window:
  - `prorata` — value ÷ row days × days in the month (so a cost spread over two months splits by days)
  - `active` — the full value in every month the row runs (useful with `count`, `avg`, `max`)
  - `start` / `end` — the full value in the month of the start / end date
  - `none` — no month cells
- **`hideRedundant`** — a group with no bars of its own and exactly one child would show the same numbers as that
  child's sub-total, so its total is suppressed. If the child level has no sub-totals, the parent's is kept.

`calendar.setTotalsDepth(n)` reproduces a simple "totals level" toggle: `'none'`, `0` (grand only), or `n` (grand plus
levels `0 … n-1`).

### Controls

The event calendar can draw its own view controls in a bar above the drawing. Nothing is shown unless you switch an option
on, and the controls appear in this order:

```ts
controls: {
	zoom: true,       // A+  A−  Reset
	width: true,      // Expand width  Fit width
	savePng: true,    // Save PNG (downloads `fileName`, default 'event-calendar.png')
	navigation: true, // ⏮ ◀ Today ▶ ⏭ and the visible range, e.g. "1 Jan 2026 – 31 Mar 2026 · 3 of 23 months"
	months: true,     // visible months: 3, 6, 12, 24, All — or your own counts, e.g. [1, 3, 6]
}
```

The buttons call the same methods you can call yourself (`zoom`, `expandWidth`, `fitWidth`, `toBlob`, `first`,
`prev`, `today`, `next`, `last`, `setVisibleMonths`). Navigation is disabled at the ends of the data and in
year-over-year mode, and the controls stay in place while an expanded drawing scrolls. Replace any text with
`labels`, for example ``labels: { today: 'Heute', allMonths: 'Alle', months: (n) => `${n} Monate` }``. Change the
controls with `setConfig({ controls })`.

### Scrolling

In continuous mode the event calendar lays out **every month with data**; `view.months` is the zoom — how many months
fill the visible width — and you scroll through the rest:

- **Mouse and trackpad**: wheel / two-finger swipe (Shift+wheel scrolls sideways with a plain wheel), the scrollbar, or
  drag the background (or any bar, unless `editable`) with the mouse.
- **Touch**: swipe, with the browser's own momentum. With `editable`, a sideways drag on a bar moves the bar, and a
  sideways drag on the background scrolls.
- **Navigation**: `first`, `prev`, `next`, `last` and `today` scroll smoothly to month boundaries; `getViewState()` and
  `viewchange` follow the scroll position.

Row headings stay fixed while the grid scrolls when `fixedRowHeadings` is `true`, or by default (`'auto'`) when the window
is at least 768px wide — on phones they scroll with the grid so the time axis gets the room. With `maxHeight`, long
plans scroll vertically inside the calendar and the time axis stays at the top.

Only groups with rows in the months in view are listed (whole months, so a month partly on screen counts), and the
totals cover those months. As a new month scrolls into view the list updates; the row headings keep their width, so the
grid never shifts sideways, and inside a `maxHeight` box the rows you were looking at stay in place. Set
`view: { hideEmptyGroups: false }` to list every group all the time, or `view: { range: 'window' }` to lay out only the
visible months and re-lay out on navigation instead of scrolling.

Tooltips size to their content up to the visible part of the window and are placed beside the bar, flipping above it
near the bottom edge. Hovering shows one; a click or tap pins it (set `tooltipOnClick: false` to keep only hover). Give
custom tooltip content a `maxWidth` if you want it to wrap earlier.

### Bars

```ts
bars: {
	label?: (bar, metrics) => string[];   // lines inside the bar; default: first metric
	color?: (bar) => string;              // default: palette by top-level group
	icons?: (bar) => string[];            // image URLs drawn after the label when there is room
	mergeOverlapping?: boolean;           // union overlapping bars within a group
	mergeAdjacent?: boolean;              // …also bars that touch end-to-start
	mergeKey?: (row) => string | number;  // must match for rows to share/merge a bar
}
```

Rows in the same deepest group with the same `mergeKey` and identical dates always share a bar; `bar.rows` lists them.
Bars that overlap go to separate lanes; set `theme.barLines` to 2 or 3 for multi-line labels.

### Calendars

**Broadcast** (default): weeks run Monday–Sunday; a week belongs to the month in which its Sunday falls, so a
broadcast month runs from the Monday of the week containing the 1st to the last Sunday of the month (always 4 or 5
weeks). Broadcast January 2024 is 1–28 January; 30 December 2024 belongs to January 2025.

**Gregorian**: civil months and years, weeks start Monday (configurable) and may straddle months.

**Fiscal year**: civil months grouped into a year that starts in `startMonth`, named after the year it ends in —
US federal FY2025 is October 2024 – September 2025, Australian FY2025 is July 2024 – June 2025. The year header reads
`FY2025`, and year-over-year mode runs from the first fiscal month.

```ts
import { createBroadcastCalendar, createFiscalCalendar } from '@furnas-technology/event-calendar';

calendar: createBroadcastCalendar({ weekStartsOn: 7, locale: 'en-AU' }); // Sunday weeks
calendar: createFiscalCalendar({ startMonth: 10 }); // US federal year
calendar: createFiscalCalendar({ startMonth: 7, locale: 'en-AU' }); // Australian year
```

Implement `TimeCalendar` (`weekOf`, `monthOf`, `yearOf`, `monthLabel`) for retail 4-4-5 or other calendars. Months
must be numbered within their year (`month.number` 1–12) so that `(year, number)` advances by one each month.

## API

```ts
const t = new EventCalendar<T>(container, config, rows?);

t.setData(rows);                 // replace rows
t.setConfig(patch);              // shallow merge; `view` resets navigation; `theme` merges
t.setTotalsDepth(depth);

// navigation (continuous mode)
t.first(); t.prev(n?); t.today(); t.next(n?); t.last();
t.setVisibleMonths(6 | 'all');
t.setMode('continuous' | 'yoy');
t.getViewState();                // what is visible now: { start, end, months, totalMonths, offset, canGoBack, canGoForward, mode }

// display
t.zoom(1.25 | 'reset');          // scale fonts and lanes
t.expandWidth(1.25); t.fitWidth();

// events
t.on('click', ({ bar, rows, nativeEvent }) => {});
t.on('hover', ({ bar }) => {});
t.on('move', async ({ bar, rows, deltaDays, newStart, newEnd }) => true);
t.on('viewchange', (view) => {});
t.on('render', ({ layout }) => {});

t.getLayout();                   // positions of everything drawn, in layout (unscrolled) coordinates
await t.toBlob('image/png');
t.render();                      // synchronous redraw (normally automatic)
t.destroy();
```

The constructor renders synchronously, so read the initial state with `getViewState()` / `getLayout()` rather than
waiting for the first `viewchange`.

### Moving bars

With `editable: true`, bars can be dragged horizontally in whole days and are kept inside the laid-out months. On drop
every `move` handler is called; the move is **accepted only if every handler returns (or resolves to) `true`**,
otherwise the bar snaps back. The library never changes your rows: after accepting, update your data and call
`setData` (the bar stays at its dropped position until you do).

```ts
t.on('move', async ({ rows, deltaDays }) => {
	const ok = await api.shiftItems(
		rows.map((r) => r.id),
		deltaDays,
	);
	if (ok) t.setData(await api.loadItems());
	return ok;
});
```

### Headless use

The layout engine is pure and DOM-free. `prepareData` + `computeLayout` return every rectangle, label and total, which
you can render yourself (SVG, PDF, server-side) or with `drawEventCalendar` onto any 2D context.

```ts
import { computeLayout, defaultTheme, drawEventCalendar, prepareData } from '@furnas-technology/event-calendar';

const layout = computeLayout(prepareData(rows, config), {
	width: 1200,
	measureText: (text, font) => {
		ctx.font = font;
		return ctx.measureText(text).width;
	},
	theme: defaultTheme,
	view: { mode: 'continuous', start: null, months: null },
});
drawEventCalendar(ctx, layout, defaultTheme, { measure });
```

`computeLayout` lays out only the requested window unless you pass `range: 'all'` (every month, at the zoom where the
requested months fill `width`), `shown` (the dates in view, whose groups are listed) and `widthScale`. To draw a scrolled part of a wide layout into a canvas of the visible
size, pass `viewport: { x, y, width, height, frozenX, frozenY }` to `drawEventCalendar`; `visibleViewState(layout, x,
width)` reports the visible window.

## Theming

Everything visual is in `Theme` — `scale`, `baseFontSize`, `fontFamily`, `padding`, `barLines`, `barRadius`,
`maxHeaderRatio`, and `colors` (bands, grid lines, totals fills per depth, palettes, tooltip). Pass a partial theme:

```ts
theme: { fontFamily: 'Inter, sans-serif', barLines: 2, colors: { rowHeaderText: '#222', palette: ['#0b7285', '#e8590c'] } }
```

The DOM elements carry the classes `ft-event-calendar`, `ft-event-calendar-viewport` (the scroll container),
`ft-event-calendar-track` (its full-size content), `ft-event-calendar-canvas` (sized to the visible part), `ft-event-calendar-tooltip` and `ft-event-calendar-drag-badge`, and the controls `ft-event-calendar-controls`,
`ft-event-calendar-control-group`, `ft-event-calendar-control` and `ft-event-calendar-range`, if you want to adjust them with CSS. The
controls take their font and colours from the theme. They are styled inline (which works under a strict
Content-Security-Policy), so CSS overrides need `!important`.

## Browser support

Evergreen browsers (Chrome, Edge, Firefox, Safari 14+) — the event calendar uses Pointer Events, `ResizeObserver`,
`position: sticky` and canvas 2D. Tooltips use the Popover API where available (so no `overflow` or `z-index` of an
ancestor can clip them) and fall back to `position: fixed`. The canvas only covers the visible part of the calendar;
without `maxHeight`, very tall plans are limited by the browser's maximum canvas size (~16 000 px at 1× pixel ratio) and
the device pixel ratio is reduced automatically to stay within it — set `maxHeight` for long plans.

## Demos

[furnas-technology.github.io/event-calendar](https://furnas-technology.github.io/event-calendar/) — source in [`examples/`](https://github.com/furnas-technology/event-calendar/tree/main/examples):

| Demo                | Data                                                                            | Shows                                                                                           |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Dance competitions  | Australian dance-competition listings, 2026–2027                                | Group by state, city or category type, count + average style metrics, drag to reschedule, AU FY |
| Advertising plan    | Synthetic media plan                                                            | Broadcast calendar, pro-rata cost by month, sub-totals at two levels, merge overlapping         |
| Atlantic hurricanes | [NOAA HURDAT2](https://www.nhc.noaa.gov/data/#hurdat) 2015–2025 (public domain) | Year-over-year seasons, count / sum / max / min aggregates, custom sort by intensity            |
| Federal contracts   | [USAspending.gov](https://www.usaspending.gov/) Commerce FY2025 (public domain) | US federal fiscal calendar, multi-year pro-rata spend, rich HTMLElement tooltips                |

## Development

```sh
npm install
npm run dev        # demos at examples/
npm test           # unit, renderer and DOM tests
npm run typecheck
npm run lint
npm run build      # dist/ (ESM, CJS, .d.ts)
npm run check:pkg  # publint + are-the-types-wrong
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases use [Changesets](https://github.com/changesets/changesets).

## License

[MIT](LICENSE) © Furnas Technology
