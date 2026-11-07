import { type CalendarOption, resolveCalendar } from '../calendar';
import { type CalendarDate, dayNumber, maxDate, minDate, today } from '../calendar/dates';
import { periodsBetween } from '../calendar/periods';
import type { Period, TimeCalendar } from '../calendar/types';
import type { EventCalendarConfig } from '../config';
import { pick, type Theme, type ThemeMetrics, themeMetrics } from '../render/theme';
import { type AllocationTarget, allocate, type ResolvedMetric, resolveMetrics } from './aggregate';
import { buildBars } from './bars';
import { buildGroupTree, type GroupNode, groupInfo, walk } from './group';
import { packLanes } from './lanes';
import { columnWidth, fitText, type MeasureText } from './measure';
import { normalizeRows } from './normalize';
import type {
	Bar,
	BarLayout,
	EventCalendarLayout,
	GridLine,
	GroupLayout,
	HeaderCell,
	LaneLayout,
	LegendItem,
	NormalizedRow,
	PeriodColumn,
	Rect,
	TotalLine,
	TotalRowLayout,
	ViewState,
} from './types';
import {
	clipToYear,
	continuousScale,
	type ResolvedView,
	resolveContinuousView,
	type ViewRequest,
	type XScale,
	yoyScale,
} from './view';

/** Rows parsed once per `setData`/`setConfig`; layout is recomputed from this on every resize or navigation. */
export interface PreparedData<T> {
	readonly config: EventCalendarConfig<T>;
	readonly calendar: TimeCalendar;
	readonly metrics: readonly ResolvedMetric<T>[];
	readonly rows: readonly NormalizedRow<T>[];
	readonly skipped: readonly { index: number; reason: string }[];
	readonly dataStart: CalendarDate | null;
	readonly dataEnd: CalendarDate | null;
	/** Distinct years present, ascending — stable colour keys for year-over-year mode. */
	readonly years: readonly number[];
	/** Display label of each year (e.g. `FY2025` for fiscal calendars). */
	readonly yearLabels: ReadonlyMap<number, string>;
	readonly locale: string;
	readonly zone: string;
	readonly collator: Intl.Collator;
}

export function prepareData<T>(rows: readonly T[], config: EventCalendarConfig<T>): PreparedData<T> {
	const locale = config.locale ?? 'en-US';
	const zone = config.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	const calendar = resolveCalendar(config.calendar as CalendarOption | undefined, locale);
	const metrics = resolveMetrics(config.metrics, locale);
	const normalized = normalizeRows(rows, config, metrics, zone);

	let dataStart: CalendarDate | null = null;
	let dataEnd: CalendarDate | null = null;
	const years = new Set<number>();
	const yearLabels = new Map<number, string>();
	for (const row of normalized.rows) {
		dataStart = dataStart ? minDate(dataStart, row.start) : row.start;
		dataEnd = dataEnd ? maxDate(dataEnd, row.end) : row.end;
		const year = calendar.yearOf(row.start);
		years.add(year.year);
		yearLabels.set(year.year, year.label);
	}

	return {
		config,
		calendar,
		metrics,
		rows: normalized.rows,
		skipped: normalized.skipped,
		dataStart,
		dataEnd,
		years: [...years].sort((a, b) => a - b),
		yearLabels,
		locale,
		zone,
		collator: new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }),
	};
}

export interface LayoutOptions {
	/** Drawing width in CSS pixels. */
	width: number;
	measureText: MeasureText;
	view: ViewRequest;
	theme: Theme;
}

interface Context<T> {
	prepared: PreparedData<T>;
	config: EventCalendarConfig<T>;
	theme: Theme;
	tm: ThemeMetrics;
	measure: MeasureText;
	scale: XScale;
	mode: 'continuous' | 'yoy';
	window: { start: CalendarDate; end: CalendarDate } | null;
	columnX: number[];
	columnWidths: number[];
	gridX: number;
	gridRight: number;
	totalMetrics: ResolvedMetric<T>[];
	allocation: AllocationTarget;
	shows: Set<GroupNode<T>>;
	bars: BarLayout<T>[];
	yearIndex: Map<number, number>;
}

