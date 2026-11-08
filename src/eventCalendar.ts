import { addDays, type CalendarDate, dayNumber, parseDateInput, today } from './calendar/dates';
import { shiftPeriod } from './calendar/periods';
import type { EventCalendarConfig, ViewMode } from './config';
import { type BarMoveEvent, Emitter, type EventCalendarEventMap, type Unsubscribe } from './events';
import { type Controls, createControls, hasControls } from './interaction/controls';
import { createHitTester, type HitTester } from './interaction/hitTest';
import { type Box, defaultTooltip, placeFloating, styleFloating, visibleBounds } from './interaction/tooltip';
import { computeLayout, type PreparedData, prepareData } from './layout/layout';
import { cachedMeasure, type MeasureText } from './layout/measure';
import type { BarLayout, EventCalendarLayout, GroupLayout, ViewState } from './layout/types';
import { shownMonths, type ViewRequest, visibleViewState } from './layout/view';
import { type Context2D, drawEventCalendar } from './render/canvas';
import { clamp, defaultTheme, mergeTheme, type Theme, themeMetrics } from './render/theme';

/** Largest canvas side we allocate (backing pixels); beyond this browsers silently fail to draw. */
const MAX_CANVAS_SIDE = 16_384;
const DRAG_THRESHOLD_PX = 4;
const DEFAULT_FIXED_HEADINGS_MIN_WIDTH = 768;
/** Inertia after a manual pan: velocity decay per millisecond, and the speed (px/ms) below which it stops. */
const INERTIA_DECAY = 0.995;
const INERTIA_MIN_SPEED = 0.02;
const INERTIA_MAX_SPEED = 4;

/** A pointer held down on the canvas: becomes a bar drag, a pan, or (released without moving) a click. */
interface PressState<T> {
	pointerId: number;
	mode: 'pending' | 'drag' | 'pan';
	bar: BarLayout<T> | null;
	clientX: number;
	clientY: number;
	/** Layout x at press (bar drags). */
	startX: number;
	canDrag: boolean;
	canPan: boolean;
	dx: number;
	minDays: number;
	maxDays: number;
	scrollLeft: number;
	scrollTop: number;
	/** Recent pointer positions, for the release velocity of a pan. */
	samples: { x: number; y: number; t: number }[];
}

/**
 * A canvas event calendar mounted into a container element.
 *
 * ```ts
 * const calendar = new EventCalendar(document.getElementById('plan')!, config, rows);
 * calendar.on('click', ({ rows }) => openEditor(rows));
 * // later
 * calendar.destroy();
 * ```
 */
export class EventCalendar<T> {
	readonly element: HTMLDivElement;
	readonly canvas: HTMLCanvasElement;
	/** Scroll container (below the controls). */
	private readonly viewport: HTMLDivElement;
	/** Full-size content of the scroll container; the canvas sticks to the visible part of it. */
	private readonly track: HTMLDivElement;
	private controls: Controls | null = null;

	private config: EventCalendarConfig<T>;
	private rows: readonly T[];
	private prepared: PreparedData<T>;
	private theme: Theme;
	private request: ViewRequest;
	private widthScale = 1;
	private layout: EventCalendarLayout<T> | null = null;
	private hitTest: HitTester<T> | null = null;
	private lastView: ViewState | null = null;

	/** Canvas size in CSS pixels (the visible part of the layout). */
	private canvasWidth = 0;
	private canvasHeight = 0;
	/** Width of the fixed row headings (0 when they scroll) and height of the pinned time axis (0 without a scroll box). */
	private frozenX = 0;
	private frozenY = 0;
	/** The layout covers every month and navigation scrolls (continuous mode with `range: 'all'`). */
	private timeScroll = false;
	/** Days from the start of the laid-out range to the left edge of the visible grid; restored after re-layouts. */
	private anchorDays: number | null = null;
	/** Where a programmatic (smooth) scroll is heading, so repeated navigation adds up. */
	private scrollTarget: number | null = null;
	private fixedQuery: MediaQueryList | null = null;

	private readonly ctx: CanvasRenderingContext2D;
	private readonly tooltip: HTMLDivElement;
	private readonly badge: HTMLDivElement;
	private readonly emitter = new Emitter<EventCalendarEventMap<T>>();
	private readonly measure: MeasureText;
	private readonly images = new Map<string, HTMLImageElement | 'error'>();
	private readonly pendingMoves = new Map<string, number>();
	private readonly cleanups: (() => void)[] = [];
	private hover: BarLayout<T> | null = null;
	/** Bar whose tooltip was pinned open by a click or tap. */
	private pinned: BarLayout<T> | null = null;
	private press: PressState<T> | null = null;
	private inertiaFrame: number | null = null;
	private frame: number | null = null;
	private destroyed = false;

