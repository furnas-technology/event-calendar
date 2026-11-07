import { DateTime } from 'luxon';
import type { ControlLabels, ControlsOptions } from '../config';
import type { ViewState } from '../layout/types';
import type { Theme } from '../render/theme';

/** The calendar methods the controls drive. */
export interface ControlTarget {
	zoom(factor: number | 'reset'): void;
	expandWidth(factor?: number): void;
	fitWidth(): void;
	toBlob(type?: string): Promise<Blob>;
	first(): void;
	prev(months?: number): void;
	today(): void;
	next(months?: number): void;
	last(): void;
	setVisibleMonths(months: number | 'all'): void;
}

export interface Controls {
	readonly element: HTMLDivElement;
	update(view: ViewState): void;
	restyle(theme: Theme): void;
}

export const defaultControlLabels: ControlLabels = {
	zoomIn: 'A+',
	zoomOut: 'A−',
	zoomReset: 'Reset',
	expandWidth: 'Expand width',
	fitWidth: 'Fit width',
	savePng: 'Save PNG',
	first: 'First month',
	prev: 'Previous month',
	today: 'Today',
	next: 'Next month',
	last: 'Last month',
	allMonths: 'All',
	months: (n) => `${n} months`,
	visible: (shown, total) => `${shown} of ${total} months`,
};

const DEFAULT_MONTHS = [3, 6, 12, 24] as const;
const ZOOM_STEP = 1.15;
const WIDTH_STEP = 1.25;

/** True when any control is switched on. */
export function hasControls(options: ControlsOptions | undefined): boolean {
	return !!options && !!(options.zoom || options.width || options.savePng || options.navigation || options.months);
}

/**
 * Build the control bar: only the enabled groups, in a fixed order. Styled through CSSOM (works under a strict CSP);
 * restyle with CSS via the `ft-event-calendar-controls`, `ft-event-calendar-control-group`, `ft-event-calendar-control` and
 * `ft-event-calendar-range` classes.
 */