export function computeLayout<T>(prepared: PreparedData<T>, options: LayoutOptions): EventCalendarLayout<T> {
	const { config, calendar } = prepared;
	const theme = options.theme;
	const tm = themeMetrics(theme);
	const measure = options.measureText;
	const width = Math.max(100, Math.floor(options.width));
	const mode = options.view.mode;

	if (!prepared.dataStart || !prepared.dataEnd) return emptyLayout(prepared, width, tm);

	// ---- view window ------------------------------------------------------------------------------------------
	let resolved: ResolvedView | null = null;
	let window: { start: CalendarDate; end: CalendarDate } | null = null;
	let visibleRows: readonly NormalizedRow<T>[] = prepared.rows;
	if (mode === 'continuous') {
		resolved = resolveContinuousView(options.view, prepared.dataStart, prepared.dataEnd, calendar);
		window = { start: resolved.start, end: resolved.end };
		const lo = dayNumber(resolved.start);
		const hi = dayNumber(resolved.end);
		visibleRows = prepared.rows.filter((r) => dayNumber(r.start) <= hi && dayNumber(r.end) >= lo);
	}
	const hideEmpty = config.view?.hideEmptyGroups ?? true;
	const treeRows = hideEmpty ? visibleRows : prepared.rows;
	const tree = buildGroupTree(treeRows, config.groupBy, prepared.metrics, prepared.collator);

	// ---- totals configuration -------------------------------------------------------------------------------------
	const totalsOpt = config.totals ?? {};
	const totalIds = totalsOpt.metrics;
	const totalMetrics = prepared.metrics.filter((m) => !totalIds || totalIds.includes(m.id));
	const enabled = (node: GroupNode<T>): boolean =>
		totalMetrics.length > 0 &&
		(node.level < 0 ? totalsOpt.grand === true : config.groupBy[node.level]?.subtotal === true);
	const shows = new Set<GroupNode<T>>();
	markTotals(tree, enabled, totalsOpt.hideRedundant ?? true, shows);

	// ---- row-header columns ------------------------------------------------------------------------------------
	const levels = config.groupBy.length;
	const labelWidths: number[][] = Array.from({ length: levels }, () => []);
	for (const node of walk(tree)) labelWidths[node.level]?.push(measure(node.label, tm.rowFont));
	const padColumn = (w: number) => Math.max(theme.minHeaderWidth, w) + tm.padding * 2;
	const maxHeader = width * theme.maxHeaderRatio;
	// Full labels when they fit the budget; otherwise the original percentile rule trims outliers.
	let columnWidths = labelWidths.map((widths) => padColumn(Math.ceil(Math.max(0, ...widths))));
	if (sum(columnWidths) > maxHeader) {
		columnWidths = labelWidths.map((widths) =>
			padColumn(columnWidth(widths, theme.headerWidthPercentile, theme.headerWidthMaxShare)),
		);
	}
	// Total rows write "label … value" across the columns from their level rightwards; make room for them.
	if (levels > 0) {
		const needed = new Array<number>(levels).fill(0);
		const consider = (node: GroupNode<T>) => {
			if (!shows.has(node)) return;
			const from = Math.max(0, node.level);
			for (const metric of totalMetrics) {
				const value = node.metrics[metric.id];
				const text = value === null || value === undefined ? '' : metric.format(value);
				const w =
					measure(totalLabel(totalsOpt.label, metric, totalMetrics.length), tm.totalsFont) +
					measure(text, tm.totalsFont) +
					tm.padding * 4;
				needed[from] = Math.max(needed[from] ?? 0, w);
			}
		};
		consider(tree);
		for (const node of walk(tree)) consider(node);
		needed.forEach((w, from) => {
			const have = sum(columnWidths.slice(from));
			const last = columnWidths.length - 1;
			if (w > have) columnWidths[last] = (columnWidths[last] ?? 0) + (w - have);
		});
	}
	const headerTotal = sum(columnWidths);
	if (headerTotal > maxHeader && headerTotal > 0) {
		const factor = maxHeader / headerTotal;
		columnWidths = columnWidths.map((w) => Math.floor(w * factor));
	}
	const columnX: number[] = [];
	let x = theme.marginX;
	for (const w of columnWidths) {
		columnX.push(x);
		x += w;
	}
	const gridX = x + (levels > 0 ? tm.padding : 0);
	const gridRight = width - theme.marginX;
	const gridWidth = Math.max(10, gridRight - gridX);

	const scale =
		mode === 'continuous' && resolved
			? continuousScale(resolved, gridX, gridWidth)
			: yoyScale(calendar, gridX, gridWidth);

	// ---- period columns & allocation target ---------------------------------------------------------------------
	let periodColumns: PeriodColumn[];
	let allocation: AllocationTarget;
	if (mode === 'continuous' && resolved) {
		const keyIndex = new Map(resolved.months.map((m, i) => [m.key, i]));
		periodColumns = resolved.months.map((m) => {
			const left = scale.left(m.start);
			return { period: m, label: m.label, x: left, width: scale.right(m.end) - left };
		});
		allocation = { columns: resolved.months.length, columnOf: (m) => keyIndex.get(m.key) ?? -1, window };
	} else {
		const mw = gridWidth / 12;
		periodColumns = Array.from({ length: 12 }, (_, i) => ({
			period: null,
			label: calendar.monthLabel(i + 1),
			x: gridX + i * mw,
			width: mw,
		}));
		allocation = { columns: 12, columnOf: (m) => m.number - 1, window: null };
	}

	// ---- header tiers ---------------------------------------------------------------------------------------------
	const header =
		mode === 'continuous' && resolved
			? continuousHeader(resolved, calendar, scale, tm, measure, gridX, gridRight)
			: yoyHeader(periodColumns, tm, measure, prepared.years, prepared.yearLabels, theme);

	const yearIndex = new Map(prepared.years.map((y, i) => [y, i]));
	const ctx: Context<T> = {
		prepared,
		config,
		theme,
		tm,
		measure,
		scale,
		mode,
		window,
		columnX,
		columnWidths,
		gridX,
		gridRight,
		totalMetrics,
		allocation,
		shows,
		bars: [],
		yearIndex,
	};

	const { layout: root, bottom } = layoutGroup(ctx, tree, header.height, 0, false);
	const height = Math.ceil(bottom + tm.padding);

	const view: ViewState =
		mode === 'continuous' && resolved
			? {
					mode,
					start: resolved.start,
					end: resolved.end,
					months: resolved.months.length,
					totalMonths: resolved.totalMonths,
					offset: resolved.offset,
					canGoBack: resolved.offset > 0,
					canGoForward: resolved.offset + resolved.months.length < resolved.totalMonths,
				}
			: yoyViewState(prepared);

	return {
		width,
		height,
		headerHeight: header.height,
		gridX,
		gridWidth,
		columnWidths,
		root,
		grandTotal: root.total,
		headerCells: header.cells,
		gridLines: [...header.lines, { x: gridX, kind: 'boundary' }, { x: gridX + gridWidth, kind: 'boundary' }],
		periodColumns,
		legend: header.legend,
		view,
		dayWidth: scale.dayWidth,
		calendar,
		bars: ctx.bars,
		skippedRows: prepared.skipped,
		empty: ctx.bars.length === 0 && root.children.length === 0,
	};
}

