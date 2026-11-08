import { fitText, type MeasureText } from '../layout/measure';
import type { BarLayout, EventCalendarLayout, GroupLayout, HeaderCell, Rect, TotalRowLayout } from '../layout/types';
import { contrastText, darken, parseColor, type Rgba, toCss } from './color';
import { pick, type Theme, type ThemeMetrics, themeMetrics } from './theme';

/** The subset of `CanvasRenderingContext2D` the renderer uses (also satisfied by node canvas implementations). */
export type Context2D = Pick<
	CanvasRenderingContext2D,
	| 'save'
	| 'restore'
	| 'beginPath'
	| 'closePath'
	| 'moveTo'
	| 'lineTo'
	| 'arcTo'
	| 'rect'
	| 'clip'
	| 'fill'
	| 'stroke'
	| 'fillRect'
	| 'clearRect'
	| 'fillText'
	| 'measureText'
	| 'drawImage'
	| 'setTransform'
	| 'translate'
	| 'fillStyle'
	| 'strokeStyle'
	| 'lineWidth'
	| 'font'
	| 'textAlign'
	| 'textBaseline'
	| 'globalAlpha'
	| 'shadowColor'
	| 'shadowBlur'
	| 'shadowOffsetY'
>;

export interface DrawOptions {
	measure: MeasureText;
	/** Bar being dragged and its horizontal offset in CSS pixels (drawn on top, with a shadow). */
	drag?: { barId: string; dx: number } | null;
	/** Horizontal offsets in CSS pixels for bars moved but not yet re-supplied via `setData`. */
	offsets?: ReadonlyMap<string, number>;
	hoverBarId?: string | null;
	/** Returns a loaded image for an icon URL, or null if not (yet) available. */
	getImage?: (url: string) => CanvasImageSource | null;
	emptyText?: string;
	/** Draw only a scrolled part of the layout into a canvas of the viewport's size (see {@link DrawViewport}). */
	viewport?: DrawViewport | null;
}

/**
 * A scrolled view of the layout. The canvas is `width` × `height` CSS pixels; layout point `(x + cx, y + cy)` is drawn
 * at canvas point `(cx, cy)`, except that the first `frozenX` columns (the row headings) do not scroll horizontally and
 * the first `frozenY` rows (the time axis) do not scroll vertically.
 */
export interface DrawViewport {
	x: number;
	y: number;
	width: number;
	height: number;
	frozenX: number;
	frozenY: number;
}

/** Draw a complete layout (or, with `options.viewport`, its visible part). The context must already be scaled for device pixel ratio. */
export function drawEventCalendar<T>(
	ctx: Context2D,
	layout: EventCalendarLayout<T>,
	theme: Theme,
	options: DrawOptions,
): void {
	const tm = themeMetrics(theme);
	const colors = theme.colors;
	const painter = new Painter(ctx, options.measure, tm);
	const vp = options.viewport ?? null;
	const width = vp ? vp.width : layout.width;
	const height = vp ? vp.height : layout.height;

	ctx.save();
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = colors.background;
	ctx.fillRect(0, 0, width, height);

	if (layout.empty) {
		painter.text(
			options.emptyText ?? 'No data to display',
			width / 2,
			layout.headerHeight + tm.laneHeight,
			'center',
			tm.rowFont,
			colors.text,
		);
		ctx.restore();
		return;
	}

	if (!vp) {
		drawScene(painter, layout, theme, tm, options, { x: 0, y: 0, width: layout.width, height: layout.height });
		ctx.restore();
		return;
	}

	// Body, headings column, time axis, corner: each clipped to its part of the canvas and scrolled on its own axes.
	const fx = Math.max(0, Math.min(vp.frozenX, width));
	const fy = Math.max(0, Math.min(vp.frozenY, height));
	const parts = [
		{ cx: fx, cy: fy, cw: width - fx, ch: height - fy, sx: vp.x, sy: vp.y },
		{ cx: 0, cy: fy, cw: fx, ch: height - fy, sx: 0, sy: vp.y },
		{ cx: fx, cy: 0, cw: width - fx, ch: fy, sx: vp.x, sy: 0 },
		{ cx: 0, cy: 0, cw: fx, ch: fy, sx: 0, sy: 0 },
	];
	for (const part of parts) {
		if (part.cw <= 0 || part.ch <= 0) continue;
		ctx.save();
		ctx.beginPath();
		ctx.rect(part.cx, part.cy, part.cw, part.ch);
		ctx.clip();
		ctx.translate(-part.sx, -part.sy);
		drawScene(painter, layout, theme, tm, options, {
			x: part.cx + part.sx,
			y: part.cy + part.sy,
			width: part.cw,
			height: part.ch,
		});
		ctx.restore();
	}
	// Soft shadow where scrolled content passes under the frozen headings / time axis.
	if (fx > 0 && vp.x > 0) {
		[0.16, 0.08, 0.04].forEach((alpha, i) => {
			painter.line(fx + i, fy, fx + i, height, `rgba(0, 0, 0, ${alpha})`);
		});
	}
	if (fy > 0 && vp.y > 0) {
		[0.16, 0.08, 0.04].forEach((alpha, i) => {
			painter.line(0, fy + i, width, fy + i, `rgba(0, 0, 0, ${alpha})`);
		});
	}
	ctx.restore();
}