	constructor(container: HTMLElement, config: EventCalendarConfig<T>, rows: readonly T[] = []) {
		this.config = config;
		this.rows = rows;
		this.theme = mergeTheme(defaultTheme, config.theme);
		this.request = requestFromConfig(config);
		this.prepared = prepareData(rows, config);

		const doc = container.ownerDocument;
		this.element = doc.createElement('div');
		this.element.className = 'ft-event-calendar';
		this.element.style.width = '100%';
		this.element.setAttribute('role', 'figure');
		this.element.setAttribute('aria-label', 'Event calendar');

		this.viewport = doc.createElement('div');
		this.viewport.className = 'ft-event-calendar-viewport';
		Object.assign(this.viewport.style, {
			position: 'relative',
			width: '100%',
			overflowX: 'auto',
			overflowY: 'hidden',
			// A horizontal swipe at either end must not trigger the browser's back/forward gesture.
			overscrollBehaviorX: 'contain',
		});

		this.track = doc.createElement('div');
		this.track.className = 'ft-event-calendar-track';
		this.track.style.position = 'relative';

		this.canvas = doc.createElement('canvas');
		this.canvas.className = 'ft-event-calendar-canvas';
		Object.assign(this.canvas.style, { display: 'block', position: 'sticky', left: '0px', top: '0px' });
		this.canvas.setAttribute('role', 'img');

		this.tooltip = floatingElement(doc, 'ft-event-calendar-tooltip');
		this.tooltip.setAttribute('role', 'tooltip');
		this.badge = floatingElement(doc, 'ft-event-calendar-drag-badge');

		this.track.append(this.canvas);
		this.viewport.append(this.track);
		this.element.append(this.viewport, this.tooltip, this.badge);
		container.append(this.element);

		const ctx = this.canvas.getContext('2d');
		if (!ctx) throw new Error('EventCalendar: 2D canvas context is not available');
		this.ctx = ctx;
		this.measure = cachedMeasure((text, font) => {
			ctx.font = font;
			return ctx.measureText(text).width;
		});

		this.syncControls();
		this.syncFixedQuery();
		this.applyStyles();
		this.attachEvents();
		this.render();
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Data & configuration
	// ---------------------------------------------------------------------------------------------------------------

	/** Replace the rows. Clears pending (accepted but not re-supplied) moves. */
	setData(rows: readonly T[]): void {
		this.rows = rows;
		this.prepared = prepareData(rows, this.config);
		this.pendingMoves.clear();
		this.scheduleRender();
	}

	/** Shallow-merge configuration. Passing `view` resets navigation to it; `theme` is merged over the current one. */
	setConfig(patch: Partial<EventCalendarConfig<T>>): void {
		this.config = { ...this.config, ...patch };
		if (patch.theme) this.theme = mergeTheme(this.theme, patch.theme);
		if (patch.view) {
			this.request = requestFromConfig(this.config);
			this.anchorDays = null;
		}
		this.prepared = prepareData(this.rows, this.config);
		if ('controls' in patch || 'locale' in patch) this.syncControls();
		if ('fixedRowHeadings' in patch || 'fixedRowHeadingsMinWidth' in patch) this.syncFixedQuery();
		if (patch.tooltipOnClick === false) this.unpin();
		this.applyStyles();
		this.scheduleRender();
	}

	getConfig(): Readonly<EventCalendarConfig<T>> {
		return this.config;
	}

	/**
	 * Convenience for the original "totals level" toggle: `-1`/`'none'` = no totals, `0` = grand total only,
	 * `n` = grand total plus sub-totals for levels `0 … n-1`.
	 */
	setTotalsDepth(depth: number | 'none'): void {
		const d = depth === 'none' ? -1 : depth;
		this.setConfig({
			groupBy: this.config.groupBy.map((level, i) => ({ ...level, subtotal: i < d })),
			totals: { ...this.config.totals, grand: d >= 0 },
		});
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Navigation & zoom
	// ---------------------------------------------------------------------------------------------------------------

	/** What is visible now (follows scrolling). */
	getViewState(): ViewState | null {
		return this.layout ? this.currentView(this.layout) : null;
	}

	/** Show from the first month with data. */
	first(): void {
		if (this.timeScroll) this.scrollToX(0);
		else this.navigate({ start: null });
	}

	/** Show up to the last month with data. */
	last(): void {
		if (this.timeScroll) this.scrollToX(Number.POSITIVE_INFINITY);
		else this.navigate({ start: this.prepared.dataEnd });
	}

	prev(months = 1): void {
		this.shift(-Math.abs(months));
	}

	next(months = 1): void {
		this.shift(Math.abs(months));
	}

	/** Centre the window on today (clamped to the data). */
	today(): void {
		const layout = this.layout;
		const cal = this.prepared.calendar;
		const now = today(this.prepared.zone);
		if (this.timeScroll && layout?.range) {
			const visibleDays = this.visibleGridWidth(layout) / layout.dayWidth;
			const days = dayNumber(now) - dayNumber(layout.range.start) - visibleDays / 2;
			this.scrollToX(days * layout.dayWidth);
			return;
		}
		const visible = layout?.view.months ?? this.request.months ?? 12;
		const start = shiftPeriod(cal, cal.monthOf(now), -Math.floor(visible / 2)).start;
		this.navigate({ start });
	}

	/** Number of visible months, or `'all'`. */
	setVisibleMonths(months: number | 'all'): void {
		this.navigate({ months: months === 'all' ? null : Math.max(1, Math.round(months)) });
	}

	setMode(mode: ViewMode): void {
		this.navigate({ mode });
	}

	/** Multiply the scale (fonts, lane heights); `'reset'` restores the configured scale. */
	zoom(factor: number | 'reset'): void {
		const base = mergeTheme(defaultTheme, this.config.theme).scale;
		const scale = factor === 'reset' ? base : clamp(this.theme.scale * factor, 0.5, 4);
		this.theme = { ...this.theme, scale };
		this.applyStyles();
		this.scheduleRender();
	}

	/** Make the time grid wider than its container (scrolls horizontally). */
	expandWidth(factor = 1.25): void {
		this.widthScale = clamp(this.widthScale * factor, 1, 12);
		this.scheduleRender();
	}

	/** Fit the time grid to its container width. */
	fitWidth(): void {
		this.widthScale = 1;
		this.scheduleRender();
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Events & output
	// ---------------------------------------------------------------------------------------------------------------

	on<K extends keyof EventCalendarEventMap<T>>(type: K, handler: EventCalendarEventMap<T>[K]): Unsubscribe {
		return this.emitter.on(type, handler);
	}

	/** The most recent layout (positions of everything drawn, in layout coordinates). */
	getLayout(): EventCalendarLayout<T> | null {
		return this.layout;
	}

	/** Export the current drawing (what is visible, including fixed headings). */
	toBlob(type = 'image/png', quality?: number): Promise<Blob> {
		return new Promise((resolve, reject) => {
			this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), type, quality);
		});
	}

	/** Lay out and draw synchronously. Normally called for you on changes and resizes. */
	render(): void {
		if (this.destroyed) return;
		if (this.frame !== null) {
			cancelFrame(this.frame);
			this.frame = null;
		}
		const available =
			this.viewport.clientWidth || this.element.clientWidth || this.element.parentElement?.clientWidth || 800;
		const width = Math.max(200, Math.floor(available));
		const range = this.config.view?.range ?? 'all';
		const options = {
			width,
			widthScale: this.widthScale,
			range,
			measureText: this.measure,
			view: this.request,
			theme: this.theme,
		};
		this.canvasWidth = width;
		const fixed = this.headingsFixed() && this.config.groupBy.length > 0;
		const previous = this.layout;
		const keep = previous && this.frozenY > 0 ? this.rowAnchor(previous) : null;

		// Geometry (grid position, day width) doesn't depend on which rows are listed, so lay out once to find the
		// scroll position, then again if other months than the requested ones are in view.
		let layout = computeLayout(this.prepared, { ...options, shown: previous?.shown ?? null });
		const timeScroll = range === 'all' && layout.range !== null && layout.dayWidth > 0;
		let scrollX = this.viewport.scrollLeft;
		if (timeScroll && layout.range) {
			const days = this.anchorDays ?? dayNumber(layout.view.start) - dayNumber(layout.range.start);
			this.anchorDays = days;
			if (this.scrollTarget === null) scrollX = clamp(days * layout.dayWidth, 0, Math.max(0, layout.width - width));
			const wanted = this.monthsInView(layout, scrollX, fixed);
			if (wanted && !sameWindow(wanted, layout.shown)) {
				layout = computeLayout(this.prepared, { ...options, shown: wanted });
			}
		}
		this.layout = layout;
		this.hitTest = createHitTester(layout);
		this.hover = null;
		this.timeScroll = timeScroll;
		this.frozenX = fixed && !layout.empty ? layout.gridX : 0;

		const box = this.config.maxHeight !== undefined;
		Object.assign(this.viewport.style, {
			overflowY: box ? 'auto' : 'hidden',
			maxHeight: box ? cssLength(this.config.maxHeight) : '',
		});
		this.track.style.width = `${layout.width}px`;
		this.track.style.height = `${layout.height}px`;
		this.frozenY = box ? layout.headerHeight : 0;
		this.canvasHeight = box ? Math.min(layout.height, this.viewport.clientHeight || layout.height) : layout.height;

		// Restore the scroll position only when it is off: writing it would stop native momentum or a smooth scroll.
		if (timeScroll && Math.abs(this.viewport.scrollLeft - scrollX) > 0.5) this.viewport.scrollLeft = scrollX;
		if (keep) this.restoreRowAnchor(layout, keep);

		this.sizeCanvas(this.canvasWidth, this.canvasHeight);
		this.draw();
		this.updateCursor();
		this.canvas.setAttribute('aria-label', describe(layout));

		// Keep a pinned tooltip on its bar (found again by id), or close it when the bar is gone.
		const pinnedId = this.pinned?.bar.id;
		this.pinned = null;
		const repin = pinnedId ? layout.bars.find((b) => b.bar.id === pinnedId) : undefined;
		if (repin) this.pin(repin);
		else this.unpin();

		this.emitter.emit('render', { layout });
		this.syncView();
	}

	/** Remove the calendar from the DOM and release every listener and observer. */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		if (this.frame !== null) cancelFrame(this.frame);
		this.stopInertia();
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.fixedQuery?.removeEventListener('change', this.onFixedQueryChange);
		this.hideFloating(this.tooltip);
		this.hideFloating(this.badge);
		this.emitter.clear();
		this.element.remove();
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Internals: layout state
	// ---------------------------------------------------------------------------------------------------------------

	/** Create, replace or remove the control bar to match `config.controls`. */
	private syncControls(): void {
		this.controls?.element.remove();
		this.controls = null;
		const options = this.config.controls;
		if (!options || !hasControls(options)) return;
		this.controls = createControls(
			this.element.ownerDocument,
			this,
			options,
			this.theme,
			this.config.locale ?? 'en-US',
		);
		this.element.prepend(this.controls.element);
		if (this.layout) this.controls.update(this.currentView(this.layout));
	}

	private readonly onFixedQueryChange = (): void => this.scheduleRender();

	/** Watch the window width for `fixedRowHeadings: 'auto'`. */
	private syncFixedQuery(): void {
		this.fixedQuery?.removeEventListener('change', this.onFixedQueryChange);
		this.fixedQuery = null;
		const view = this.element.ownerDocument.defaultView;
		if ((this.config.fixedRowHeadings ?? 'auto') !== 'auto' || typeof view?.matchMedia !== 'function') return;
		const min = this.config.fixedRowHeadingsMinWidth ?? DEFAULT_FIXED_HEADINGS_MIN_WIDTH;
		this.fixedQuery = view.matchMedia(`(min-width: ${min}px)`);
		this.fixedQuery.addEventListener('change', this.onFixedQueryChange);
	}

	private headingsFixed(): boolean {
		const option = this.config.fixedRowHeadings ?? 'auto';
		if (option !== 'auto') return option;
		if (this.fixedQuery) return this.fixedQuery.matches;
		const min = this.config.fixedRowHeadingsMinWidth ?? DEFAULT_FIXED_HEADINGS_MIN_WIDTH;
		return (this.element.ownerDocument.defaultView?.innerWidth ?? min) >= min;
	}

	/** Width of the visible time grid: what the requested months fill. */
	private visibleGridWidth(layout: EventCalendarLayout<T>): number {
		return Math.max(10, this.canvasWidth - layout.gridX - this.theme.marginX);
	}

	private maxScrollX(layout: EventCalendarLayout<T>): number {
		return Math.max(0, layout.width - this.canvasWidth);
	}

	/**
	 * The whole months in view at scroll position `x` (only when rows are filtered to them): from the left edge of the
	 * visible grid — which includes the heading column once scrolling headings have moved away — to its right edge.
	 */
	private monthsInView(
		layout: EventCalendarLayout<T>,
		x: number,
		fixed: boolean,
	): { start: CalendarDate; end: CalendarDate } | null {
		const range = layout.range;
		if (!range || !layout.shown || layout.dayWidth <= 0) return null;
		const left = fixed ? x : Math.max(0, x - layout.gridX);
		const right = x + this.visibleGridWidth(layout);
		const first = Math.floor(left / layout.dayWidth + 1e-6);
		const last = Math.max(first, Math.ceil(right / layout.dayWidth - 1e-6) - 1);
		return shownMonths(layout.calendar, range, addDays(range.start, first), addDays(range.start, last));
	}

	/** The groups at the top of the visible rows (innermost first) and their offset, to keep them in place. */
	private rowAnchor(layout: EventCalendarLayout<T>): { id: string; offset: number }[] {
		const y = this.viewport.scrollTop + this.frozenY;
		const chain: { id: string; offset: number }[] = [];
		let group: GroupLayout<T> | undefined = layout.root;
		while (group) {
			chain.unshift({ id: group.id, offset: y - group.rect.y });
			group = group.children.find((c) => y >= c.rect.y && y < c.rect.y + c.rect.height);
		}
		return chain;
	}

	private restoreRowAnchor(layout: EventCalendarLayout<T>, chain: readonly { id: string; offset: number }[]): void {
		const byId = new Map<string, GroupLayout<T>>();
		const index = (g: GroupLayout<T>) => {
			byId.set(g.id, g);
			for (const c of g.children) index(c);
		};
		index(layout.root);
		for (const { id, offset } of chain) {
			const group = byId.get(id);
			if (!group || group.level < 0) continue;
			const top = Math.round(group.rect.y + Math.min(offset, group.rect.height) - this.frozenY);
			if (Math.abs(this.viewport.scrollTop - top) > 0.5) this.viewport.scrollTop = Math.max(0, top);
			return;
		}
	}

	private scrollY(): number {
		return this.frozenY > 0 ? this.viewport.scrollTop : 0;
	}

	private currentView(layout: EventCalendarLayout<T>): ViewState {
		if (!this.timeScroll) return layout.view;
		const x = this.scrollTarget ?? this.viewport.scrollLeft;
		return visibleViewState(layout, x, this.visibleGridWidth(layout));
	}

	/** Update the controls and emit `viewchange` when the visible window changed. */
	private syncView(): void {
		const layout = this.layout;
		if (!layout) return;
		const view = this.currentView(layout);
		const prev = this.lastView;
		if (
			prev &&
			prev.mode === view.mode &&
			prev.offset === view.offset &&
			prev.months === view.months &&
			prev.totalMonths === view.totalMonths &&
			prev.canGoBack === view.canGoBack &&
			prev.canGoForward === view.canGoForward &&
			dayNumber(prev.start) === dayNumber(view.start) &&
			dayNumber(prev.end) === dayNumber(view.end)
		)
			return;
		this.lastView = view;
		this.controls?.update(view);
		this.emitter.emit('viewchange', view);
	}

	private navigate(patch: Partial<ViewRequest>): void {
		this.request = { ...this.request, ...patch };
		if ('start' in patch) this.anchorDays = null;
		this.scheduleRender();
	}

	private shift(months: number): void {
		const layout = this.layout;
		const view = layout?.view;
		if (!layout || view?.mode !== 'continuous') return;
		const cal = this.prepared.calendar;
		if (!this.timeScroll || !layout.range) {
			this.navigate({ start: shiftPeriod(cal, cal.monthOf(view.start), months).start, months: view.months });
			return;
		}
		// Step by calendar months from the month at the left edge; "previous" from mid-month goes to its start.
		const startDay = dayNumber(layout.range.start);
		const days = (this.scrollTarget ?? this.viewport.scrollLeft) / layout.dayWidth;
		const month = cal.monthOf(addDays(layout.range.start, Math.floor(days + 1e-6)));
		const midMonth = days - (dayNumber(month.start) - startDay) > 0.01;
		const target = shiftPeriod(cal, month, months < 0 && midMonth ? months + 1 : months);
		this.scrollToX((dayNumber(target.start) - startDay) * layout.dayWidth);
	}

	/** Scroll the time grid so layout offset `x` (pixels past the grid start) is at its left edge. */
	private scrollToX(x: number): void {
		const layout = this.layout;
		if (!layout || layout.dayWidth <= 0) return;
		const target = clamp(x, 0, this.maxScrollX(layout));
		this.stopInertia();
		this.scrollTarget = target;
		this.anchorDays = target / layout.dayWidth;
		const view = this.element.ownerDocument.defaultView;
		const reduced = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
		if (typeof this.viewport.scrollTo === 'function') {
			this.viewport.scrollTo({ left: target, behavior: reduced ? 'auto' : 'smooth' });
		} else {
			this.viewport.scrollLeft = target;
		}
		if (Math.abs(this.viewport.scrollLeft - target) < 1) this.onScroll();
		else this.syncView();
	}

	private scheduleRender(): void {
		if (this.destroyed || this.frame !== null) return;
		this.frame = requestFrame(() => {
			this.frame = null;
			this.render();
		});
	}

	private sizeCanvas(width: number, height: number): void {
		const view = this.canvas.ownerDocument.defaultView;
		const dpr = Math.max(1, view?.devicePixelRatio ?? 1);
		const ratio = Math.min(dpr, MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height);
		const pw = Math.round(width * ratio);
		const ph = Math.round(height * ratio);
		if (this.canvas.width !== pw) this.canvas.width = pw;
		if (this.canvas.height !== ph) this.canvas.height = ph;
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;
		this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	}

	private draw(): void {
		const layout = this.layout;
		if (!layout) return;
		const offsets = new Map<string, number>();
		for (const [id, days] of this.pendingMoves) offsets.set(id, days * layout.dayWidth);
		const drag = this.press?.mode === 'drag' && this.press.bar ? this.press : null;
		drawEventCalendar(this.ctx as Context2D, layout, this.theme, {
			measure: this.measure,
			drag: drag?.bar ? { barId: drag.bar.bar.id, dx: drag.dx } : null,
			offsets,
			hoverBarId: this.hover?.bar.id ?? this.pinned?.bar.id ?? null,
			getImage: (url) => this.image(url),
			viewport: {
				x: this.viewport.scrollLeft,
				y: this.scrollY(),
				width: this.canvasWidth,
				height: this.canvasHeight,
				frozenX: this.frozenX,
				frozenY: this.frozenY,
			},
		});
	}

	private image(url: string): CanvasImageSource | null {
		const cached = this.images.get(url);
		if (cached === 'error') return null;
		if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => this.scheduleRender();
		img.onerror = () => this.images.set(url, 'error');
		img.src = url;
		this.images.set(url, img);
		return null;
	}

	private applyStyles(): void {
		const tm = themeMetrics(this.theme);
		const font = `${tm.fontSize}px ${this.theme.fontFamily}`;
		styleFloating(this.tooltip, this.theme, font);
		styleFloating(this.badge, this.theme, font);
		this.badge.style.padding = '2px 6px';
		this.badge.style.whiteSpace = 'nowrap';
		if (this.pinned) this.tooltip.style.pointerEvents = 'auto';
		// Editable: horizontal touch drags move bars (and pan from the background, handled here); otherwise the
		// browser pans natively, with momentum.
		this.canvas.style.touchAction = this.config.editable ? 'pan-y pinch-zoom' : 'auto';
		this.controls?.restyle(this.theme);
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Internals: events
	// ---------------------------------------------------------------------------------------------------------------

	private attachEvents(): void {
		const listen = <E extends Event>(
			target: EventTarget,
			type: string,
			handler: (e: E) => void,
			options?: AddEventListenerOptions,
		) => {
			const listener = handler as EventListener;
			target.addEventListener(type, listener, options);
			this.cleanups.push(() => target.removeEventListener(type, listener, options));
		};

		listen<PointerEvent>(this.canvas, 'pointerdown', (e) => this.onPointerDown(e));
		listen<PointerEvent>(this.canvas, 'pointermove', (e) => this.onPointerMove(e));
		listen<PointerEvent>(this.canvas, 'pointerup', (e) => this.onPointerUp(e));
		listen<PointerEvent>(this.canvas, 'pointercancel', () => this.cancelPress());
		listen<PointerEvent>(this.canvas, 'pointerleave', () => {
			if (!this.press) this.setHover(null);
		});
		listen(this.viewport, 'scroll', () => this.onScroll(), { passive: true });
		listen(this.viewport, 'scrollend', () => {
			this.scrollTarget = null;
			this.syncView();
		});
		// The user takes over from a programmatic smooth scroll.
		const takeOver = () => {
			this.scrollTarget = null;
		};
		listen(this.viewport, 'wheel', takeOver, { passive: true });
		listen(this.viewport, 'touchstart', takeOver, { passive: true });

		const doc = this.element.ownerDocument;
		const view = doc.defaultView;
		// A pinned tooltip closes on a press outside it and the canvas (the canvas handles its own presses), or Escape.
		listen<PointerEvent>(
			doc,
			'pointerdown',
			(e) => {
				const target = e.target as Node | null;
				if (this.pinned && target && !this.tooltip.contains(target) && target !== this.canvas) this.unpin();
			},
			{ capture: true },
		);
		listen<KeyboardEvent>(doc, 'keydown', (e) => {
			if (e.key === 'Escape' && this.pinned) this.unpin();
		});
		if (view) {
			// The tooltip is fixed to the window: follow the page when it scrolls or resizes.
			const follow = (e: Event) => {
				if (e.target !== this.viewport) this.followPinned();
			};
			listen(view, 'scroll', follow, { passive: true, capture: true });
			listen(view, 'resize', follow, { passive: true });
		}

		if (view && 'ResizeObserver' in view) {
			let lastWidth = this.viewport.clientWidth;
			let lastHeight = this.viewport.clientHeight;
			const observer = new view.ResizeObserver(() => {
				const width = this.viewport.clientWidth;
				const height = this.viewport.clientHeight;
				const heightMatters = this.config.maxHeight !== undefined;
				if (width !== lastWidth || (heightMatters && height !== lastHeight)) {
					lastWidth = width;
					lastHeight = height;
					this.scheduleRender();
				}
			});
			observer.observe(this.viewport);
			this.cleanups.push(() => observer.disconnect());
		}
		if (view?.matchMedia) {
			// Re-render crisply when the window moves to a screen with a different pixel ratio.
			let query: MediaQueryList | null = null;
			const watch = () => {
				query?.removeEventListener('change', onChange);
				query = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`);
				query.addEventListener('change', onChange);
			};
			const onChange = () => {
				watch();
				this.scheduleRender();
			};
			watch();
			this.cleanups.push(() => query?.removeEventListener('change', onChange));
		}
	}

	private onScroll(): void {
		const layout = this.layout;
		if (!layout || this.destroyed) return;
		const x = this.viewport.scrollLeft;
		if (this.scrollTarget !== null && Math.abs(x - this.scrollTarget) < 1) this.scrollTarget = null;
		if (this.timeScroll && this.scrollTarget === null && layout.dayWidth > 0) this.anchorDays = x / layout.dayWidth;
		if (this.timeScroll) {
			const wanted = this.monthsInView(layout, x, this.frozenX > 0);
			if (wanted && !sameWindow(wanted, layout.shown)) {
				// Other months came into view: list their groups.
				this.render();
				return;
			}
		}
		this.hover = null;
		this.draw();
		this.syncView();
		this.followPinned();
		if (this.press?.mode === 'drag' && this.press.bar) this.placeFloating(this.badge, this.press.bar, this.press.dx);
	}

	/** Canvas event position → layout coordinates (fixed parts don't scroll). */
	private point(e: PointerEvent): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		const sx = rect.width ? this.canvasWidth / rect.width : 1;
		const sy = rect.height ? this.canvasHeight / rect.height : 1;
		const cx = (e.clientX - rect.left) * sx;
		const cy = (e.clientY - rect.top) * sy;
		return {
			x: cx < this.frozenX ? cx : cx + this.viewport.scrollLeft,
			y: cy < this.frozenY ? cy : cy + this.scrollY(),
		};
	}

	/** True when there is something to scroll to. */
	private scrollable(): boolean {
		const layout = this.layout;
		if (!layout) return false;
		return layout.width > this.canvasWidth + 1 || (this.frozenY > 0 && layout.height > this.canvasHeight + 1);
	}

	private onPointerDown(e: PointerEvent): void {
		if (e.button !== 0 || !this.hitTest || !this.layout) return;
		this.stopInertia();
		this.scrollTarget = null;
		const layout = this.layout;
		const { x, y } = this.point(e);
		const hit = this.hitTest(x, y);
		const view = layout.view;
		const canDrag = !!hit && this.config.editable === true && view.mode === 'continuous' && layout.dayWidth > 0;
		// Mouse: drag anything that isn't a movable bar to pan. Touch: the browser pans natively, except where
		// `touch-action` stops it (editable calendars), where a drag on the background pans.
		const mouse = e.pointerType === 'mouse';
		const canPan = this.scrollable() && !canDrag && (mouse || (this.config.editable === true && !hit));
		if (!hit && !canPan) {
			if (this.pinned) this.unpin();
			return;
		}
		const startDay = hit ? dayNumber(hit.bar.start) : 0;
		const endDay = hit ? dayNumber(hit.bar.end) : 0;
		this.press = {
			pointerId: e.pointerId,
			mode: 'pending',
			bar: hit,
			clientX: e.clientX,
			clientY: e.clientY,
			startX: x,
			canDrag,
			canPan,
			dx: 0,
			// Keep the bar inside the view; a side already beyond the view cannot move further out.
			minDays: canDrag ? Math.min(0, dayNumber(layout.range?.start ?? view.start) - startDay) : 0,
			maxDays: canDrag ? Math.max(0, dayNumber(layout.range?.end ?? view.end) - endDay) : 0,
			scrollLeft: this.viewport.scrollLeft,
			scrollTop: this.viewport.scrollTop,
			samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }],
		};
		if (canDrag || canPan) this.canvas.setPointerCapture?.(e.pointerId);
	}

	private onPointerMove(e: PointerEvent): void {
		const press = this.press;
		const layout = this.layout;
		if (press && press.pointerId === e.pointerId && layout) {
			const mx = e.clientX - press.clientX;
			const my = e.clientY - press.clientY;
			if (press.mode === 'pending') {
				if (press.canDrag && (press.minDays !== 0 || press.maxDays !== 0) && Math.abs(mx) >= DRAG_THRESHOLD_PX) {
					press.mode = 'drag';
					this.unpin();
				} else if (press.canPan && Math.hypot(mx, my) >= DRAG_THRESHOLD_PX) {
					press.mode = 'pan';
					this.hideTooltip();
					this.canvas.style.cursor = 'grabbing';
				} else return;
			}
			if (press.mode === 'drag' && press.bar) {
				const { x } = this.point(e);
				const days = clamp(Math.round((x - press.startX) / layout.dayWidth), press.minDays, press.maxDays);
				press.dx = days * layout.dayWidth;
				this.showBadge(press.bar, days);
				this.draw();
			} else if (press.mode === 'pan') {
				this.viewport.scrollLeft = press.scrollLeft - mx;
				if (this.frozenY > 0 && e.pointerType === 'mouse') this.viewport.scrollTop = press.scrollTop - my;
				press.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
				if (press.samples.length > 6) press.samples.shift();
			}
			return;
		}
		if (press) return;
		const { x, y } = this.point(e);
		this.setHover(this.hitTest?.(x, y) ?? null);
	}

	private onPointerUp(e: PointerEvent): void {
		const press = this.press;
		if (!press || press.pointerId !== e.pointerId) return;
		this.press = null;
		this.canvas.releasePointerCapture?.(e.pointerId);
		this.hideFloating(this.badge);
		const layout = this.layout;
		if (press.mode === 'pan') {
			this.updateCursor();
			this.startInertia(press.samples, e.pointerType === 'mouse');
			return;
		}
		if (press.mode === 'pending') {
			if (!press.bar) {
				if (this.pinned) this.unpin();
				return;
			}
			this.emitter.emit('click', { bar: press.bar.bar, rows: press.bar.bar.rows, nativeEvent: e });
			if (this.config.tooltipOnClick !== false) {
				if (this.pinned?.bar.id === press.bar.bar.id) this.unpin();
				else this.pin(press.bar);
			}
			return;
		}
		if (!press.bar || !layout) return;
		const days = Math.round(press.dx / layout.dayWidth);
		if (days === 0) {
			this.draw();
			return;
		}
		void this.finishMove(press.bar, days);
	}

	private async finishMove(bar: BarLayout<T>, days: number): Promise<void> {
		const event: BarMoveEvent<T> = {
			bar: bar.bar,
			rows: bar.bar.rows,
			deltaDays: days,
			newStart: addDays(bar.bar.start, days),
			newEnd: addDays(bar.bar.end, days),
		};
		// Hold the bar at its dropped position while handlers decide.
		this.pendingMoves.set(bar.bar.id, days);
		this.draw();
		const handlers = this.emitter.listeners('move');
		let accepted = handlers.length > 0;
		for (const handler of handlers) {
			try {
				if ((await handler(event)) !== true) accepted = false;
			} catch (error) {
				console.error('[event-calendar] "move" handler threw', error);
				accepted = false;
			}
		}
		if (this.destroyed) return;
		if (!accepted) this.pendingMoves.delete(bar.bar.id);
		this.draw();
	}

	private cancelPress(): void {
		const press = this.press;
		if (!press) return;
		this.press = null;
		this.hideFloating(this.badge);
		this.updateCursor();
		if (press.mode === 'drag') this.draw();
	}

	/** Keep a manual pan gliding after release, like native touch scrolling. */
	private startInertia(samples: readonly { x: number; y: number; t: number }[], vertical: boolean): void {
		const last = samples[samples.length - 1];
		const first = samples.find((s) => last && last.t - s.t <= 100) ?? last;
		if (!first || !last || last.t - first.t <= 0) return;
		const dt = last.t - first.t;
		let vx = clamp((last.x - first.x) / dt, -INERTIA_MAX_SPEED, INERTIA_MAX_SPEED);
		let vy = vertical && this.frozenY > 0 ? clamp((last.y - first.y) / dt, -INERTIA_MAX_SPEED, INERTIA_MAX_SPEED) : 0;
		if (Math.hypot(vx, vy) < INERTIA_MIN_SPEED * 5) return;
		let previous = now();
		const step = () => {
			const t = now();
			const elapsed = Math.max(1, t - previous);
			previous = t;
			const { scrollLeft, scrollTop } = this.viewport;
			this.viewport.scrollLeft = scrollLeft - vx * elapsed;
			if (vy !== 0) this.viewport.scrollTop = scrollTop - vy * elapsed;
			const moved = this.viewport.scrollLeft !== scrollLeft || this.viewport.scrollTop !== scrollTop;
			const decay = INERTIA_DECAY ** elapsed;
			vx *= decay;
			vy *= decay;
			this.inertiaFrame = !moved || Math.hypot(vx, vy) < INERTIA_MIN_SPEED ? null : requestFrame(step);
		};
		this.inertiaFrame = requestFrame(step);
	}

	private stopInertia(): void {
		if (this.inertiaFrame === null) return;
		cancelFrame(this.inertiaFrame);
		this.inertiaFrame = null;
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Internals: hover, tooltip, badge
	// ---------------------------------------------------------------------------------------------------------------

	private updateCursor(): void {
		const hit = this.hover;
		this.canvas.style.cursor = hit
			? this.config.editable && this.layout?.view.mode === 'continuous'
				? 'grab'
				: 'pointer'
			: this.scrollable()
				? 'grab'
				: '';
	}

	private setHover(hit: BarLayout<T> | null): void {
		if (hit?.bar.id === this.hover?.bar.id) return;
		this.hover = hit;
		this.updateCursor();
		this.draw();
		this.emitter.emit('hover', { bar: hit?.bar ?? null });
		if (this.pinned) return;
		if (hit) this.showTooltip(hit);
		else this.hideTooltip();
	}

	/** Fill and place the tooltip for a bar; hides it when there is no content or the bar is out of view. */
	private showTooltip(hit: BarLayout<T>): boolean {
		const content = this.config.tooltip
			? this.config.tooltip(hit.bar, hit.bar.metrics)
			: defaultTooltip(hit.bar, this.prepared.metrics, this.prepared.locale, this.element.ownerDocument);
		if (content === null || content === '') {
			this.hideFloating(this.tooltip);
			return false;
		}
		if (typeof content === 'string') this.tooltip.textContent = content;
		else this.tooltip.replaceChildren(content);
		if (!this.placeFloating(this.tooltip, hit, 0)) {
			this.hideFloating(this.tooltip);
			return false;
		}
		return true;
	}

	/** Hide the hover tooltip (a pinned one stays). */
	private hideTooltip(): void {
		if (!this.pinned) this.hideFloating(this.tooltip);
	}

	/** Keep a pinned tooltip next to its bar after scrolling; hidden while the bar is out of view. Hover tooltips hide. */
	private followPinned(): void {
		if (!this.pinned || !this.placeFloating(this.tooltip, this.pinned, 0)) this.hideFloating(this.tooltip);
	}

	private pin(hit: BarLayout<T>): void {
		this.pinned = hit;
		if (!this.showTooltip(hit)) {
			this.pinned = null;
			return;
		}
		this.tooltip.style.pointerEvents = 'auto';
		this.draw();
	}

	private unpin(): void {
		const was = this.pinned;
		this.pinned = null;
		this.tooltip.style.pointerEvents = 'none';
		this.hideFloating(this.tooltip);
		if (was) this.draw();
	}

	private showBadge(bar: BarLayout<T>, days: number): void {
		const locale = this.prepared.locale;
		const fmt = (d: CalendarDate) => d.setLocale(locale).toFormat('d LLL');
		this.badge.textContent = `${fmt(addDays(bar.bar.start, days))} – ${fmt(addDays(bar.bar.end, days))}`;
		this.placeFloating(this.badge, bar, this.press?.dx ?? 0);
	}

	/** The visible part of a bar on screen (client coordinates), or null when it is scrolled out of view. */
	private barClientRect(bar: BarLayout<T>, dx: number): Box | null {
		const rect = this.canvas.getBoundingClientRect();
		const kx = rect.width && this.canvasWidth ? rect.width / this.canvasWidth : 1;
		const ky = rect.height && this.canvasHeight ? rect.height / this.canvasHeight : 1;
		const sx = this.viewport.scrollLeft;
		const sy = this.scrollY();
		const x0 = Math.max(bar.rect.x + dx - sx, this.frozenX);
		const x1 = Math.min(bar.rect.x + dx + bar.rect.width - sx, this.canvasWidth);
		const y0 = Math.max(bar.rect.y - sy, this.frozenY);
		const y1 = Math.min(bar.rect.y + bar.rect.height - sy, this.canvasHeight);
		if (x1 <= x0 || y1 <= y0) return null;
		return { x: rect.left + x0 * kx, y: rect.top + y0 * ky, width: (x1 - x0) * kx, height: (y1 - y0) * ky };
	}

	/** Size a floating element to its content (at most the visible window) and put it next to the bar. */
	private placeFloating(el: HTMLElement, bar: BarLayout<T>, dx: number): boolean {
		const anchor = this.barClientRect(bar, dx);
		if (!anchor) return false;
		const bounds = visibleBounds(this.element.ownerDocument.defaultView);
		const gap = themeMetrics(this.theme).padding;
		el.style.maxWidth = `${Math.max(0, Math.floor(bounds.width - gap * 2))}px`;
		el.style.maxHeight = `${Math.max(0, Math.floor(bounds.height - gap * 2))}px`;
		// Measure at the origin so the previous position can't squeeze the box.
		el.style.left = '0px';
		el.style.top = '0px';
		this.showFloating(el);
		const { x, y } = placeFloating({ width: el.offsetWidth, height: el.offsetHeight }, anchor, bounds, gap);
		el.style.left = `${x}px`;
		el.style.top = `${y}px`;
		return true;
	}

	private showFloating(el: HTMLElement): void {
		el.style.visibility = 'visible';
		if (el.hasAttribute('popover') && !isPopoverOpen(el)) {
			try {
				el.showPopover();
			} catch {
				// Not connected or not supported: the fixed positioning still applies.
			}
		}
	}

	private hideFloating(el: HTMLElement): void {
		el.style.visibility = 'hidden';
		if (el.hasAttribute('popover') && isPopoverOpen(el)) {
			try {
				el.hidePopover();
			} catch {
				// ignore
			}
		}
	}
}

/** Tooltip/badge element; a manual popover (top layer, above any overflow or stacking context) where supported. */
function floatingElement(doc: Document, className: string): HTMLDivElement {
	const el = doc.createElement('div');
	el.className = className;
	if (typeof el.showPopover === 'function') el.setAttribute('popover', 'manual');
	return el;
}

function isPopoverOpen(el: HTMLElement): boolean {
	try {
		return el.matches(':popover-open');
	} catch {
		return false;
	}
}

function sameWindow(
	a: { start: CalendarDate; end: CalendarDate } | null,
	b: { start: CalendarDate; end: CalendarDate } | null,
): boolean {
	if (!a || !b) return a === b;
	return dayNumber(a.start) === dayNumber(b.start) && dayNumber(a.end) === dayNumber(b.end);
}

function cssLength(value: number | string | undefined): string {
	return typeof value === 'number' ? `${value}px` : (value ?? '');
}

function requestFromConfig<T>(config: EventCalendarConfig<T>): ViewRequest {
	const zone = config.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	const view = config.view ?? {};
	return {
		mode: view.mode ?? 'continuous',
		start: view.start === undefined ? null : parseDateInput(view.start, zone),
		months: view.months ?? null,
	};
}

function describe<T>(layout: EventCalendarLayout<T>): string {
	if (layout.empty) return 'Event calendar: no data';
	const v = layout.range ?? layout.view;
	return `Event calendar from ${v.start.toISODate()} to ${v.end.toISODate()}, ${layout.bars.length} bars`;
}

function now(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function requestFrame(cb: () => void): number {
	return typeof requestAnimationFrame === 'function'
		? requestAnimationFrame(cb)
		: (setTimeout(cb, 0) as unknown as number);
}

function cancelFrame(id: number): void {
	if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
	else clearTimeout(id);
}