/** Bottom-up: does a group get a total row? Mirrors `buildGroupTotalsDetail` (7d5b7f1a). */
function markTotals<T>(
	node: GroupNode<T>,
	enabled: (n: GroupNode<T>) => boolean,
	hideRedundant: boolean,
	shows: Set<GroupNode<T>>,
): void {
	for (const child of node.children) markTotals(child, enabled, hideRedundant, shows);
	if (!enabled(node)) return;
	const onlyChild = node.children.length === 1 ? node.children[0] : undefined;
	const redundant = hideRedundant && node.rows.length === 0 && onlyChild !== undefined && shows.has(onlyChild);
	if (!redundant) shows.add(node);
}

function layoutGroup<T>(
	ctx: Context<T>,
	node: GroupNode<T>,
	top: number,
	siblingIndex: number,
	parentOdd: boolean,
): { layout: GroupLayout<T>; bottom: number } {
	const { tm } = ctx;
	const odd = (siblingIndex % 2 === 1) !== parentOdd;
	let y = top;

	// lanes
	const lanes: LaneLayout<T>[] = [];
	if (node.rows.length > 0) {
		const built = buildLanes(ctx, node, y);
		lanes.push(...built);
		y += Math.max(1, built.length) * tm.laneHeight;
		if (built.length === 0) {
			lanes.push({ rect: { x: ctx.gridX, y: top, width: ctx.gridRight - ctx.gridX, height: tm.laneHeight }, bars: [] });
		}
	}

	// children
	const children: GroupLayout<T>[] = [];
	node.children.forEach((child, i) => {
		const result = layoutGroup(ctx, child, y, i, odd);
		children.push(result.layout);
		y = result.bottom;
	});

	// total row
	let total: TotalRowLayout | null = null;
	if (ctx.shows.has(node)) {
		total = buildTotalRow(ctx, node, y);
		y += total.rect.height;
	}

	const level = node.level;
	const headerX = level >= 0 ? (ctx.columnX[level] ?? ctx.theme.marginX) : ctx.theme.marginX;
	const headerWidth = level >= 0 ? (ctx.columnWidths[level] ?? 0) : 0;
	const rect: Rect = { x: headerX, y: top, width: ctx.gridRight - headerX, height: y - top };
	return {
		layout: {
			id: node.id,
			key: node.key,
			label: node.label,
			level,
			path: node.path,
			rect,
			headerRect: { x: headerX, y: top, width: headerWidth, height: y - top },
			band: odd ? 'odd' : 'even',
			lanes,
			children,
			total,
			info: groupInfo(node),
		},
		bottom: y,
	};
}

