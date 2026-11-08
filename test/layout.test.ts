import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { EventCalendarConfig } from '../src/config';
import { packLanes } from '../src/layout/lanes';
import { columnWidth, fitText } from '../src/layout/measure';
import { visibleViewState } from '../src/layout/view';
import { defaultTheme } from '../src/render/theme';
import { generateFlightVehicles } from './fixtures/flightVehicles';
import { fakeMeasure, findGroup, flatGroups, layoutOf } from './helpers';

interface Row {
	id: string;
	g1: string;
	g2: string;
	start: string;
	end: string;
	cost: number;
	cpm?: number;
	type?: string;
}

const base: EventCalendarConfig<Row> = {
	start: (r) => r.start,
	end: (r) => r.end,
	rowId: (r) => r.id,
	groupBy: [{ key: (r) => r.g1 }, { key: (r) => r.g2 }],
	metrics: [{ id: 'cost', label: 'Cost', value: (r) => r.cost }],
	calendar: 'broadcast',
	zone: 'UTC',
};

const row = (
	id: string,
	g1: string,
	g2: string,
	start: string,
	end: string,
	cost = 0,
	extra: Partial<Row> = {},
): Row => ({
	id,
	g1,
	g2,
	start,
	end,
	cost,
	...extra,
});

describe('packLanes', () => {
	it('detects full containment (old findOverlappingEvent bug)', () => {
		// [0,31) contains [9,15): must be different lanes regardless of input order.
		expect(
			packLanes([
				{ lo: 9, hi: 15 },
				{ lo: 0, hi: 31 },
			]).count,
		).toBe(2);
		expect(
			packLanes([
				{ lo: 0, hi: 31 },
				{ lo: 9, hi: 15 },
			]).count,
		).toBe(2);
	});

	it('reuses the lowest free lane and is optimal', () => {
		const { lanes, count } = packLanes([
			{ lo: 0, hi: 10 },
			{ lo: 5, hi: 15 },
			{ lo: 10, hi: 20 },
			{ lo: 15, hi: 25 },
		]);
		expect(count).toBe(2);
		expect(lanes).toEqual([0, 1, 0, 1]);
	});
});

describe('header column widths', () => {
	it('ports RowHeaderDetail.calcWidths (80th percentile vs 85% of widest)', () => {
		expect(columnWidth([100, 50, 40, 30, 20], 80, 0.85)).toBe(85);
		expect(columnWidth([60, 58, 57, 56, 10], 80, 0.85)).toBe(58);
		expect(columnWidth([42], 80, 0.85)).toBe(42);
		expect(columnWidth([], 80, 0.85)).toBe(0);
	});

	it('fits text with an ellipsis', () => {
		expect(fitText('Television', 70, 'x', fakeMeasure)).toBe('Television');
		expect(fitText('Television', 49, 'x', fakeMeasure)).toBe('Televi…');
		expect(fitText('Television', 48, 'x', fakeMeasure)).toBe('Telev…');
		expect(fitText('Television', 5, 'x', fakeMeasure)).toBe('');
	});
});

describe('row-header column sizing', () => {
	const rows = [
		row('1', 'NSW', 'x', '2024-01-01', '2024-01-07', 10),
		row('2', 'SA', 'x', '2024-01-01', '2024-01-07', 10),
		row('3', 'WA', 'x', '2024-01-01', '2024-01-07', 10),
		row('4', 'ACT', 'x', '2024-01-01', '2024-01-07', 10),
		row('5', 'VIC', 'x', '2024-01-01', '2024-01-07', 10),
	];
	const config: EventCalendarConfig<Row> = { ...base, groupBy: [{ key: (r) => r.g1 }] };

	it('shows full labels when they fit the header budget', () => {
		const l = layoutOf(rows, config);
		expect(l.columnWidths[0]).toBeGreaterThanOrEqual(fakeMeasure('NSW'));
	});

	it('falls back to the percentile rule when labels would exceed the budget', () => {
		const long = [...rows, row('6', 'A'.repeat(200), 'x', '2024-01-01', '2024-01-07')];
		const l = layoutOf(long, config);
		expect(l.columnWidths[0]).toBeLessThan(fakeMeasure('A'.repeat(200)));
		expect(l.columnWidths[0]).toBeLessThanOrEqual(1200 * 0.4);
	});

	it('widens columns so total rows fit their label and value', () => {
		const l = layoutOf(rows, {
			...config,
			groupBy: [{ key: (r) => r.g1, subtotal: true }],
			metrics: [{ id: 'cost', label: 'Cost', value: (r) => r.cost, format: (n) => `$${n.toFixed(2)} thousand` }],
			totals: { grand: true },
		});
		const needed = fakeMeasure('Total') + fakeMeasure('$50.00 thousand');
		expect(l.columnWidths[0]).toBeGreaterThanOrEqual(needed);
	});
});