export function createControls(
	doc: Document,
	target: ControlTarget,
	options: ControlsOptions,
	theme: Theme,
	locale: string,
): Controls {
	const labels: ControlLabels = { ...defaultControlLabels, ...options.labels };
	const bar = doc.createElement('div');
	bar.className = 'ft-event-calendar-controls';
	bar.setAttribute('role', 'toolbar');
	bar.setAttribute('aria-label', 'Event calendar view');
	const controls: (HTMLButtonElement | HTMLSelectElement)[] = [];

	const group = (...children: HTMLElement[]) => {
		const g = doc.createElement('div');
		g.className = 'ft-event-calendar-control-group';
		g.append(...children);
		bar.append(g);
		return g;
	};
	const button = (text: string, onClick: () => void, title?: string) => {
		const b = doc.createElement('button');
		b.type = 'button';
		b.className = 'ft-event-calendar-control';
		b.textContent = text;
		if (title) {
			b.title = title;
			b.setAttribute('aria-label', title);
		}
		b.addEventListener('click', onClick);
		controls.push(b);
		return b;
	};

	if (options.zoom) {
		group(
			button(labels.zoomIn, () => target.zoom(ZOOM_STEP)),
			button(labels.zoomOut, () => target.zoom(1 / ZOOM_STEP)),
			button(labels.zoomReset, () => target.zoom('reset')),
		);
	}
	if (options.width) {
		group(
			button(labels.expandWidth, () => target.expandWidth(WIDTH_STEP)),
			button(labels.fitWidth, () => target.fitWidth()),
		);
	}
	if (options.savePng) {
		const fileName = options.fileName ?? 'event-calendar.png';
		group(
			button(labels.savePng, () => {
				void target.toBlob('image/png').then((blob) => {
					const a = doc.createElement('a');
					a.href = URL.createObjectURL(blob);
					a.download = fileName;
					a.click();
					URL.revokeObjectURL(a.href);
				});
			}),
		);
	}

	const option = (text: string, value: string) => {
		const o = doc.createElement('option');
		o.textContent = text;
		o.value = value;
		return o;
	};

	type NavButtons = Record<'first' | 'prev' | 'today' | 'next' | 'last', HTMLButtonElement>;
	let nav: NavButtons | null = null;
	let range: HTMLSpanElement | null = null;
	let months: HTMLSelectElement | null = null;
	const time = options.navigation || options.months ? group() : null;
	if (time && options.navigation) {
		nav = {
			first: button('⏮', () => target.first(), labels.first),
			prev: button('◀', () => target.prev(), labels.prev),
			today: button(labels.today, () => target.today()),
			next: button('▶', () => target.next(), labels.next),
			last: button('⏭', () => target.last(), labels.last),
		};
		time.append(nav.first, nav.prev, nav.today, nav.next, nav.last);
	}
	if (time && options.months) {
		const counts = Array.isArray(options.months) ? options.months : DEFAULT_MONTHS;
		const select = doc.createElement('select');
		select.className = 'ft-event-calendar-control';
		select.setAttribute('aria-label', 'Visible months');
		for (const n of counts) select.append(option(labels.months(n), String(n)));
		select.append(option(labels.allMonths, 'all'));
		select.addEventListener('change', () =>
			target.setVisibleMonths(select.value === 'all' ? 'all' : Number(select.value)),
		);
		controls.push(select);
		time.append(select);
		months = select;
	}
	if (time && options.navigation) {
		range = doc.createElement('span');
		range.className = 'ft-event-calendar-range';
		range.setAttribute('aria-live', 'polite');
		time.append(range);
	}

	const format = (d: DateTime) =>
		d.setZone('utc').setLocale(locale).toLocaleString({ day: 'numeric', month: 'short', year: 'numeric' });

	const restyle = (t: Theme) => {
		const c = t.colors;
		const font = `${t.baseFontSize}px ${t.fontFamily}`;
		Object.assign(bar.style, {
			display: 'flex',
			flexWrap: 'wrap',
			alignItems: 'center',
			gap: '6px 16px',
			padding: '6px 8px',
			font,
			color: c.text,
		});
		for (const g of bar.children) {
			Object.assign((g as HTMLElement).style, { display: 'flex', alignItems: 'center', gap: '4px' });
		}
		for (const el of controls) {
			Object.assign(el.style, {
				font,
				color: c.text,
				background: c.background,
				border: `1px solid ${c.gridBoundary}`,
				borderRadius: '5px',
				padding: '2px 8px',
				cursor: el.disabled ? 'default' : 'pointer',
				opacity: el.disabled ? '0.4' : '1',
			});
		}
		if (range) Object.assign(range.style, { color: c.axisText, marginLeft: '4px' });
	};
	restyle(theme);

	return {
		element: bar,
		restyle,
		update(view) {
			const yoy = view.mode === 'yoy';
			const disable = (el: HTMLButtonElement | HTMLSelectElement, off: boolean) => {
				el.disabled = off;
				el.style.cursor = off ? 'default' : 'pointer';
				el.style.opacity = off ? '0.4' : '1';
			};
			if (nav) {
				disable(nav.first, yoy || !view.canGoBack);
				disable(nav.prev, yoy || !view.canGoBack);
				disable(nav.next, yoy || !view.canGoForward);
				disable(nav.last, yoy || !view.canGoForward);
				disable(nav.today, yoy);
			}
			if (months) {
				disable(months, yoy);
				// A month count that isn't one of the choices (set by config or the API) gets a temporary option.
				for (const o of [...months.options]) if (o.dataset.custom) o.remove();
				const visible = String(view.months);
				if (view.months >= view.totalMonths) months.value = 'all';
				else {
					if (![...months.options].some((o) => o.value === visible)) {
						const extra = option(labels.months(view.months), visible);
						extra.dataset.custom = 'true';
						const after = [...months.options].find((o) => o.value !== 'all' && Number(o.value) > view.months);
						months.insertBefore(extra, after ?? months.options[months.options.length - 1] ?? null);
					}
					months.value = visible;
				}
			}
			if (range) {
				range.textContent = yoy
					? ''
					: `${format(view.start)} – ${format(view.end)} · ${labels.visible(view.months, view.totalMonths)}`;
			}
		},
	};
}
