import type { CalendarDate } from '../calendar/dates';
import type { Period, TimeCalendar } from '../calendar/types';
import type { MetricValues, ViewMode } from '../config';

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A source row with parsed dates. */
export interface NormalizedRow<T> {
	readonly row: T;
	readonly index: number;
	readonly id: string;
	readonly start: CalendarDate;
	readonly end: CalendarDate;
	/** Inclusive day count. */
	readonly days: number;
	/** Group keys, outermost first. */
	readonly path: readonly string[];
	readonly labels: readonly string[];
	readonly mergeKey: string;
	/** Metric values by id (raw, per row). */
	readonly values: Readonly<Record<string, number | null>>;
}

/** One drawn bar: one or more source rows that share a group path, merge key and dates (or overlap, when merging). */
export interface Bar<T> {
	readonly id: string;
	/** The original rows, in input order. */
	readonly rows: readonly T[];
	readonly start: CalendarDate;
	readonly end: CalendarDate;
	readonly days: number;
	/** Group keys, outermost first. */
	readonly groupPath: readonly string[];
	/** Group labels, outermost first. */
	readonly groupLabels: readonly string[];
	readonly mergeKey: string;
	/** Year (per calendar) of the bar's start — the colour key in year-over-year mode. */
	readonly year: number;
	/** Metrics aggregated over the bar's rows. */
	readonly metrics: MetricValues;
	/** @internal */
	readonly normalized: readonly NormalizedRow<T>[];
}

/** Read-only information about a group, given to sort comparators. */
export interface GroupInfo<T> {
	readonly key: string;
	readonly label: string;
	readonly level: number;
	readonly rows: readonly T[];
	readonly metrics: MetricValues;
}

export interface TotalLine {
	readonly metricId: string;
	readonly label: string;
	readonly value: number | null;
	readonly formatted: string;
	/** One entry per visible period column; `null` when nothing was allocated. */
	readonly periods: readonly (number | null)[];
	readonly formattedPeriods: readonly string[];
}

export interface TotalRowLayout {
	/** 0 = grand total; otherwise level + 1 (matches `theme.colors.totalsFill`). */
	readonly depth: number;
	readonly rect: Rect;
	/** Header area where the label and overall totals are written. */
	readonly headerRect: Rect;
	readonly lines: readonly TotalLine[];
}

export interface BarLayout<T> {
	readonly bar: Bar<T>;
	readonly rect: Rect;
	readonly lane: number;
	readonly color: string;
	readonly lines: readonly string[];
	readonly icons: readonly string[];
	/** The bar continues beyond the left / right edge of the view. */
	readonly clippedStart: boolean;
	readonly clippedEnd: boolean;
}

export interface LaneLayout<T> {
	readonly rect: Rect;
	readonly bars: readonly BarLayout<T>[];
}

export interface GroupLayout<T> {
	readonly id: string;
	readonly key: string;
	readonly label: string;
	/** 0-based level; the root (never drawn as a heading) is -1. */
	readonly level: number;
	readonly path: readonly string[];
	/** Whole vertical extent of the group, including its children and totals. */
	readonly rect: Rect;
	/** The heading cell in the row-header column of this level. */
	readonly headerRect: Rect;
	readonly band: 'even' | 'odd';
	readonly lanes: readonly LaneLayout<T>[];
	readonly children: readonly GroupLayout<T>[];
	readonly total: TotalRowLayout | null;
	readonly info: GroupInfo<T>;
}

export type HeaderTier = 'year' | 'month' | 'week';

export interface HeaderCell {
	readonly tier: HeaderTier;
	readonly text: string;
	/** Span of the period on the x axis. */
	readonly x: number;
	readonly width: number;
	/** Text baseline y. */
	readonly y: number;
	readonly align: 'left' | 'center' | 'right';
	/** Draw bracket marks at both ends (years and months). */
	readonly bracket: boolean;
}

export interface GridLine {
	readonly x: number;
	readonly kind: 'week' | 'month' | 'boundary';
}

export interface LegendItem {
	readonly label: string;
	readonly color: string;
}

/** A visible period column (a month), used to place total cells. */
export interface PeriodColumn {
	readonly period: Period | null;
	readonly label: string;
	readonly x: number;
	readonly width: number;
}

export interface ViewState {
	readonly mode: ViewMode;
	/** First and last visible dates. In YoY mode these span the newest year shown. */
	readonly start: CalendarDate;
	readonly end: CalendarDate;
	/** Visible months. */
	readonly months: number;
	/** Months between the first and last month with data. */
	readonly totalMonths: number;
	/** Months between the first data month and the first visible month. */
	readonly offset: number;
	readonly canGoBack: boolean;
	readonly canGoForward: boolean;
}

export interface EventCalendarLayout<T> {
	readonly width: number;
	readonly height: number;
	readonly headerHeight: number;
	/** x where the time grid begins (after the row-header columns). */
	readonly gridX: number;
	readonly gridWidth: number;
	/** Widths of the row-header columns, by level. */
	readonly columnWidths: readonly number[];
	readonly root: GroupLayout<T>;
	readonly grandTotal: TotalRowLayout | null;
	readonly headerCells: readonly HeaderCell[];
	readonly gridLines: readonly GridLine[];
	readonly periodColumns: readonly PeriodColumn[];
	readonly legend: readonly LegendItem[];
	readonly view: ViewState;
	/** Pixels per day (continuous mode); 0 in YoY mode. */
	readonly dayWidth: number;
	readonly calendar: TimeCalendar;
	/** Every bar layout, in draw order. */
	readonly bars: readonly BarLayout<T>[];
	/** Rows that were skipped (invalid dates). */
	readonly skippedRows: readonly { index: number; reason: string }[];
	/** True when there is nothing to draw. */
	readonly empty: boolean;
}
