import { addDays, type CalendarDate, dayNumber, parseDateInput, today } from './calendar/dates';
import { shiftPeriod } from './calendar/periods';
import type { TimelineConfig, ViewMode } from './config';
import { type BarMoveEvent, Emitter, type TimelineEventMap, type Unsubscribe } from './events';
import { type Controls, createControls, hasControls } from './interaction/controls';
import { createHitTester, type HitTester } from './interaction/hitTest';
import { defaultTooltip, positionFloating, styleFloating } from './interaction/tooltip';
import { computeLayout, type PreparedData, prepareData } from './layout/layout';
import { cachedMeasure, type MeasureText } from './layout/measure';
import type { BarLayout, TimelineLayout, ViewState } from './layout/types';
import type { ViewRequest } from './layout/view';
import { type Context2D, drawTimeline } from './render/canvas';
import { clamp, defaultTheme, mergeTheme, type Theme, themeMetrics } from './render/theme';

/** Largest canvas side we allocate (backing pixels); beyond this browsers silently fail to draw. */
const MAX_CANVAS_SIDE = 16_384;
const DRAG_THRESHOLD_PX = 4;

interface DragState<T> {
	pointerId: number;
	bar: BarLayout<T>;
	startX: number;
	dx: number;
	active: boolean;
	minDays: number;
	maxDays: number;
}

/**
 * A canvas timeline mounted into a container element.
 *
 * ```ts
 * const timeline = new Timeline(document.getElementById('plan')!, config, rows);
 * timeline.on('click', ({ rows }) => openEditor(rows));
 * // later
 * timeline.destroy();
 * ```
 */
export class Timeline<T> {
	readonly element: HTMLDivElement;
	readonly canvas: HTMLCanvasElement;
	/** Horizontal scroll container around the canvas (below the controls). */
	private readonly viewport: HTMLDivElement;
	private controls: Controls | null = null;

	private config: TimelineConfig<T>;
	private rows: readonly T[];
	private prepared: PreparedData<T>;
	private theme: Theme;
	private request: ViewRequest;
	private widthScale = 1;
	private layout: TimelineLayout<T> | null = null;
	private hitTest: HitTester<T> | null = null;
	private lastView: ViewState | null = null;

	private readonly ctx: CanvasRenderingContext2D;
	private readonly tooltip: HTMLDivElement;
	private readonly badge: HTMLDivElement;
	private readonly emitter = new Emitter<TimelineEventMap<T>>();
	private readonly measure: MeasureText;
	private readonly images = new Map<string, HTMLImageElement | 'error'>();
	private readonly pendingMoves = new Map<string, number>();
	private readonly cleanups: (() => void)[] = [];
	private hover: BarLayout<T> | null = null;
	private drag: DragState<T> | null = null;
	private frame: number | null = null;
	private destroyed = false;