/** Everything that intersects `view` (a rect in layout coordinates), drawn in layout coordinates. */
function drawScene<T>(
	painter: Painter,
	layout: EventCalendarLayout<T>,
	theme: Theme,
	tm: ThemeMetrics,
	options: DrawOptions,
	view: Rect,
): void {
	painter.fillRect(view.x, view.y, view.width, view.height, theme.colors.background);
	drawGroupBackgrounds(painter, layout, layout.root, theme, tm, view);
	drawGridLines(painter, layout, theme, tm, view);

	const dragId = options.drag?.barId ?? null;
	for (const bar of layout.bars) {
		if (bar.bar.id === dragId) continue;
		const dx = options.offsets?.get(bar.bar.id) ?? 0;
		if (!intersects({ ...bar.rect, x: bar.rect.x + dx }, view)) continue;
		drawBar(painter, bar, theme, tm, options, dx, bar.bar.id === options.hoverBarId, view);
	}

	drawTotals(painter, layout, layout.root, theme, tm, view);
	if (view.y < layout.headerHeight) drawHeader(painter, layout, theme, tm, view);

	if (dragId && options.drag) {
		const dragged = layout.bars.find((b) => b.bar.id === dragId);
		if (dragged) {
			const { ctx } = painter;
			ctx.save();
			ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
			ctx.shadowBlur = 6;
			ctx.shadowOffsetY = 2;
			drawBar(painter, dragged, theme, tm, options, options.drag.dx, true, view);
			ctx.restore();
		}
	}
}

