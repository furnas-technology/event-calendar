---
'@furnas-technology/event-calendar': minor
---

Scroll through time, fixed row headings, touch scrolling and tooltips that fit their content.

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