describe('grouping and sorting', () => {
	const rows = [
		row('1', 'b', 'x', '2024-01-01', '2024-01-07', 10),
		row('2', 'a', 'y', '2024-01-01', '2024-01-07', 50),
		row('3', 'C', 'z', '2024-01-01', '2024-01-07', 30),
		row('4', 'a10', 'z', '2024-01-01', '2024-01-07', 1),
		row('5', 'a2', 'z', '2024-01-01', '2024-01-07', 1),
	];

	it('sorts ascending, case-insensitive and numeric-aware by default', () => {
		const l = layoutOf(rows, base);
		expect(l.root.children.map((g) => g.label)).toEqual(['a', 'a2', 'a10', 'b', 'C']);
	});

	it('sorts descending', () => {
		const l = layoutOf(rows, { ...base, groupBy: [{ key: (r) => r.g1, sort: 'desc' }] });
		expect(l.root.children.map((g) => g.label)).toEqual(['C', 'b', 'a10', 'a2', 'a']);
	});

	it('sorts with a comparator over group metrics', () => {
		const l = layoutOf(rows, {
			...base,
			groupBy: [{ key: (r) => r.g1, sort: (a, b) => (b.metrics.cost ?? 0) - (a.metrics.cost ?? 0) }],
		});
		expect(l.root.children.map((g) => g.label)).toEqual(['a', 'C', 'b', 'a10', 'a2']);
	});

	it('uses label accessors and the empty label', () => {
		const l = layoutOf([row('1', '', 'x', '2024-01-01', '2024-01-02')], {
			...base,
			groupBy: [{ key: (r) => r.g1 }, { key: (r) => r.g2, label: (r) => r.g2.toUpperCase() }],
			emptyLabel: '—',
		});
		expect(findGroup(l, '').label).toBe('—');
		expect(findGroup(l, '', 'x').label).toBe('X');
	});

	it('supports no grouping at all', () => {
		const l = layoutOf(rows, { ...base, groupBy: [] });
		expect(l.root.children).toHaveLength(0);
		expect(l.root.lanes.length).toBeGreaterThan(0);
		expect(l.columnWidths).toEqual([]);
	});
});

describe('bars and lanes', () => {
	it('rows with the same group, merge key and dates share one bar', () => {
		const l = layoutOf(
			[
				row('1', 'a', 'x', '2024-01-01', '2024-01-14', 100),
				row('2', 'a', 'x', '2024-01-01', '2024-01-14', 50),
				row('3', 'a', 'x', '2024-01-01', '2024-01-14', 25, { type: 'other' }),
			],
			{ ...base, bars: { mergeKey: (r) => r.type ?? '' } },
		);
		expect(l.bars).toHaveLength(2);
		const merged = l.bars.find((b) => b.bar.rows.length === 2);
		expect(merged?.bar.metrics.cost).toBe(150);
		expect(merged?.lines).toEqual(['150']);
	});

	it('packs a contained bar into a second lane', () => {
		const l = layoutOf(
			[
				row('1', 'a', 'x', '2024-01-01', '2024-01-31'),
				row('2', 'a', 'x', '2024-01-10', '2024-01-15'),
				row('3', 'a', 'x', '2024-02-05', '2024-02-10'),
			],
			base,
		);
		const leaf = findGroup(l, 'a', 'x');
		expect(leaf.lanes).toHaveLength(2);
		expect(leaf.lanes[0]?.bars.map((b) => b.bar.rows[0]?.id)).toEqual(['1', '3']);
	});

	it('mergeOverlapping unions chains of overlaps, optionally adjacent ranges', () => {
		const rows = [
			row('1', 'a', 'x', '2024-01-01', '2024-01-10', 10),
			row('2', 'a', 'x', '2024-01-08', '2024-01-20', 20),
			row('3', 'a', 'x', '2024-01-18', '2024-01-25', 30),
			row('4', 'a', 'x', '2024-01-26', '2024-01-30', 40),
		];
		const merged = layoutOf(rows, { ...base, bars: { mergeOverlapping: true } });
		expect(merged.bars).toHaveLength(2);
		expect(merged.bars[0]?.bar.start.toISODate()).toBe('2024-01-01');
		expect(merged.bars[0]?.bar.end.toISODate()).toBe('2024-01-25');
		expect(merged.bars[0]?.bar.metrics.cost).toBe(60);

		const adjacent = layoutOf(rows, { ...base, bars: { mergeOverlapping: true, mergeAdjacent: true } });
		expect(adjacent.bars).toHaveLength(1);
		expect(adjacent.bars[0]?.bar.rows.map((r) => r.id)).toEqual(['1', '2', '3', '4']);
	});

	it('never mutates input rows', () => {
		const rows = Object.freeze([Object.freeze(row('1', 'a', 'x', '2024-01-01', '2024-01-10', 10))]);
		expect(() => layoutOf(rows, base)).not.toThrow();
	});

	it('skips rows with invalid dates and reports them', () => {
		const l = layoutOf(
			[row('1', 'a', 'x', 'nope', '2024-01-10'), row('2', 'a', 'x', '2024-01-01', '2024-01-10')],
			base,
		);
		expect(l.skippedRows).toEqual([{ index: 0, reason: 'invalid start date' }]);
		expect(l.bars).toHaveLength(1);
	});
});

