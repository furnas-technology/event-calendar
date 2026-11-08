// @vitest-environment jsdom
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EventCalendarConfig } from '../src/config';
import { EventCalendar } from '../src/eventCalendar';
import type { BarLayout } from '../src/layout/types';

interface Row {
	id: string;
	group: string;
	start: string;
	end: string;
	cost: number;
}

const rows: Row[] = [
	{ id: '1', group: 'A', start: '2024-01-08', end: '2024-01-21', cost: 1000 },
	{ id: '2', group: 'B', start: '2024-03-04', end: '2024-03-17', cost: 2000 },
	{ id: '3', group: 'B', start: '2024-06-03', end: '2024-06-16', cost: 3000 },
];

const config: EventCalendarConfig<Row> = {
	start: (r) => r.start,
	end: (r) => r.end,
	rowId: (r) => r.id,
	groupBy: [{ key: (r) => r.group, subtotal: true }],
	metrics: [{ id: 'cost', label: 'Cost', value: (r) => r.cost }],
	totals: { grand: true },
	zone: 'UTC',
};

beforeAll(() => {
	// jsdom has no canvas implementation; back each element with a node canvas context.
	const contexts = new WeakMap<HTMLCanvasElement, unknown>();
	HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
		let ctx = contexts.get(this);
		if (!ctx) {
			ctx = createCanvas(2000, 2000).getContext('2d');
			contexts.set(this, ctx);
		}
		return ctx;
	} as unknown as HTMLCanvasElement['getContext'];
});

let mounted: EventCalendar<Row>[] = [];
afterEach(() => {
	for (const t of mounted) t.destroy();
	mounted = [];
	document.body.innerHTML = '';
});

function mount(extra: Partial<EventCalendarConfig<Row>> = {}): EventCalendar<Row> {
	const host = document.createElement('div');
	document.body.append(host);
	const t = new EventCalendar(host, { ...config, ...extra }, rows);
	mounted.push(t);
	return t;
}

function pointer(target: Element, type: string, x: number, y: number, pointerType = ''): void {
	target.dispatchEvent(
		new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true, pointerType }),
	);
}

const viewportOf = (t: EventCalendar<Row>) => t.element.querySelector('.ft-event-calendar-viewport') as HTMLElement;
const tooltipOf = (t: EventCalendar<Row>) => t.element.querySelector('.ft-event-calendar-tooltip') as HTMLElement;

/** Scroll the calendar's viewport as a user would (jsdom stores scrollLeft without layout). */
function scrollTo(t: EventCalendar<Row>, left: number): void {
	const viewport = viewportOf(t);
	viewport.scrollLeft = left;
	viewport.dispatchEvent(new Event('scroll'));
}

function barOf(t: EventCalendar<Row>, id: string): BarLayout<Row> {
	const bar = t.getLayout()?.bars.find((b) => b.bar.rows[0]?.id === id);
	if (!bar) throw new Error(`bar ${id} is not laid out`);
	return bar;
}

const center = (b: BarLayout<Row>) => ({ x: b.rect.x + b.rect.width / 2, y: b.rect.y + b.rect.height / 2 });

