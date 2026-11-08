import type { ResolvedMetric } from '../layout/aggregate';
import type { Bar } from '../layout/types';
import type { Theme } from '../render/theme';

/** Default tooltip: group path, dates, row count and every metric. Built with DOM nodes — no HTML injection. */
export function defaultTooltip<T>(
	bar: Bar<T>,
	metrics: readonly ResolvedMetric<T>[],
	locale: string,
	doc: Document,
): HTMLElement {
	const root = doc.createElement('div');
	const title = doc.createElement('div');
	title.style.fontWeight = '700';
	title.textContent = bar.groupLabels.join(' › ') || 'Item';
	if (bar.rows.length > 1) {
		const count = doc.createElement('span');
		count.style.cssText = 'font-weight:400;margin-left:6px;opacity:0.7;font-size:smaller';
		count.textContent = `(${bar.rows.length} rows)`;
		title.append(count);
	}
	root.append(title);

	const dates = doc.createElement('div');
	const fmt = (d: Bar<T>['start']) => d.setLocale(locale).toFormat('d LLL yyyy');
	dates.textContent = `${fmt(bar.start)} – ${fmt(bar.end)} (${bar.days} days)`;
	root.append(dates);

	for (const metric of metrics) {
		const value = bar.metrics[metric.id];
		if (value === null || value === undefined) continue;
		const line = doc.createElement('div');
		line.textContent = `${metric.label}: ${metric.format(value)}`;
		root.append(line);
	}
	return root;
}

/** Base style of the tooltip and drag badge: fixed to the window, sized to their content. */
export function styleFloating(el: HTMLElement, theme: Theme, font: string): void {
	const c = theme.colors;
	Object.assign(el.style, {
		position: 'fixed',
		inset: 'auto',
		top: '0px',
		left: '0px',
		margin: '0',
		zIndex: '1000',
		pointerEvents: 'none',
		visibility: 'hidden',
		background: c.tooltipBackground,
		color: c.tooltipText,
		border: `1px solid ${c.tooltipBorder}`,
		borderRadius: '6px',
		boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
		padding: '6px 8px',
		font,
		boxSizing: 'border-box',
		width: 'max-content',
		whiteSpace: 'normal',
		overflowWrap: 'anywhere',
		overflow: 'auto',
	} satisfies Partial<CSSStyleDeclaration>);
}

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The part of the window the user can see, in client (`position: fixed`) coordinates. */
export function visibleBounds(view: Window | null): Box {
	if (!view) return { x: 0, y: 0, width: 1024, height: 768 };
	const vv = view.visualViewport;
	if (vv) return { x: vv.offsetLeft, y: vv.offsetTop, width: vv.width, height: vv.height };
	const root = view.document.documentElement;
	return {
		x: 0,
		y: 0,
		width: root?.clientWidth || view.innerWidth,
		height: root?.clientHeight || view.innerHeight,
	};
}

/**
 * Where to put a floating box of `size` next to `anchor` (the visible part of a bar), inside `bounds` — all in client
 * coordinates. Horizontally: aligned with the anchor's start when the anchor is in the left half of the bounds, with
 * its end otherwise. Vertically: below the anchor when there is room, else above, else on the roomier side. The result
 * is clamped so the box stays inside the bounds (a box larger than the bounds sticks to their top-left).
 */
export function placeFloating(
	size: { width: number; height: number },
	anchor: Box,
	bounds: Box,
	gap: number,
): { x: number; y: number } {
	const minX = bounds.x + gap;
	const maxX = bounds.x + bounds.width - size.width - gap;
	const mid = anchor.x + anchor.width / 2;
	let x = mid < bounds.x + bounds.width / 2 ? anchor.x : anchor.x + anchor.width - size.width;
	x = Math.max(minX, Math.min(x, maxX));

	const minY = bounds.y + gap;
	const maxY = bounds.y + bounds.height - size.height - gap;
	const below = anchor.y + anchor.height + gap;
	const above = anchor.y - gap - size.height;
	let y: number;
	if (below <= maxY) y = below;
	else if (above >= minY) y = above;
	else {
		const roomBelow = bounds.y + bounds.height - (anchor.y + anchor.height);
		const roomAbove = anchor.y - bounds.y;
		y = roomBelow >= roomAbove ? below : above;
	}
	y = Math.max(minY, Math.min(y, maxY));
	return { x: Math.round(x), y: Math.round(y) };
}