describe('totals (parity with commit 7d5b7f1a)', () => {
	// Broadcast 2024: Jan = 1 Jan–28 Jan, Feb = 29 Jan–25 Feb, Mar = 26 Feb–31 Mar.
	const rows = [
		row('A', 'X', 'a', '2024-01-22', '2024-02-04', 1400), // 14 days @100: Jan 700, Feb 700
		row('B', 'Y', 'b', '2024-02-19', '2024-03-03', 2800), // 14 days @200: Feb 1400, Mar 1400
		row('C', 'Y', 'c', '2024-03-04', '2024-03-10', 700), // 7 days @100: Mar 700
	];
	const config: EventCalendarConfig<Row> = {
		...base,
		groupBy: [
			{ key: (r) => r.g1, subtotal: true },
			{ key: (r) => r.g2, subtotal: true },
		],
		totals: { grand: true },
	};

	it('allocates pro-rata by days into broadcast months', () => {
		const l = layoutOf(rows, config);
		expect(l.periodColumns.map((c) => c.label)).toEqual(['Jan', 'Feb', 'Mar']);
		expect(l.grandTotal?.lines[0]?.periods).toEqual([700, 2100, 2100]);
		expect(l.grandTotal?.lines[0]?.value).toBe(4900);
		expect(findGroup(l, 'Y').total?.lines[0]?.periods).toEqual([null, 1400, 2100]);
	});

	it('hides a sub-total that would repeat its only child (buildGroupTotalsDetail rule)', () => {
		const l = layoutOf(rows, config);
		expect(findGroup(l, 'X').total).toBeNull(); // one child "a" already shows the same numbers
		expect(findGroup(l, 'X', 'a').total).not.toBeNull();
		expect(findGroup(l, 'Y').total).not.toBeNull(); // two children
		expect(l.grandTotal).not.toBeNull();

		const all = layoutOf(rows, { ...config, totals: { grand: true, hideRedundant: false } });
		expect(findGroup(all, 'X').total).not.toBeNull();
	});

	it('shows a single-child group total when the child level has no sub-totals', () => {
		const l = layoutOf(rows, { ...config, groupBy: [{ key: (r) => r.g1, subtotal: true }, { key: (r) => r.g2 }] });
		expect(findGroup(l, 'X').total?.lines[0]?.value).toBe(1400);
	});

	it('clips period cells to the view, totals stay full row values', () => {
		const l = layoutOf(rows, config, { months: 2 });
		const line = l.grandTotal?.lines[0];
		expect(line?.periods).toEqual([700, 2100]);
		expect(line?.value).toBe(4200); // row C is outside the view; A and B count in full
	});

	it('period cells of the visible window sum to the clipped value', () => {
		const fv = generateFlightVehicles();
		const l = layoutOf(fv, {
			start: (r) => r.startDate,
			end: (r) => r.endDate,
			groupBy: [{ key: (r) => r.mediaType }],
			metrics: [{ id: 'cost', label: 'Cost', value: (r) => r.cost }],
			totals: { grand: true },
			zone: 'UTC',
		});
		const line = l.grandTotal?.lines[0];
		const periodSum = (line?.periods ?? []).reduce<number>((a, b) => a + (b ?? 0), 0);
		expect(periodSum).toBeCloseTo(line?.value ?? 0, 6);
	});

	it('computes avg from raw rows, not from averages of groups', () => {
		const l = layoutOf(
			[
				row('1', 'a', 'x', '2024-01-01', '2024-01-07', 0, { cpm: 10 }),
				row('2', 'a', 'x', '2024-01-01', '2024-01-07', 0, { cpm: 20 }),
				row('3', 'b', 'x', '2024-01-01', '2024-01-07', 0, { cpm: 30 }),
			],
			{
				...base,
				metrics: [{ id: 'cpm', label: 'CPM', value: (r) => r.cpm, aggregate: 'avg' }],
				totals: { grand: true },
			},
		);
		expect(l.grandTotal?.lines[0]?.value).toBe(20);
		expect(l.grandTotal?.lines[0]?.periods).toEqual([20]); // 'active' allocation by default for avg
	});

	it('formats period cells with formatPeriod when given', () => {
		const l = layoutOf(rows, {
			...config,
			metrics: [
				{ id: 'cost', label: 'Cost', value: (r) => r.cost, format: (n) => `$${n}`, formatPeriod: (n) => `${n / 100}h` },
			],
		});
		expect(l.grandTotal?.lines[0]?.formatted).toBe('$4900');
		expect(l.grandTotal?.lines[0]?.formattedPeriods).toEqual(['7h', '21h', '21h']);
	});

	it('supports start/end/none allocation and several metrics', () => {
		const l = layoutOf(rows, {
			...config,
			metrics: [
				{ id: 'cost', label: 'Cost', value: (r) => r.cost, allocate: 'start' },
				{ id: 'n', label: 'Flights', value: () => 1, aggregate: 'count', allocate: 'none' },
			],
		});
		const [cost, count] = l.grandTotal?.lines ?? [];
		expect(cost?.periods).toEqual([1400, 2800, 700]);
		expect(cost?.label).toBe('Cost'); // several metrics: lines are named after their metric
		expect(count?.value).toBe(3);
		expect(count?.periods).toEqual([null, null, null]);
	});

	it('places total rows below the group’s lanes and children', () => {
		const l = layoutOf(rows, config);
		const y = findGroup(l, 'Y');
		const lastChild = y.children[y.children.length - 1];
		expect(y.total?.rect.y).toBe((lastChild?.rect.y ?? 0) + (lastChild?.rect.height ?? 0));
		expect(y.rect.y + y.rect.height).toBe((y.total?.rect.y ?? 0) + (y.total?.rect.height ?? 0));
	});
});