describe('EventCalendar', () => {
	it('mounts a canvas, tooltip and badge into the container and renders synchronously', () => {
		const t = mount();
		expect(t.element.querySelector('canvas')).toBe(t.canvas);
		// viewport (scroll container) > track > canvas, plus the tooltip and badge; no controls unless asked for
		expect(t.element.querySelectorAll('div')).toHaveLength(4);
		expect(t.element.querySelector('.ft-event-calendar-viewport > .ft-event-calendar-track > canvas')).toBe(t.canvas);
		expect(t.element.querySelector('.ft-event-calendar-viewport .ft-event-calendar-tooltip')).toBeNull();
		expect(t.canvas.style.position).toBe('sticky');
		expect(t.element.querySelector('.ft-event-calendar-controls')).toBeNull();
		const layout = t.getLayout();
		expect(layout?.bars).toHaveLength(3);
		expect(t.canvas.style.height).toBe(`${layout?.height}px`);
		expect(t.canvas.getAttribute('aria-label')).toContain('3 bars');
	});

	it('navigates by month and reports view changes', () => {
		const t = mount({ view: { months: 2 } });
		const views: number[] = [];
		t.on('viewchange', (v) => views.push(v.offset));
		t.next();
		t.render();
		expect(t.getViewState()?.offset).toBe(1);
		t.last();
		t.render();
		expect(t.getViewState()?.offset).toBe(4);
		expect(t.getViewState()?.canGoForward).toBe(false);
		t.first();
		t.render();
		expect(views).toEqual([1, 4, 0]);
		t.setVisibleMonths('all');
		t.render();
		expect(t.getViewState()?.months).toBe(6);
	});

	it('emits click with the bar rows', () => {
		const t = mount();
		const onClick = vi.fn();
		t.on('click', onClick);
		const bar = t.getLayout()?.bars[0];
		if (!bar) throw new Error('no bar');
		const { x, y } = center(bar);
		pointer(t.canvas, 'pointerdown', x, y);
		pointer(t.canvas, 'pointerup', x, y);
		expect(onClick).toHaveBeenCalledOnce();
		expect(onClick.mock.calls[0]?.[0].rows.map((r: Row) => r.id)).toEqual(['1']);
	});

	it('shows a text-only tooltip on hover', () => {
		const t = mount({ tooltip: (bar) => `<b>${bar.groupLabels[0]}</b>` });
		const bar = t.getLayout()?.bars[0];
		if (!bar) throw new Error('no bar');
		const { x, y } = center(bar);
		pointer(t.canvas, 'pointermove', x, y);
		const tip = t.element.querySelector('.ft-event-calendar-tooltip') as HTMLElement;
		expect(tip.style.visibility).toBe('visible');
		expect(tip.textContent).toBe('<b>A</b>');
		expect(tip.querySelector('b')).toBeNull();
	});

	it('drags a bar by whole days and keeps it when the move is accepted', async () => {
		const t = mount({ editable: true });
		const moves: number[] = [];
		t.on('move', (e) => {
			moves.push(e.deltaDays);
			expect(e.newStart.toISODate()).toBe('2024-01-15');
			return Promise.resolve(true);
		});
		const layout = t.getLayout();
		const bar = layout?.bars.find((b) => b.bar.rows[0]?.id === '1');
		if (!layout || !bar) throw new Error('no bar');
		const { x, y } = center(bar);
		pointer(t.canvas, 'pointerdown', x, y);
		pointer(t.canvas, 'pointermove', x + layout.dayWidth * 7, y);
		pointer(t.canvas, 'pointerup', x + layout.dayWidth * 7, y);
		await vi.waitFor(() => expect(moves).toEqual([7]));
	});

	it('reverts a rejected move and clamps to the view', async () => {
		const t = mount({ editable: true });
		const moves: number[] = [];
		t.on('move', (e) => {
			moves.push(e.deltaDays);
			return false;
		});
		const layout = t.getLayout();
		const bar = layout?.bars.find((b) => b.bar.rows[0]?.id === '1');
		if (!layout || !bar) throw new Error('no bar');
		const { x, y } = center(bar);
		pointer(t.canvas, 'pointerdown', x, y);
		pointer(t.canvas, 'pointermove', x - layout.dayWidth * 60, y);
		pointer(t.canvas, 'pointerup', x - layout.dayWidth * 60, y);
		// Bar 1 starts on 8 Jan; the view starts on 1 Jan, so it can move back at most 7 days.
		await vi.waitFor(() => expect(moves).toEqual([-7]));
	});

	it('sets totals depth like the original totals toggle', () => {
		const t = mount();
		t.setTotalsDepth('none');
		t.render();
		expect(t.getLayout()?.grandTotal).toBeNull();
		t.setTotalsDepth(0);
		t.render();
		expect(t.getLayout()?.grandTotal).not.toBeNull();
		expect(t.getLayout()?.root.children.every((g) => g.total === null)).toBe(true);
	});

	it('zooms and resets the scale', () => {
		const t = mount();
		const h = t.getLayout()?.height ?? 0;
		t.zoom(1.5);
		t.render();
		expect(t.getLayout()?.height).toBeGreaterThan(h);
		t.zoom('reset');
		t.render();
		expect(t.getLayout()?.height).toBe(h);
	});

	it('expands and fits the width of the time grid', () => {
		const t = mount();
		const before = t.getLayout();
		const w = before?.width ?? 0;
		const gw = before?.gridWidth ?? 0;
		t.expandWidth(2);
		t.render();
		expect(t.getLayout()?.gridWidth).toBeCloseTo(gw * 2, 6);
		expect(t.getLayout()?.columnWidths).toEqual(before?.columnWidths);
		t.fitWidth();
		t.render();
		expect(t.getLayout()?.width).toBe(w);
	});

	describe('scrolling', () => {
		it('scrolls through every month; navigation moves the scroll position', () => {
			const t = mount({ view: { months: 2 }, calendar: 'gregorian' });
			const layout = t.getLayout();
			if (!layout?.range) throw new Error('expected a scrollable range');
			expect(layout.range.start.toISODate()).toBe('2024-01-01');
			expect(layout.range.end.toISODate()).toBe('2024-06-30');
			expect(t.canvas.style.width).toBe('800px');
			expect(layout.width).toBeGreaterThan(800);
			t.next();
			expect(viewportOf(t).scrollLeft).toBeCloseTo(31 * layout.dayWidth, 6);
			expect(t.getViewState()?.start.toISODate()).toBe('2024-02-01');
			// Previous from mid-month goes to the start of that month.
			scrollTo(t, 40 * layout.dayWidth);
			expect(t.getViewState()?.start.toISODate()).toBe('2024-02-10');
			t.prev();
			expect(t.getViewState()?.start.toISODate()).toBe('2024-02-01');
		});

		it('emits viewchange as the user scrolls and keeps the position across re-renders', () => {
			const t = mount({ view: { months: 2 } });
			const offsets: number[] = [];
			t.on('viewchange', (v) => offsets.push(v.offset));
			const dayWidth = t.getLayout()?.dayWidth ?? 0;
			scrollTo(t, 70 * dayWidth);
			expect(offsets).toEqual([2]);
			t.setData([...rows]);
			t.render();
			expect(viewportOf(t).scrollLeft).toBeCloseTo(70 * dayWidth, 6);
		});

		it('keeps the old window behaviour with range: window', () => {
			const t = mount({ view: { months: 2, range: 'window' } });
			expect(t.getLayout()?.periodColumns).toHaveLength(2);
			t.next();
			t.render();
			expect(t.getLayout()?.view.offset).toBe(1);
			expect(t.getLayout()?.periodColumns).toHaveLength(2);
		});

		it('maps pointer positions through the scroll, except over fixed headings', () => {
			const hitAfterScroll = (extra: Partial<EventCalendarConfig<Row>>) => {
				const t = mount({ view: { months: 2 }, ...extra });
				// March is listed once it is in view; then scroll bar 2 to just right of the left edge, under the headings.
				t.next();
				const bar = barOf(t, '2');
				const onClick = vi.fn();
				t.on('click', onClick);
				scrollTo(t, bar.rect.x - 10);
				// Other months are in view now, so the rows may have moved: read the bar again.
				const moved = barOf(t, '2');
				const y = moved.rect.y + moved.rect.height / 2;
				pointer(t.canvas, 'pointerdown', 15, y);
				pointer(t.canvas, 'pointerup', 15, y);
				return onClick.mock.calls.length;
			};
			expect(hitAfterScroll({ fixedRowHeadings: false })).toBe(1);
			expect(hitAfterScroll({ fixedRowHeadings: true })).toBe(0);
			// 'auto' (default): jsdom's window is 1024px wide, at least the 768px default breakpoint.
			expect(hitAfterScroll({})).toBe(0);
			expect(hitAfterScroll({ fixedRowHeadingsMinWidth: 1200 })).toBe(1);
		});

		it('follows a matchMedia breakpoint for fixedRowHeadings: auto', () => {
			const listeners: (() => void)[] = [];
			const query = {
				matches: false,
				addEventListener: (_: string, l: () => void) => listeners.push(l),
				removeEventListener: () => {},
			};
			const other = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
			const matchMedia = vi.fn((q: string) => (q.startsWith('(min-width') ? query : other));
			vi.stubGlobal('matchMedia', matchMedia);
			try {
				const t = mount({ view: { months: 2 } });
				expect(matchMedia).toHaveBeenCalledWith('(min-width: 768px)');
				t.next();
				const bar = barOf(t, '2');
				const onClick = vi.fn();
				t.on('click', onClick);
				scrollTo(t, bar.rect.x - 10);
				// Other months are in view now, so the rows may have moved: read the bar again.
				const moved = barOf(t, '2');
				const y = moved.rect.y + moved.rect.height / 2;
				const click = () => {
					pointer(t.canvas, 'pointerdown', 15, y);
					pointer(t.canvas, 'pointerup', 15, y);
				};
				click();
				expect(onClick).toHaveBeenCalledTimes(1); // narrow window: headings scroll
				query.matches = true;
				for (const l of listeners) l();
				t.render();
				scrollTo(t, bar.rect.x - 10);
				click();
				expect(onClick).toHaveBeenCalledTimes(1); // wide window: fixed headings cover x = 15
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it('pans with a mouse drag on the background without clicking', () => {
			const t = mount({ view: { months: 2 } });
			const onClick = vi.fn();
			t.on('click', onClick);
			const layout = t.getLayout();
			if (!layout) throw new Error('no layout');
			const y = layout.headerHeight / 2; // the time axis: no bar there
			pointer(t.canvas, 'pointerdown', 400, y, 'mouse');
			pointer(t.canvas, 'pointermove', 300, y, 'mouse');
			pointer(t.canvas, 'pointerup', 300, y, 'mouse');
			expect(viewportOf(t).scrollLeft).toBe(100);
			expect(onClick).not.toHaveBeenCalled();
		});

		it('lists only the groups with rows in the months in view, keeping the grid in place', () => {
			const t = mount({ view: { months: 2 } });
			const keys = () => t.getLayout()?.root.children.map((g) => g.key);
			const gridX = t.getLayout()?.gridX;
			expect(keys()).toEqual(['A']);
			t.next(); // Feb–Mar: bar 2 starts 4 Mar
			expect(keys()).toEqual(['B']);
			expect(t.getLayout()?.gridX).toBe(gridX);
			t.last();
			expect(keys()).toEqual(['B']);
			expect(t.getLayout()?.bars.map((b) => b.bar.rows[0]?.id)).toEqual(['3']);
			// Totals cover the listed months only (the grand total would repeat B's, so B's sub-total shows).
			expect(t.getLayout()?.root.children[0]?.total?.lines[0]?.formatted).toBe('3,000');
			t.setConfig({ view: { months: 2, hideEmptyGroups: false } });
			t.render();
			expect(keys()).toEqual(['A', 'B']);
		});

		it('uses a scroll box with maxHeight', () => {
			const t = mount({ maxHeight: 300 });
			expect(viewportOf(t).style.maxHeight).toBe('300px');
			expect(viewportOf(t).style.overflowY).toBe('auto');
			t.setConfig({ maxHeight: '70vh' });
			t.render();
			expect(viewportOf(t).style.maxHeight).toBe('70vh');
		});
	});

	describe('pinned tooltip', () => {
		const tap = (t: EventCalendar<Row>, bar: BarLayout<Row>) => {
			const { x, y } = center(bar);
			pointer(t.canvas, 'pointerdown', x, y, 'touch');
			pointer(t.canvas, 'pointerup', x, y, 'touch');
		};

		it('opens on tap, survives hover changes and closes on Escape or a press outside', () => {
			const t = mount();
			const bar = t.getLayout()?.bars[0];
			if (!bar) throw new Error('no bar');
			tap(t, bar);
			const tip = tooltipOf(t);
			expect(tip.style.visibility).toBe('visible');
			expect(tip.style.pointerEvents).toBe('auto');
			expect(tip.style.position).toBe('fixed');
			expect(tip.style.width).toBe('max-content');
			pointer(t.canvas, 'pointermove', 1, 1);
			expect(tip.style.visibility).toBe('visible');

			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
			expect(tip.style.visibility).toBe('hidden');

			tap(t, bar);
			expect(tip.style.visibility).toBe('visible');
			pointer(tip, 'pointerdown', 0, 0);
			expect(tip.style.visibility).toBe('visible'); // a press inside keeps it open
			pointer(document.body, 'pointerdown', 0, 0);
			expect(tip.style.visibility).toBe('hidden');
		});

		it('toggles on the same bar and stays closed with tooltipOnClick: false', () => {
			const t = mount();
			const bar = t.getLayout()?.bars[0];
			if (!bar) throw new Error('no bar');
			tap(t, bar);
			tap(t, bar);
			expect(tooltipOf(t).style.visibility).toBe('hidden');
			t.setConfig({ tooltipOnClick: false });
			t.render();
			tap(t, bar);
			expect(tooltipOf(t).style.visibility).toBe('hidden');
		});

		it('fits the window: max size from the visible area, measured at the origin', () => {
			const t = mount();
			const bar = t.getLayout()?.bars[0];
			if (!bar) throw new Error('no bar');
			tap(t, bar);
			const tip = tooltipOf(t);
			expect(tip.style.maxWidth).toBe(`${window.innerWidth - 8}px`);
			expect(tip.style.whiteSpace).toBe('normal');
		});
	});

	it('destroy removes the element and stops events', () => {
		const t = mount();
		const onClick = vi.fn();
		t.on('click', onClick);
		const canvas = t.canvas;
		t.destroy();
		expect(document.querySelector('.ft-event-calendar')).toBeNull();
		pointer(canvas, 'pointerdown', 1, 1);
		expect(onClick).not.toHaveBeenCalled();
	});

	describe('controls', () => {
		const buttons = (t: EventCalendar<Row>) =>
			[...t.element.querySelectorAll<HTMLButtonElement>('.ft-event-calendar-controls button')].map(
				(b) => b.textContent,
			);
		const byLabel = (t: EventCalendar<Row>, label: string) =>
			t.element.querySelector<HTMLButtonElement>(
				`.ft-event-calendar-controls button[aria-label="${label}"]`,
			) as HTMLButtonElement;
		const select = (t: EventCalendar<Row>) =>
			t.element.querySelector('.ft-event-calendar-controls select') as HTMLSelectElement;

		it('shows only the enabled groups, in order, above the viewport', () => {
			const t = mount({ controls: { navigation: false, savePng: true, zoom: true } });
			expect(buttons(t)).toEqual(['A+', 'A−', 'Reset', 'Save PNG']);
			expect(t.element.firstElementChild?.className).toBe('ft-event-calendar-controls');
			expect(select(t)).toBeNull();
		});

		it('drives zoom and width', () => {
			const t = mount({ controls: { zoom: true, width: true } });
			const zoom = vi.spyOn(t, 'zoom');
			const expand = vi.spyOn(t, 'expandWidth');
			const fit = vi.spyOn(t, 'fitWidth');
			const click = (text: string) =>
				[...t.element.querySelectorAll<HTMLButtonElement>('.ft-event-calendar-controls button')]
					.find((b) => b.textContent === text)
					?.click();
			click('A+');
			click('A−');
			click('Reset');
			expect(zoom.mock.calls).toEqual([[1.15], [1 / 1.15], ['reset']]);
			click('Expand width');
			click('Fit width');
			expect(expand).toHaveBeenCalledWith(1.25);
			expect(fit).toHaveBeenCalled();
		});

		it('navigates, tracks the visible months and disables at the ends', () => {
			const t = mount({ view: { months: 2 }, controls: { navigation: true, months: true } });
			expect(byLabel(t, 'First month').disabled).toBe(true);
			expect(byLabel(t, 'Previous month').disabled).toBe(true);
			expect(byLabel(t, 'Next month').disabled).toBe(false);
			// 2 is not one of the choices, so it gets a temporary option
			expect(select(t).value).toBe('2');
			expect(t.element.querySelector('.ft-event-calendar-range')?.textContent).toContain('2 of 6 months');

			byLabel(t, 'Next month').click();
			t.render();
			expect(t.getViewState()?.offset).toBe(1);
			expect(byLabel(t, 'Previous month').disabled).toBe(false);

			byLabel(t, 'Last month').click();
			t.render();
			expect(byLabel(t, 'Next month').disabled).toBe(true);

			select(t).value = 'all';
			select(t).dispatchEvent(new Event('change'));
			t.render();
			expect(t.getViewState()?.months).toBe(6);
			expect([...select(t).options].some((o) => o.value === '2')).toBe(false);

			t.setMode('yoy');
			t.render();
			expect(byLabel(t, 'Next month').disabled).toBe(true);
			expect(select(t).disabled).toBe(true);
		});

		it('accepts custom month choices and labels', () => {
			const t = mount({
				controls: { months: [1, 4], labels: { allMonths: 'Alle', months: (n) => `${n} Monate` } },
			});
			expect([...select(t).options].map((o) => o.textContent)).toEqual(['1 Monate', '4 Monate', 'Alle']);
		});

		it('is added and removed by setConfig and removed by destroy', () => {
			const t = mount();
			t.setConfig({ controls: { zoom: true } });
			expect(buttons(t)).toEqual(['A+', 'A−', 'Reset']);
			t.setConfig({ controls: {} });
			expect(t.element.querySelector('.ft-event-calendar-controls')).toBeNull();
			t.setConfig({ controls: { width: true } });
			t.destroy();
			expect(document.querySelector('.ft-event-calendar-controls')).toBeNull();
		});
	});
});