function intersects(a: Rect, b: Rect): boolean {
	return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

/** Left edge of the visible time grid. */
function visibleGridLeft<T>(layout: EventCalendarLayout<T>, view: Rect): number {
	return Math.max(layout.gridX, view.x);
}

class Painter {
	private readonly parsed = new Map<string, Rgba | null>();
	constructor(
		readonly ctx: Context2D,
		readonly measure: MeasureText,
		readonly tm: ThemeMetrics,
	) {}

	fillRect(x: number, y: number, w: number, h: number, color: string): void {
		if (w <= 0 || h <= 0) return;
		this.ctx.fillStyle = color;
		this.ctx.fillRect(x, y, w, h);
	}

	/** Crisp 1px line: offset by half a pixel on the perpendicular axis. */
	line(x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
		const { ctx } = this;
		const vertical = Math.abs(x1 - x2) < 0.01;
		const ox = vertical ? Math.round(x1) + 0.5 - x1 : 0;
		const oy = vertical ? 0 : Math.round(y1) + 0.5 - y1;
		ctx.beginPath();
		ctx.strokeStyle = color;
		ctx.lineWidth = width;
		ctx.moveTo(x1 + ox, y1 + oy);
		ctx.lineTo(x2 + ox, y2 + oy);
		ctx.stroke();
	}

	text(
		text: string,
		x: number,
		y: number,
		align: CanvasTextAlign,
		font: string,
		color: string,
		maxWidth?: number,
	): void {
		if (!text) return;
		const { ctx } = this;
		const shown = maxWidth === undefined ? text : fitText(text, maxWidth, font, this.measure);
		if (!shown) return;
		ctx.font = font;
		ctx.fillStyle = color;
		ctx.textAlign = align;
		ctx.textBaseline = 'alphabetic';
		ctx.fillText(shown, x, y);
	}

	roundRect(x: number, y: number, w: number, h: number, radii: [number, number, number, number]): void {
		const { ctx } = this;
		const max = Math.min(w / 2, h / 2);
		const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, max))) as [number, number, number, number];
		ctx.beginPath();
		ctx.moveTo(x + tl, y);
		ctx.lineTo(x + w - tr, y);
		ctx.arcTo(x + w, y, x + w, y + tr, tr);
		ctx.lineTo(x + w, y + h - br);
		ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
		ctx.lineTo(x + bl, y + h);
		ctx.arcTo(x, y + h, x, y + h - bl, bl);
		ctx.lineTo(x, y + tl);
		ctx.arcTo(x, y, x + tl, y, tl);
		ctx.closePath();
	}

	color(css: string): Rgba | null {
		if (!this.parsed.has(css)) {
			let rgba = parseColor(css);
			if (!rgba) {
				// Let the canvas normalise named/hsl colours, then parse what it reports back.
				this.ctx.fillStyle = '#000';
				this.ctx.fillStyle = css;
				const normalised = this.ctx.fillStyle;
				rgba = typeof normalised === 'string' ? parseColor(normalised) : null;
			}
			this.parsed.set(css, rgba);
		}
		return this.parsed.get(css) ?? null;
	}
}

function drawGroupBackgrounds<T>(
	p: Painter,
	layout: EventCalendarLayout<T>,
	group: GroupLayout<T>,
	theme: Theme,
	tm: ThemeMetrics,
	view: Rect,
): void {
	if (group.rect.y > view.y + view.height || group.rect.y + group.rect.height < view.y) return;
	const colors = theme.colors;
	const band = group.band === 'odd' ? colors.bandOdd : colors.bandEven;
	const bottom = group.rect.y + group.rect.height - (group.total?.rect.height ?? 0);

	if (group.level >= 0) {
		const h = group.headerRect;
		p.fillRect(h.x, h.y, h.width, bottom - h.y, band);
		// Keep the heading at the top of the visible part of a tall group.
		const labelHeight = tm.padding * 2 + tm.rowFontSize;
		const top = Math.max(h.y, Math.min(view.y, bottom - labelHeight));
		p.text(
			group.label,
			h.x + tm.padding,
			top + tm.padding + tm.rowFontSize,
			'left',
			tm.rowFont,
			colors.rowHeaderText,
			h.width - tm.padding * 2,
		);
	}
	for (const lane of group.lanes) {
		if (lane.rect.y > view.y + view.height || lane.rect.y + lane.rect.height < view.y) continue;
		p.fillRect(layout.gridX, lane.rect.y, layout.gridWidth, lane.rect.height, band);
	}
	for (const child of group.children) drawGroupBackgrounds(p, layout, child, theme, tm, view);

	if (group.level >= 0) {
		const lineColor = pick(colors.rowLines, group.level, '#999');
		const y = bottom - 1;
		p.line(group.headerRect.x, y, layout.gridX - tm.padding, y, lineColor);
		p.line(layout.gridX, y, layout.gridX + layout.gridWidth, y, lineColor);
	}
}

function drawGridLines<T>(
	p: Painter,
	layout: EventCalendarLayout<T>,
	theme: Theme,
	tm: ThemeMetrics,
	view: Rect,
): void {
	const colors = theme.colors;
	const top = Math.max(layout.headerHeight, view.y - 1);
	const bottom = Math.min(layout.height - tm.padding, view.y + view.height + 1);
	if (bottom <= top) return;
	for (const line of layout.gridLines) {
		if (line.x < view.x - 1 || line.x > view.x + view.width + 1) continue;
		const color =
			line.kind === 'week' ? colors.gridWeek : line.kind === 'month' ? colors.gridMonth : colors.gridBoundary;
		p.line(line.x, top, line.x, bottom, color);
	}
}