describe('view window', () => {
	const rows = [row('1', 'a', 'x', '2024-01-08', '2024-01-14'), row('2', 'b', 'x', '2024-06-03', '2024-06-09')];

	it('defaults to every month with data', () => {
		const l = layoutOf(rows, base);
		expect(l.view.months).toBe(6);
		expect(l.view.start.toISODate()).toBe('2024-01-01');
		expect(l.view.canGoBack).toBe(false);
		expect(l.view.canGoForward).toBe(false);
	});

	it('clamps the requested window to the data and hides empty groups', () => {
		const l = layoutOf(rows, base, { months: 2, start: null });
		expect(l.view.offset).toBe(0);
		expect(l.view.canGoForward).toBe(true);
		expect(l.root.children.map((g) => g.key)).toEqual(['a']);

		const late = layoutOf(rows, base, { months: 2, start: DateTime.utc(2025, 3, 1) });
		expect(late.view.offset).toBe(4);
		expect(late.view.start.toISODate()).toBe('2024-04-29');
		expect(late.view.canGoForward).toBe(false);
		expect(late.root.children.map((g) => g.key)).toEqual(['b']);
	});

	it('keeps empty groups when hideEmptyGroups is false', () => {
		const l = layoutOf(rows, { ...base, view: { hideEmptyGroups: false } }, { months: 2 });
		expect(l.root.children.map((g) => g.key)).toEqual(['a', 'b']);
		expect(findGroup(l, 'b', 'x').lanes[0]?.bars).toEqual([]);
	});

	it('marks bars clipped by the view edge', () => {
		const l = layoutOf(
			[row('1', 'a', 'x', '2024-01-22', '2024-02-10'), row('2', 'a', 'y', '2024-03-04', '2024-03-10')],
			base,
			{
				months: 1,
			},
		);
		const bar = l.bars[0];
		if (!bar) throw new Error('expected a bar');
		expect(bar.clippedEnd).toBe(true);
		expect(bar.rect.x).toBeCloseTo(l.gridX + 21 * l.dayWidth, 6);
		expect(bar.rect.x + bar.rect.width).toBeCloseTo(l.gridX + l.gridWidth, 6);
	});

	it('produces year, month and week header tiers and grid lines', () => {
		const l = layoutOf(rows, base);
		const tiers = new Set(l.headerCells.map((c) => c.tier));
		expect([...tiers]).toEqual(['year', 'month', 'week']);
		expect(l.headerCells.filter((c) => c.tier === 'month').map((c) => c.text)).toEqual([
			'Jan',
			'Feb',
			'Mar',
			'Apr',
			'May',
			'Jun',
		]);
		expect(l.gridLines.filter((g) => g.kind === 'month')).toHaveLength(5);
		expect(l.gridLines.filter((g) => g.kind === 'boundary')).toHaveLength(2);
	});

	it('drops the week tier when weeks are too narrow', () => {
		const long = [row('1', 'a', 'x', '2020-01-06', '2020-01-12'), row('2', 'a', 'x', '2024-12-02', '2024-12-08')];
		const l = layoutOf(long, base, {}, { width: 600 });
		expect(l.headerCells.some((c) => c.tier === 'week')).toBe(false);
	});
});