function buildLanes<T>(ctx: Context<T>, node: GroupNode<T>, top: number): LaneLayout<T>[] {
	const { prepared, config, tm, scale } = ctx;
	let rows: readonly NormalizedRow<T>[] = node.rows;
	if (ctx.window) {
		const lo = dayNumber(ctx.window.start);
		const hi = dayNumber(ctx.window.end);
		rows = rows.filter((r) => dayNumber(r.start) <= hi && dayNumber(r.end) >= lo);
	}
	const bars = buildBars(
		node.id,
		rows,
		{ mergeOverlapping: config.bars?.mergeOverlapping ?? false, mergeAdjacent: config.bars?.mergeAdjacent ?? false },
		prepared.metrics,
		prepared.calendar,
	);
	if (bars.length === 0) return [];

	const spans = bars.map((bar) => {
		if (ctx.window) {
			const start = maxDate(bar.start, ctx.window.start);
			const end = minDate(bar.end, ctx.window.end);
			return {
				start,
				end,
				clippedStart: dayNumber(start) > dayNumber(bar.start),
				clippedEnd: dayNumber(end) < dayNumber(bar.end),
			};
		}
		const end = clipToYear(prepared.calendar, bar.start, bar.end);
		return { start: bar.start, end, clippedStart: false, clippedEnd: dayNumber(end) < dayNumber(bar.end) };
	});
	const { lanes: laneOf, count } = packLanes(spans.map((s) => scale.interval(s.start, s.end)));

	const laneBars: BarLayout<T>[][] = Array.from({ length: count }, () => []);
	bars.forEach((bar, i) => {
		const span = spans[i];
		const lane = laneOf[i] ?? 0;
		if (!span) return;
		const left = scale.left(span.start);
		const laneTop = top + lane * tm.laneHeight;
		const layout: BarLayout<T> = {
			bar,
			lane,
			rect: {
				x: left,
				y: laneTop + Math.floor((tm.laneHeight - tm.barHeight) / 2),
				width: Math.max(1, scale.right(span.end) - left),
				height: tm.barHeight,
			},
			color: barColor(ctx, bar),
			lines: barLines(ctx, bar),
			icons: config.bars?.icons?.(bar) ?? [],
			clippedStart: span.clippedStart,
			clippedEnd: span.clippedEnd,
		};
		laneBars[lane]?.push(layout);
	});

	return laneBars.map((list, lane) => {
		list.sort((a, b) => a.rect.x - b.rect.x);
		ctx.bars.push(...list);
		return {
			rect: { x: ctx.gridX, y: top + lane * tm.laneHeight, width: ctx.gridRight - ctx.gridX, height: tm.laneHeight },
			bars: list,
		};
	});
}