function drawBar<T>(
	p: Painter,
	layout: BarLayout<T>,
	theme: Theme,
	tm: ThemeMetrics,
	options: DrawOptions,
	dx: number,
	highlight: boolean,
	view: Rect,
): void {
	const { ctx } = p;
	const { rect } = layout;
	const x = rect.x + dx;
	const rgba = p.color(layout.color);
	const r = theme.barRadius;
	p.roundRect(x, rect.y, rect.width, rect.height, [
		layout.clippedStart ? 0 : r,
		layout.clippedEnd ? 0 : r,
		layout.clippedEnd ? 0 : r,
		layout.clippedStart ? 0 : r,
	]);
	ctx.fillStyle = layout.color;
	ctx.fill();
	if (rgba) {
		ctx.strokeStyle = toCss(darken(rgba, highlight ? 0.45 : 0.2));
		ctx.lineWidth = highlight ? 2 : 1;
		ctx.stroke();
	}

	const textColor = contrastText(rgba, theme.colors.barTextDark, theme.colors.barTextLight);
	let textX = x + tm.padding + 1;
	let maxWidth = rect.width - tm.padding * 2 - 1;
	if (maxWidth < 6) return;
	// A bar that starts left of the visible grid keeps its label in view (while there is room for some of it).
	const stickyX = view.x + tm.padding + 1;
	const stickyWidth = x + rect.width - tm.padding - stickyX;
	if (stickyX > textX && stickyWidth >= 6) {
		textX = stickyX;
		maxWidth = stickyWidth;
	}

	ctx.save();
	ctx.beginPath();
	ctx.rect(x, rect.y, rect.width, rect.height);
	ctx.clip();
	let lastLineEnd = textX;
	layout.lines.forEach((line, i) => {
		const baseline = rect.y + (i + 1) * tm.barLineHeight - Math.round((tm.barLineHeight - tm.barFontSize) / 2) - 2;
		const shown = fitText(line, maxWidth, tm.barFont, p.measure);
		p.text(shown, textX, baseline, 'left', tm.barFont, textColor);
		if (i === 0) lastLineEnd = textX + p.measure(shown, tm.barFont);
	});

	if (layout.icons.length > 0 && options.getImage) {
		const size = tm.barLineHeight - 4;
		let iconX = lastLineEnd + tm.padding;
		for (const url of layout.icons) {
			if (iconX + size > x + rect.width - tm.padding) break;
			const image = options.getImage(url);
			if (image) ctx.drawImage(image, iconX, rect.y + 2, size, size);
			iconX += size + 2;
		}
	}
	ctx.restore();
}

function drawTotals<T>(
	p: Painter,
	layout: EventCalendarLayout<T>,
	group: GroupLayout<T>,
	theme: Theme,
	tm: ThemeMetrics,
	view: Rect,
): void {
	if (group.rect.y > view.y + view.height || group.rect.y + group.rect.height < view.y) return;
	for (const child of group.children) drawTotals(p, layout, child, theme, tm, view);
	if (group.total && intersects(group.total.rect, view)) drawTotalRow(p, layout, group.total, theme, tm, view);
}