describe('year-over-year mode', () => {
	const rows = [
		row('1', 'a', 'x', '2023-01-02', '2023-01-15', 100),
		row('2', 'a', 'x', '2024-01-01', '2024-01-14', 200),
		row('3', 'a', 'x', '2024-06-03', '2024-06-09', 300),
	];

	it('overlays years month-for-month and packs lanes on the projected axis', () => {
		const l = layoutOf(rows, { ...base, totals: { grand: true } }, { mode: 'yoy' });
		expect(l.view.mode).toBe('yoy');
		expect(l.periodColumns).toHaveLength(12);
		const jan2024 = l.bars.find((b) => b.bar.rows[0]?.id === '2');
		const jan2023 = l.bars.find((b) => b.bar.rows[0]?.id === '1');
		expect(jan2024?.rect.x).toBeCloseTo(l.gridX, 6); // 1 Jan 2024 starts broadcast January
		expect(jan2023?.lane).not.toBe(jan2024?.lane); // both in January → separate lanes
		expect(l.legend.map((i) => i.label)).toEqual(['2023', '2024']);
		expect(jan2023?.color).not.toBe(jan2024?.color);
	});

	it('totals each month-of-year across all years', () => {
		const l = layoutOf(rows, { ...base, totals: { grand: true } }, { mode: 'yoy' });
		const periods = l.grandTotal?.lines[0]?.periods ?? [];
		expect(periods[0]).toBe(300);
		expect(periods[5]).toBe(300);
	});
});

describe('fixture smoke', () => {
	it('lays out the synthetic plan with sub-totals at every level', () => {
		const fv = generateFlightVehicles();
		const l = layoutOf(fv, {
			start: (r) => r.startDate,
			end: (r) => r.endDate,
			rowId: (r) => r.id,
			groupBy: [
				{ key: (r) => r.mediaGroup, subtotal: true },
				{ key: (r) => r.mediaType, subtotal: true },
				{ key: (r) => r.vehicle },
			],
			metrics: [
				{ id: 'cost', label: 'Cost', value: (r) => r.cost, format: (n) => `$${Math.round(n).toLocaleString('en-US')}` },
			],
			totals: { grand: true },
			zone: 'UTC',
		});
		expect(l.empty).toBe(false);
		expect(l.bars.length).toBeGreaterThan(40);
		expect(flatGroups(l.root).filter((g) => g.level === 0)).toHaveLength(3);
		const sum = fv.reduce((a, r) => a + r.cost, 0);
		expect(l.grandTotal?.lines[0]?.value).toBe(sum);
		expect(l.grandTotal?.lines[0]?.formatted).toBe(`$${sum.toLocaleString('en-US')}`);
		expect(l.height).toBeGreaterThan(l.headerHeight);
	});
});