function barColor<T>(ctx: Context<T>, bar: Bar<T>): string {
	const colors = ctx.theme.colors;
	if (ctx.mode === 'yoy')
		return pick(colors.yearPalette, (ctx.yearIndex.get(bar.year) ?? 0) % colors.yearPalette.length, '#888');
	const custom = ctx.config.bars?.color?.(bar);
	if (custom) return custom;
	return pick(colors.palette, hashString(bar.groupPath[0] ?? '') % Math.max(1, colors.palette.length), '#888');
}

function barLines<T>(ctx: Context<T>, bar: Bar<T>): string[] {
	const max = Math.min(3, Math.max(1, Math.round(ctx.theme.barLines)));
	if (ctx.config.bars?.label) return ctx.config.bars.label(bar, bar.metrics).slice(0, max);
	const first = ctx.prepared.metrics[0];
	const value = first ? bar.metrics[first.id] : null;
	return first && value !== null && value !== undefined ? [first.format(value)] : [];
}

function buildTotalRow<T>(ctx: Context<T>, node: GroupNode<T>, top: number): TotalRowLayout {
	const { tm, totalMetrics, config } = ctx;
	const showPeriods = config.totals?.periods ?? true;
	const label = config.totals?.label ?? 'Total';
	const lines: TotalLine[] = totalMetrics.map((metric) => {
		const value = node.metrics[metric.id] ?? null;
		const periods = showPeriods ? allocate(metric, node.allRows, ctx.prepared.calendar, ctx.allocation) : [];
		return {
			metricId: metric.id,
			label: totalLabel(label, metric, totalMetrics.length),
			value,
			formatted: value === null ? '' : metric.format(value),
			periods,
			formattedPeriods: periods.map((p) => (p === null ? '' : metric.formatPeriod(p))),
		};
	});
	const level = node.level;
	const x = level >= 0 ? (ctx.columnX[level] ?? ctx.theme.marginX) : ctx.theme.marginX;
	const height = lines.length * tm.totalsLineHeight + tm.padding;
	return {
		depth: level + 1,
		rect: { x, y: top, width: ctx.gridRight - x, height },
		headerRect: { x, y: top, width: Math.max(0, ctx.gridX - x - tm.padding), height },
		lines,
	};
}

function continuousHeader(
	view: ResolvedView,
	calendar: TimeCalendar,
	scale: XScale,
	tm: ThemeMetrics,
	measure: MeasureText,
	gridX: number,
	gridRight: number,
): { height: number; cells: HeaderCell[]; lines: GridLine[]; legend: LegendItem[] } {
	const weekWidth = scale.dayWidth * 7;
	const showWeeks = weekWidth >= measure('55', tm.axisFont) * 1.8 + tm.padding;
	const tiers = showWeeks ? 3 : 2;
	const baseline = (tier: number) => tm.padding + tier * tm.axisLineHeight + tm.axisFontSize + 1;
	const cells: HeaderCell[] = [];
	const lines: GridLine[] = [];
	const startDay = dayNumber(view.start);

	const span = (p: Period): { x: number; width: number } => {
		const s = maxDate(p.start, view.start);
		const e = minDate(p.end, view.end);
		const left = Math.max(gridX, scale.left(s));
		return { x: left, width: Math.min(gridRight, scale.right(e)) - left };
	};

	for (const year of periodsBetween(calendar, 'year', view.start, view.end)) {
		const { x, width } = span(year);
		cells.push({
			tier: 'year',
			text: fitText(year.label, width - 4, tm.axisFont, measure),
			x,
			width,
			y: baseline(0),
			align: 'center',
			bracket: true,
		});
	}
	for (const month of view.months) {
		const { x, width } = span(month);
		const text =
			fitText(month.label, width - 4, tm.axisFont, measure) ||
			fitText(month.label.charAt(0), width - 2, tm.axisFont, measure);
		cells.push({ tier: 'month', text, x, width, y: baseline(1), align: 'center', bracket: true });
		if (dayNumber(month.start) > startDay) lines.push({ x: scale.left(month.start), kind: 'month' });
	}
	const monthStarts = new Set(view.months.map((m) => dayNumber(m.start)));
	for (const week of periodsBetween(calendar, 'week', view.start, view.end)) {
		const { x, width } = span(week);
		if (showWeeks)
			cells.push({
				tier: 'week',
				text: fitText(week.label, width - 2, tm.axisFont, measure),
				x,
				width,
				y: baseline(2),
				align: 'center',
				bracket: false,
			});
		const day = dayNumber(week.start);
		if (day > startDay && !monthStarts.has(day)) lines.push({ x: scale.left(week.start), kind: 'week' });
	}

	return { height: tm.padding * 2 + tiers * tm.axisLineHeight, cells, lines, legend: [] };
}

