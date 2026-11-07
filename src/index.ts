export {
	addDays,
	type BroadcastCalendarOptions,
	type CalendarDate,
	type CalendarOption,
	createBroadcastCalendar,
	createFiscalCalendar,
	createGregorianCalendar,
	type DateInput,
	dayNumber,
	diffDays,
	type FiscalCalendarOptions,
	type GregorianCalendarOptions,
	inclusiveDays,
	monthsBetweenInclusive,
	type Period,
	type PeriodUnit,
	parseDateInput,
	periodOf,
	periodsBetween,
	shiftPeriod,
	type TimeCalendar,
} from './calendar';

export type {
	AggregateFn,
	AggregateOption,
	AllocateOption,
	BarOptions,
	ControlLabels,
	ControlsOptions,
	GroupLevel,
	MetricDef,
	MetricValues,
	TimelineConfig,
	TotalsOptions,
	ViewMode,
	ViewOptions,
} from './config';
export type { BarClickEvent, BarHoverEvent, BarMoveEvent, TimelineEventMap, Unsubscribe } from './events';
export type { ResolvedMetric } from './layout/aggregate';
export { computeLayout, type LayoutOptions, type PreparedData, prepareData } from './layout/layout';
export type { MeasureText } from './layout/measure';
export type {
	Bar,
	BarLayout,
	GridLine,
	GroupInfo,
	GroupLayout,
	HeaderCell,
	HeaderTier,
	LaneLayout,
	LegendItem,
	NormalizedRow,
	PeriodColumn,
	Rect,
	TimelineLayout,
	TotalLine,
	TotalRowLayout,
	ViewState,
} from './layout/types';
export type { ViewRequest } from './layout/view';
export { type Context2D, type DrawOptions, drawTimeline } from './render/canvas';
export {
	type DeepPartial,
	defaultTheme,
	mergeTheme,
	type Theme,
	type ThemeColors,
	type ThemeMetrics,
	themeMetrics,
} from './render/theme';
export { Timeline } from './timeline';