	constructor(container: HTMLElement, config: TimelineConfig<T>, rows: readonly T[] = []) {
		this.config = config;
		this.rows = rows;
		this.theme = mergeTheme(defaultTheme, config.theme);
		this.request = requestFromConfig(config);
		this.prepared = prepareData(rows, config);

		const doc = container.ownerDocument;
		this.element = doc.createElement('div');
		this.element.className = 'ft-timeline';
		this.element.style.width = '100%';
		this.element.setAttribute('role', 'figure');
		this.element.setAttribute('aria-label', 'Timeline');

		this.viewport = doc.createElement('div');
		this.viewport.className = 'ft-timeline-viewport';
		Object.assign(this.viewport.style, { position: 'relative', width: '100%', overflowX: 'auto', overflowY: 'hidden' });

		this.canvas = doc.createElement('canvas');
		this.canvas.className = 'ft-timeline-canvas';
		this.canvas.style.display = 'block';
		this.canvas.setAttribute('role', 'img');

		this.tooltip = doc.createElement('div');
		this.tooltip.className = 'ft-timeline-tooltip';
		this.badge = doc.createElement('div');
		this.badge.className = 'ft-timeline-drag-badge';

		this.viewport.append(this.canvas, this.tooltip, this.badge);
		this.element.append(this.viewport);
		container.append(this.element);

		const ctx = this.canvas.getContext('2d');
		if (!ctx) throw new Error('Timeline: 2D canvas context is not available');
		this.ctx = ctx;
		this.measure = cachedMeasure((text, font) => {
			ctx.font = font;
			return ctx.measureText(text).width;
		});

		this.syncControls();
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
	setConfig(patch: Partial<TimelineConfig<T>>): void {
		this.config = { ...this.config, ...patch };
		if (patch.theme) this.theme = mergeTheme(this.theme, patch.theme);
		if (patch.view) this.request = requestFromConfig(this.config);
		this.prepared = prepareData(this.rows, this.config);
		if ('controls' in patch || 'locale' in patch) this.syncControls();
		this.applyStyles();
		this.scheduleRender();
	}

	getConfig(): Readonly<TimelineConfig<T>> {
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

	getViewState(): ViewState | null {
		return this.layout?.view ?? null;
	}

	/** Show from the first month with data. */
	first(): void {
		this.navigate({ start: null });
	}

	/** Show up to the last month with data. */
	last(): void {
		this.navigate({ start: this.prepared.dataEnd });
	}

	prev(months = 1): void {
		this.shift(-Math.abs(months));
	}

	next(months = 1): void {
		this.shift(Math.abs(months));
	}

	/** Centre the window on today (clamped to the data). */
	today(): void {
		const visible = this.layout?.view.months ?? this.request.months ?? 12;
		const cal = this.prepared.calendar;
		const start = shiftPeriod(cal, cal.monthOf(today(this.prepared.zone)), -Math.floor(visible / 2)).start;
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

	/** Make the drawing wider than its container (scrolls horizontally). */
	expandWidth(factor = 1.25): void {
		this.widthScale = clamp(this.widthScale * factor, 1, 12);
		this.scheduleRender();
	}

	/** Fit the drawing to its container width. */
	fitWidth(): void {
		this.widthScale = 1;
		this.scheduleRender();
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Events & output
	// ---------------------------------------------------------------------------------------------------------------

	on<K extends keyof TimelineEventMap<T>>(type: K, handler: TimelineEventMap<T>[K]): Unsubscribe {
		return this.emitter.on(type, handler);
	}

	/** The most recent layout (positions of everything drawn). */
	getLayout(): TimelineLayout<T> | null {
		return this.layout;
	}

	/** Export the current drawing. */
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
		const available = this.viewport.clientWidth || this.element.parentElement?.clientWidth || 800;
		const width = Math.max(200, Math.floor(available * this.widthScale));
		const layout = computeLayout(this.prepared, {
			width,
			measureText: this.measure,
			view: this.request,
			theme: this.theme,
		});
		this.layout = layout;
		this.hitTest = createHitTester(layout);
		this.hover = null;
		this.sizeCanvas(layout.width, layout.height);
		this.draw();
		this.canvas.setAttribute('aria-label', describe(layout));

		this.emitter.emit('render', { layout });
		const prev = this.lastView;
		const view = layout.view;
		if (
			!prev ||
			prev.mode !== view.mode ||
			prev.offset !== view.offset ||
			prev.months !== view.months ||
			prev.totalMonths !== view.totalMonths
		) {
			this.lastView = view;
			this.controls?.update(view);
			this.emitter.emit('viewchange', view);
		}
	}

	/** Remove the timeline from the DOM and release every listener and observer. */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		if (this.frame !== null) cancelFrame(this.frame);
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.emitter.clear();
		this.element.remove();
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Internals
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
		if (this.layout) this.controls.update(this.layout.view);
	}

	private navigate(patch: Partial<ViewRequest>): void {
		this.request = { ...this.request, ...patch };
		this.scheduleRender();
	}

	private shift(months: number): void {
		const view = this.layout?.view;
		if (view?.mode !== 'continuous') return;
		const cal = this.prepared.calendar;
		this.navigate({ start: shiftPeriod(cal, cal.monthOf(view.start), months).start, months: view.months });
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
		drawTimeline(this.ctx as Context2D, layout, this.theme, {
			measure: this.measure,
			drag: this.drag?.active ? { barId: this.drag.bar.bar.id, dx: this.drag.dx } : null,
			offsets,
			hoverBarId: this.hover?.bar.id ?? null,
			getImage: (url) => this.image(url),
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
		this.canvas.style.touchAction = this.config.editable ? 'pan-y' : 'auto';
		this.controls?.restyle(this.theme);
	}

	private attachEvents(): void {
		const listen = <K extends keyof HTMLElementEventMap>(
			target: HTMLElement,
			type: K,
			handler: (e: HTMLElementEventMap[K]) => void,
		) => {
			target.addEventListener(type, handler);
			this.cleanups.push(() => target.removeEventListener(type, handler));
		};

		listen(this.canvas, 'pointerdown', (e) => this.onPointerDown(e));
		listen(this.canvas, 'pointermove', (e) => this.onPointerMove(e));
		listen(this.canvas, 'pointerup', (e) => this.onPointerUp(e));
		listen(this.canvas, 'pointercancel', () => this.cancelDrag());
		listen(this.canvas, 'pointerleave', () => {
			if (!this.drag) this.setHover(null);
		});
		listen(this.viewport, 'scroll', () => this.hideTooltip());

		const view = this.element.ownerDocument.defaultView;
		if (view && 'ResizeObserver' in view) {
			let lastWidth = this.viewport.clientWidth;
			const observer = new view.ResizeObserver(() => {
				const width = this.viewport.clientWidth;
				if (width !== lastWidth) {
					lastWidth = width;
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

	private point(e: PointerEvent): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		const layout = this.layout;
		const sx = layout && rect.width ? layout.width / rect.width : 1;
		const sy = layout && rect.height ? layout.height / rect.height : 1;
		return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
	}

	private onPointerDown(e: PointerEvent): void {
		if (e.button !== 0 || !this.hitTest || !this.layout) return;
		const { x, y } = this.point(e);
		const hit = this.hitTest(x, y);
		if (!hit) return;
		const view = this.layout.view;
		const canDrag = this.config.editable === true && view.mode === 'continuous' && this.layout.dayWidth > 0;
		const startDay = dayNumber(hit.bar.start);
		const endDay = dayNumber(hit.bar.end);
		this.drag = {
			pointerId: e.pointerId,
			bar: hit,
			startX: x,
			dx: 0,
			active: false,
			// Keep the bar inside the view; a side already beyond the view cannot move further out.
			minDays: canDrag ? Math.min(0, dayNumber(view.start) - startDay) : 0,
			maxDays: canDrag ? Math.max(0, dayNumber(view.end) - endDay) : 0,
		};
		if (canDrag) this.canvas.setPointerCapture?.(e.pointerId);
	}

	private onPointerMove(e: PointerEvent): void {
		const drag = this.drag;
		const layout = this.layout;
		if (drag && layout && drag.pointerId === e.pointerId && (drag.minDays !== 0 || drag.maxDays !== 0)) {
			const { x } = this.point(e);
			const raw = x - drag.startX;
			if (!drag.active && Math.abs(raw) < DRAG_THRESHOLD_PX) return;
			if (!drag.active) {
				drag.active = true;
				this.hideTooltip();
			}
			const days = clamp(Math.round(raw / layout.dayWidth), drag.minDays, drag.maxDays);
			drag.dx = days * layout.dayWidth;
			this.showBadge(drag.bar, days);
			this.draw();
			return;
		}
		if (drag) return;
		const { x, y } = this.point(e);
		this.setHover(this.hitTest?.(x, y) ?? null);
	}

	private onPointerUp(e: PointerEvent): void {
		const drag = this.drag;
		if (!drag || drag.pointerId !== e.pointerId) return;
		this.drag = null;
		this.canvas.releasePointerCapture?.(e.pointerId);
		this.badge.style.visibility = 'hidden';
		const layout = this.layout;
		if (!drag.active || !layout) {
			this.emitter.emit('click', { bar: drag.bar.bar, rows: drag.bar.bar.rows, nativeEvent: e });
			return;
		}
		const days = Math.round(drag.dx / layout.dayWidth);
		if (days === 0) {
			this.draw();
			return;
		}
		void this.finishMove(drag.bar, days);
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
				console.error('[timeline] "move" handler threw', error);
				accepted = false;
			}
		}
		if (this.destroyed) return;
		if (!accepted) this.pendingMoves.delete(bar.bar.id);
		this.draw();
	}

	private cancelDrag(): void {
		if (!this.drag) return;
		this.drag = null;
		this.badge.style.visibility = 'hidden';
		this.draw();
	}

	private setHover(hit: BarLayout<T> | null): void {
		if (hit?.bar.id === this.hover?.bar.id) return;
		this.hover = hit;
		this.canvas.style.cursor = hit
			? this.config.editable && this.layout?.view.mode === 'continuous'
				? 'grab'
				: 'pointer'
			: '';
		this.draw();
		this.emitter.emit('hover', { bar: hit?.bar ?? null });
		if (!hit) {
			this.hideTooltip();
			return;
		}
		const content = this.config.tooltip
			? this.config.tooltip(hit.bar, hit.bar.metrics)
			: defaultTooltip(hit.bar, this.prepared.metrics, this.prepared.locale, this.element.ownerDocument);
		if (content === null || content === '') {
			this.hideTooltip();
			return;
		}
		if (typeof content === 'string') this.tooltip.textContent = content;
		else this.tooltip.replaceChildren(content);
		this.tooltip.style.visibility = 'visible';
		this.placeFloating(this.tooltip, hit, 0);
	}

	private hideTooltip(): void {
		this.tooltip.style.visibility = 'hidden';
	}

	private showBadge(bar: BarLayout<T>, days: number): void {
		const locale = this.prepared.locale;
		const fmt = (d: CalendarDate) => d.setLocale(locale).toFormat('d LLL');
		this.badge.textContent = `${fmt(addDays(bar.bar.start, days))} – ${fmt(addDays(bar.bar.end, days))}`;
		this.badge.style.visibility = 'visible';
		this.placeFloating(this.badge, bar, this.drag?.dx ?? 0);
	}

	private placeFloating(el: HTMLElement, bar: BarLayout<T>, dx: number): void {
		const layout = this.layout;
		if (!layout) return;
		positionFloating(
			el,
			{ ...bar.rect, x: bar.rect.x + dx },
			{ scrollLeft: this.viewport.scrollLeft, width: this.viewport.clientWidth || layout.width },
			layout.height,
			themeMetrics(this.theme).padding,
		);
	}
}

function requestFromConfig<T>(config: TimelineConfig<T>): ViewRequest {
	const zone = config.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	const view = config.view ?? {};
	return {
		mode: view.mode ?? 'continuous',
		start: view.start === undefined ? null : parseDateInput(view.start, zone),
		months: view.months ?? null,
	};
}

function describe<T>(layout: TimelineLayout<T>): string {
	if (layout.empty) return 'Timeline: no data';
	const v = layout.view;
	return `Timeline from ${v.start.toISODate()} to ${v.end.toISODate()}, ${layout.bars.length} bars`;
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