function yoyHeader(
	columns: readonly PeriodColumn[],
	tm: ThemeMetrics,
	measure: MeasureText,
	years: readonly number[],
	yearLabels: ReadonlyMap<number, string>,
	theme: Theme,
): { height: number; cells: HeaderCell[]; lines: GridLine[]; legend: LegendItem[] } {
	const baseline = (tier: number) => tm.padding + tier * tm.axisLineHeight + tm.axisFontSize + 1;
	const cells: HeaderCell[] = columns.map((c) => ({
		tier: 'month' as const,
		text: fitText(c.label, c.width - 4, tm.axisFont, measure),
		x: c.x,
		width: c.width,
		y: baseline(1),
		align: 'center' as const,
		bracket: true,
	}));
	const lines: GridLine[] = columns.slice(1).map((c) => ({ x: c.x, kind: 'month' as const }));
	const legend = years.map((year, i) => ({
		label: yearLabels.get(year) ?? String(year),
		color: pick(theme.colors.yearPalette, i % theme.colors.yearPalette.length, '#888'),
	}));
	return { height: tm.padding * 2 + 2 * tm.axisLineHeight, cells, lines, legend };
}

function yoyViewState<T>(prepared: PreparedData<T>): ViewState {
	const end = prepared.dataEnd as CalendarDate;
	const year = prepared.calendar.yearOf(end);
	return {
		mode: 'yoy',
		start: year.start,
		end: year.end,
		months: 12,
		totalMonths: 12,
		offset: 0,
		canGoBack: false,
		canGoForward: false,
	};
}

function emptyLayout<T>(prepared: PreparedData<T>, width: number, tm: ThemeMetrics): EventCalendarLayout<T> {
	const now = prepared.calendar.monthOf(prepared.dataStart ?? today(prepared.zone));
	const headerHeight = tm.padding * 2 + 2 * tm.axisLineHeight;
	const root: GroupLayout<T> = {
		id: '',
		key: '',
		label: '',
		level: -1,
		path: [],
		rect: { x: 0, y: headerHeight, width, height: 0 },
		headerRect: { x: 0, y: headerHeight, width: 0, height: 0 },
		band: 'even',
		lanes: [],
		children: [],
		total: null,
		info: { key: '', label: '', level: -1, rows: [], metrics: {} },
	};
	return {
		width,
		height: headerHeight + tm.laneHeight * 2,
		headerHeight,
		gridX: 0,
		gridWidth: width,
		columnWidths: [],
		root,
		grandTotal: null,
		headerCells: [],
		gridLines: [],
		periodColumns: [],
		legend: [],
		view: {
			mode: 'continuous',
			start: now.start,
			end: now.end,
			months: 0,
			totalMonths: 0,
			offset: 0,
			canGoBack: false,
			canGoForward: false,
		},
		dayWidth: 0,
		calendar: prepared.calendar,
		bars: [],
		skippedRows: prepared.skipped,
		empty: true,
	};
}

/** One metric: "Total"; several: each line is named after its metric (the shaded row marks it as a total). */
function totalLabel<T>(label: string | undefined, metric: ResolvedMetric<T>, count: number): string {
	return count > 1 ? metric.label : (label ?? 'Total');
}

function sum(values: readonly number[]): number {
	return values.reduce((a, b) => a + b, 0);
}

/** Stable 32-bit string hash (FNV-1a) so colours don't change when navigating. */
export function hashString(value: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}
