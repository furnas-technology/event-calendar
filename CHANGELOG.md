# @furnas-technology/event-calendar

Formerly published as `@furnas-technology/timeline` (0.1.0 below).

## 0.3.0

### Minor Changes

- fb2e589: Scroll through time, fixed row headings, touch scrolling and tooltips that fit their content.
  - Continuous mode now lays out every month with data; `view.months` sets how many months fill the width and you scroll
    through the rest by wheel, trackpad, scrollbar, touch swipe or mouse drag. `first`/`prev`/`next`/`last`/`today`
    scroll smoothly, and `getViewState()`/`viewchange` follow the scroll position. Only groups with rows in the months in
    view are listed and totalled, updating as months scroll into view (`hideEmptyGroups: false` lists all). Set
    `view.range: 'window'` to lay out only the visible months as before.
  - New `fixedRowHeadings` (`'auto'` by default: fixed when the window is at least `fixedRowHeadingsMinWidth`, 768px,
    wide) keeps row headings in place while the grid scrolls.
  - New `maxHeight` scrolls long plans inside the calendar with the time axis pinned at the top. The canvas now only
    covers the visible part, so wide or long plans no longer hit the browser's canvas size limit.
  - Tooltips are fixed-position popovers sized to their content up to the visible window (they were squeezed to the
    space left in the scroll container), and a click or tap pins them open (`tooltipOnClick`, default `true`).
  - Expand width now widens only the time grid; the row headings keep their width.
  - `computeLayout` accepts `range`, `shown` and `widthScale` (layouts report `range` and `shown`); `drawEventCalendar`
    accepts a `viewport`; new `visibleViewState`.

## 0.2.0

### Minor Changes

- 1b299e2: Built-in view controls: set `config.controls` options (`zoom`, `width`, `savePng`, `navigation`, `months`) to `true`
  to show A+/A−/Reset, Expand/Fit width, Save PNG, month navigation with the visible range, and a visible-months select
  above the drawing. Labels can be replaced with `controls.labels`. The canvas now sits in a `.ft-event-calendar-viewport`
  scroll container inside `.ft-event-calendar`.
- 1b299e2: Renamed from `@furnas-technology/timeline` to `@furnas-technology/event-calendar`. Update the install and imports:

  | Before                               | After                               |
  | ------------------------------------ | ----------------------------------- |
  | `@furnas-technology/timeline`        | `@furnas-technology/event-calendar` |
  | `Timeline`                           | `EventCalendar`                     |
  | `TimelineConfig`                     | `EventCalendarConfig`               |
  | `TimelineEventMap`                   | `EventCalendarEventMap`             |
  | `TimelineLayout`                     | `EventCalendarLayout`               |
  | `drawTimeline`                       | `drawEventCalendar`                 |
  | CSS classes `ft-timeline*`           | `ft-event-calendar*`                |
  | Default Save PNG name `timeline.png` | `event-calendar.png`                |

  Nothing else changed.

## 0.1.0

### Minor Changes

- 3a2a32e: Initial public release: framework-free canvas timeline with nested row headings, lane packing, sub-totals, grand
  totals and per-month totals, broadcast, Gregorian and fiscal-year calendars, year-over-year mode, and drag-to-move.