describe('scrollable range (range: all)', () => {
	const rows = [row('1', 'a', 'x', '2024-01-08', '2024-01-14'), row('2', 'b', 'x', '2024-06-03', '2024-06-09')];
	const gregorian = { ...base, calendar: 'gregorian' as const };

	it('lays out every month at the zoom of the requested window', () => {
		const window = layoutOf(rows, gregorian, { months: 2 });
		const all = layoutOf(rows, gregorian, { months: 2 }, { range: 'all' });
		expect(all.range?.start.toISODate()).toBe('2024-01-01');
		expect(all.range?.end.toISODate()).toBe('2024-06-30');
		expect(all.periodColumns).toHaveLength(6);
		// Jan + Feb 2024 (60 days) fill the visible grid; the whole range is 182 days.
		expect(all.gridX).toBe(window.gridX);
		expect(all.dayWidth).toBeCloseTo(window.gridWidth / 60, 6);
		expect(all.gridWidth).toBeCloseTo(all.dayWidth * 182, 6);
		expect(all.width).toBe(Math.ceil(all.gridX + all.gridWidth + defaultTheme.marginX));
		// Only groups with rows in the requested months are listed; the layout's view is the requested window.
		expect(all.root.children.map((g) => g.key)).toEqual(['a']);
		expect(all.shown?.start.toISODate()).toBe('2024-01-01');
		expect(all.shown?.end.toISODate()).toBe('2024-02-29');
		expect(all.view.months).toBe(2);
		expect(all.view.start.toISODate()).toBe('2024-01-01');
	});

	it('lists the groups of the shown months (snapped to whole months) at a fixed grid position', () => {
		const costly = [
			row('1', 'a', 'x', '2024-01-08', '2024-01-14', 100),
			row('2', 'a-very-long-group-label', 'x', '2024-06-03', '2024-06-09', 200),
		];
		const config = { ...gregorian, totals: { grand: true } };
		const early = layoutOf(costly, config, { months: 2 }, { range: 'all' });
		const late = layoutOf(
			costly,
			config,
			{ months: 2 },
			{ range: 'all', shown: { start: DateTime.utc(2024, 5, 20), end: DateTime.utc(2024, 6, 5) } },
		);
		expect(late.shown?.start.toISODate()).toBe('2024-05-01');
		expect(late.shown?.end.toISODate()).toBe('2024-06-30');
		expect(late.root.children.map((g) => g.key)).toEqual(['a-very-long-group-label']);
		expect(late.gridX).toBe(early.gridX);
		expect(late.columnWidths).toEqual(early.columnWidths);
		// Totals and month cells cover the shown months only.
		const line = late.grandTotal?.lines[0];
		expect(line?.value).toBe(200);
		expect(line?.periods.filter((v) => v !== null)).toEqual([200]);
		// hideEmptyGroups: false lists everything.
		const everything = layoutOf(
			costly,
			{ ...config, view: { hideEmptyGroups: false } },
			{ months: 2 },
			{ range: 'all' },
		);
		expect(everything.root.children).toHaveLength(2);
	});

	it('budgets row headings from the visible width, not the expanded width', () => {
		const fit = layoutOf(rows, gregorian);
		const wide = layoutOf(rows, gregorian, {}, { widthScale: 3 });
		expect(wide.columnWidths).toEqual(fit.columnWidths);
		expect(wide.gridWidth).toBeCloseTo(fit.gridWidth * 3, 6);
	});

	it('derives the visible window from the scroll position', () => {
		const all = layoutOf(rows, gregorian, { months: 2 }, { range: 'all' });
		const visible = all.gridWidth * (60 / 182);
		const at = (x: number) => visibleViewState(all, x, visible);
		expect(at(0)).toMatchObject({ offset: 0, months: 2, canGoBack: false, canGoForward: true });
		expect(at(0).start.toISODate()).toBe('2024-01-01');
		expect(at(0).end.toISODate()).toBe('2024-02-29');
		const march = at(60 * all.dayWidth);
		expect(march.offset).toBe(2);
		expect(march.start.toISODate()).toBe('2024-03-01');
		const end = at(all.gridWidth - visible);
		expect(end.canGoForward).toBe(false);
		expect(end.end.toISODate()).toBe('2024-06-30');
	});

	it('returns the layout view when nothing scrolls through time', () => {
		const yoy = layoutOf(rows, gregorian, { mode: 'yoy' }, { range: 'all' });
		expect(yoy.range).toBeNull();
		expect(visibleViewState(yoy, 100, 200)).toBe(yoy.view);
	});
});
