# @furnas-technology/event-calendar

Formerly published as `@furnas-technology/timeline` (0.1.0 below).

## 0.2.0

### Minor Changes

- 1b299e2: Built-in view controls: set `config.controls` options (`zoom`, `width`, `savePng`, `navigation`, `months`) to `true`
  to show A+/A−/Reset, Expand/Fit width, Save PNG, month navigation with the visible range, and a visible-months select
  above the drawing. Labels can be replaced with `controls.labels`. The canvas now sits in a `.ft-event-calendar-viewport`
  scroll container inside `.ft-event-calendar`.
- 1b299e2: Renamed from `@furnas-technology/timeline` to `@furnas-technology/event-calendar`. Update the install and imports:
  
  | Before | After |
  | --- | --- |
  | `@furnas-technology/timeline` | `@furnas-technology/event-calendar` |
  | `Timeline` | `EventCalendar` |
  | `TimelineConfig` | `EventCalendarConfig` |
  | `TimelineEventMap` | `EventCalendarEventMap` |
  | `TimelineLayout` | `EventCalendarLayout` |
  | `drawTimeline` | `drawEventCalendar` |
  | CSS classes `ft-timeline*` | `ft-event-calendar*` |
  | Default Save PNG name `timeline.png` | `event-calendar.png` |
  
  Nothing else changed.

## 0.1.0

### Minor Changes

- 3a2a32e: Initial public release: framework-free canvas timeline with nested row headings, lane packing, sub-totals, grand
  totals and per-month totals, broadcast, Gregorian and fiscal-year calendars, year-over-year mode, and drag-to-move.
