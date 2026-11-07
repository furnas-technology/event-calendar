import type { CalendarOption } from './calendar';
import type { DateInput } from './calendar/dates';
import type { Bar, GroupInfo } from './layout/types';
import type { DeepPartial, Theme } from './render/theme';

/** One level of the row hierarchy. Levels are listed outermost first. */
export interface GroupLevel<T> {
	/** Identity of the group a row belongs to at this level. */
	key: (row: T) => string | number | null | undefined;
	/** Row-heading text. Defaults to `String(key)`; empty keys show {@link EventCalendarConfig.emptyLabel}. */
	label?: (row: T) => string;
	/**
	 * Sibling order at this level. `'asc'`/`'desc'` sort by label (locale-aware, numeric). A comparator receives
	 * {@link GroupInfo} including the group's metric totals, e.g. to sort by spend. Default `'asc'`.
	 */
	sort?: 'asc' | 'desc' | 'none' | ((a: GroupInfo<T>, b: GroupInfo<T>) => number);
	/** Show a sub-total row for every group at this level. Default `false`. */
	subtotal?: boolean;
}

export type AggregateFn = (values: readonly number[]) => number;
export type AggregateOption = 'sum' | 'avg' | 'min' | 'max' | 'count' | AggregateFn;

/**
 * How a row's value is spread into period (month) cells of a total row.
 *
 * - `prorata` — value × (days of the row inside the period ÷ row days). Default for `sum`.
 * - `active`  — the full value counts in every period the row is active in. Default for every other aggregate.
 * - `start` / `end` — the full value goes to the period containing the row's start / end date.
 * - `none`    — no period cells for this metric.
 */
export type AllocateOption = 'prorata' | 'active' | 'start' | 'end' | 'none';

export interface MetricDef<T> {
	id: string;
	label: string;
	value: (row: T) => number | null | undefined;
	aggregate?: AggregateOption;
	allocate?: AllocateOption;
	/** Display formatting. Default: `Intl.NumberFormat(locale, { maximumFractionDigits: 0 })`. */
	format?: (value: number) => string;
	/** Formatting for month cells of total rows, which are often narrow (e.g. `$61M` instead of `$61,234,567`). Default: `format`. */
	formatPeriod?: (value: number) => string;
}

/** Aggregated metric values keyed by metric id. `null` when no row had a value. */
export type MetricValues = Readonly<Record<string, number | null>>;

export interface TotalsOptions {
	/** Grand-total row at the bottom. Default `false`. */
	grand?: boolean;
	/** Show per-period (month) cells in total rows. Default `true`. */
	periods?: boolean;
	/** Metric ids shown in total rows, one line each. Default: every metric. */
	metrics?: readonly string[];
	/**
	 * Suppress a sub-total that would repeat its only child's sub-total (a group with no bars of its own and exactly
	 * one child). Default `true` — the original timeline's behaviour.
	 */
	hideRedundant?: boolean;
	/** Label prefix written before the totals in the header column. Default `'Total'`. */
	label?: string;
}

export interface BarOptions<T> {
	/** Text lines inside a bar. Default: the first metric, formatted. */
	label?: (bar: Bar<T>, metrics: MetricValues) => readonly string[];
	/** Bar colour (any CSS colour). Default: theme palette keyed by the top-level group. Ignored in YoY mode. */
	color?: (bar: Bar<T>) => string;
	/** Image URLs drawn after the label when there is room (e.g. vehicle logos). */
	icons?: (bar: Bar<T>) => readonly string[];
	/** Merge overlapping bars within a lane group into one (the original "gross weeks" mode). Default `false`. */
	mergeOverlapping?: boolean;
	/** When merging, also merge bars that touch end-to-start. Default `false`. */
	mergeAdjacent?: boolean;
	/**
	 * Extra identity that must match for rows to share a bar, beyond group path and dates (old code: media type id).
	 */
	mergeKey?: (row: T) => string | number;
}

export type ViewMode = 'continuous' | 'yoy';

export interface ViewOptions {
	/** Default `'continuous'`. */
	mode?: ViewMode;
	/** First visible date (snapped to its month). Default: the first month with data. */
	start?: DateInput;
	/** Number of visible months. Default: all months with data. */
	months?: number;
	/** Hide groups with no bars inside the visible window. Default `true`. */
	hideEmptyGroups?: boolean;
}

export interface EventCalendarConfig<T> {
	start: (row: T) => DateInput;
	/** Inclusive end date. */
	end: (row: T) => DateInput;
	/** Stable row identity. Default: array index. */
	rowId?: (row: T) => string | number;
	/** Row hierarchy, outermost first. May be empty (all bars share one lane group). */
	groupBy: readonly GroupLevel<T>[];
	metrics?: readonly MetricDef<T>[];
	totals?: TotalsOptions;
	bars?: BarOptions<T>;
	/**
	 * Tooltip content. A string is inserted as **text** (never HTML); return an `HTMLElement` for rich content.
	 * Return `null` for no tooltip. Default: group path, dates and metrics.
	 */
	tooltip?: (bar: Bar<T>, metrics: MetricValues) => string | HTMLElement | null;
	calendar?: CalendarOption;
	/** Zone used to read `Date`, epoch and timestamp inputs, and to decide "today". Default: system zone. */
	zone?: string;
	/** Locale for labels and default number formatting. Default `en-US`. */
	locale?: string;
	view?: ViewOptions;
	theme?: DeepPartial<Theme>;
	/** Allow dragging bars horizontally (continuous mode only). Listen for the `move` event. Default `false`. */
	editable?: boolean;
	/** Label for groups whose key is empty. Default `'(blank)'`. */
	emptyLabel?: string;
	/** Built-in view controls above the drawing. Nothing is shown unless an option is `true`. */
	controls?: ControlsOptions;
}

/** Text of the built-in controls. */
export interface ControlLabels {
	zoomIn: string;
	zoomOut: string;
	zoomReset: string;
	expandWidth: string;
	fitWidth: string;
	savePng: string;
	first: string;
	prev: string;
	today: string;
	next: string;
	last: string;
	/** The "every month" choice of the visible-months select. */
	allMonths: string;
	/** A visible-months choice, e.g. `6 months`. */
	months: (count: number) => string;
	/** After the visible date range, e.g. `3 of 23 months`. */
	visible: (shown: number, total: number) => string;
}

/** Which built-in controls the event calendar shows, in this order. Each is off unless `true`. */
export interface ControlsOptions {
	/** A+, A− and Reset (`zoom`). */
	zoom?: boolean;
	/** Expand width and Fit width (`expandWidth`, `fitWidth`). */
	width?: boolean;
	/** Save PNG (`toBlob`, downloaded as `fileName`). */
	savePng?: boolean;
	/** First / previous / today / next / last month, and the visible date range. */
	navigation?: boolean;
	/** Visible-months select. `true` offers 3, 6, 12, 24 and all months; pass your own month counts to change that. */
	months?: boolean | readonly number[];
	/** Download name for Save PNG. Default `'event-calendar.png'`. */
	fileName?: string;
	/** Replace any of the (English) control texts. */
	labels?: Partial<ControlLabels>;
}