function drawTotalRow<T>(
	p: Painter,
	layout: EventCalendarLayout<T>,
	total: TotalRowLayout,
	theme: Theme,
	tm: ThemeMetrics,
	view: Rect,
): void {
	const colors = theme.colors;
	const { rect, headerRect } = total;
	p.fillRect(rect.x, rect.y, rect.width, rect.height, pick(colors.totalsFill, total.depth, 'rgba(0,0,0,0.05)'));
	p.line(rect.x, rect.y, rect.x + rect.width, rect.y, colors.totalsLine);
	p.line(rect.x, rect.y + rect.height - 1, rect.x + rect.width, rect.y + rect.height - 1, colors.totalsLine);

	const cellPadding = Math.max(2, Math.round(tm.padding / 2));
	total.lines.forEach((line, i) => {
		const baseline = rect.y + tm.padding / 2 + (i + 1) * tm.totalsLineHeight - tm.padding - 1;
		// Header area: label on the left, overall value right-aligned.
		const valueWidth = p.measure(line.formatted, tm.totalsFont);
		const available = headerRect.width - tm.padding * 2;
		if (valueWidth <= available) {
			p.text(
				line.formatted,
				headerRect.x + headerRect.width - tm.padding,
				baseline,
				'right',
				tm.totalsFont,
				colors.totalsText,
			);
			p.text(
				line.label,
				headerRect.x + tm.padding,
				baseline,
				'left',
				tm.totalsFont,
				colors.totalsText,
				available - valueWidth - tm.padding,
			);
		} else {
			p.text(line.formatted, headerRect.x + tm.padding, baseline, 'left', tm.totalsFont, colors.totalsText, available);
		}
		// Period cells, centred under each month.
		line.formattedPeriods.forEach((text, col) => {
			const column = layout.periodColumns[col];
			if (!column || !text || column.x > view.x + view.width || column.x + column.width < view.x) return;
			p.text(
				text,
				column.x + column.width / 2,
				baseline,
				'center',
				tm.totalsFont,
				colors.totalsText,
				column.width - cellPadding * 2,
			);
		});
	});
}

function drawHeader<T>(p: Painter, layout: EventCalendarLayout<T>, theme: Theme, tm: ThemeMetrics, view: Rect): void {
	const colors = theme.colors;
	p.fillRect(view.x, 0, view.width, layout.headerHeight, colors.background);

	const left = visibleGridLeft(layout, view);
	const right = view.x + view.width;
	for (const cell of layout.headerCells) {
		if (cell.x > right || cell.x + cell.width < view.x) continue;
		drawHeaderCell(p, cell, theme, tm, left, right);
	}

	if (layout.legend.length > 0) {
		const y = tm.padding + tm.axisFontSize + 1;
		const size = Math.ceil(tm.axisFontSize * 0.8);
		let x = left + 2;
		for (const item of layout.legend) {
			p.fillRect(x, y - size, size, size, item.color);
			x += size + 3;
			p.text(item.label, x, y, 'left', tm.legendFont, colors.axisText);
			x += p.measure(item.label, tm.legendFont) + tm.padding * 3;
		}
	}
	p.line(
		layout.gridX,
		layout.headerHeight - 1,
		layout.gridX + layout.gridWidth,
		layout.headerHeight - 1,
		colors.gridBoundary,
	);
}

/** Draws a header cell; a centred label moves into the visible part of its cell (`left`…`right`), staying inside it. */
function drawHeaderCell(
	p: Painter,
	cell: HeaderCell,
	theme: Theme,
	tm: ThemeMetrics,
	left: number,
	right: number,
): void {
	const colors = theme.colors;
	let x =
		cell.align === 'center' ? cell.x + cell.width / 2 : cell.align === 'left' ? cell.x + 2 : cell.x + cell.width - 2;
	if (cell.align === 'center' && cell.text && (cell.x < left || cell.x + cell.width > right)) {
		const half = p.measure(cell.text, tm.axisFont) / 2 + 2;
		const visibleCentre = (Math.max(cell.x, left) + Math.min(cell.x + cell.width, right)) / 2;
		x = Math.max(cell.x + half, Math.min(visibleCentre, cell.x + cell.width - half));
	}
	p.text(cell.text, x, cell.y, cell.align, tm.axisFont, colors.axisText);
	if (!cell.bracket || cell.width < 6) return;
	const top = cell.y - tm.axisFontSize;
	p.line(cell.x, top, cell.x, cell.y, colors.axisMark);
	p.line(cell.x + cell.width, top, cell.x + cell.width, cell.y, colors.axisMark);
	if (cell.tier === 'year') p.line(cell.x, cell.y + 3, cell.x + cell.width, cell.y + 3, colors.axisMark);
}
