import { fitText, type MeasureText } from '../layout/measure';
import type { BarLayout, EventCalendarLayout, GroupLayout, HeaderCell, TotalRowLayout } from '../layout/types';
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
}

/** Draw a complete layout. The context must already be scaled for device pixel ratio. */
export function drawEventCalendar<T>(
	ctx: Context2D,
	layout: EventCalendarLayout<T>,
	theme: Theme,
	options: DrawOptions,
): void {
	const tm = themeMetrics(theme);
	const colors = theme.colors;
	const painter = new Painter(ctx, options.measure, tm);

	ctx.save();
	ctx.clearRect(0, 0, layout.width, layout.height);
	ctx.fillStyle = colors.background;
	ctx.fillRect(0, 0, layout.width, layout.height);

	if (layout.empty) {
		painter.text(
			options.emptyText ?? 'No data to display',
			layout.width / 2,
			layout.headerHeight + tm.laneHeight,
			'center',
			tm.rowFont,
			colors.text,
		);
		ctx.restore();
		return;
	}

	drawGroupBackgrounds(painter, layout, layout.root, theme, tm);
	drawGridLines(painter, layout, theme, tm);

	const dragId = options.drag?.barId ?? null;
	for (const bar of layout.bars) {
		if (bar.bar.id === dragId) continue;
		const dx = options.offsets?.get(bar.bar.id) ?? 0;
		drawBar(painter, bar, theme, tm, options, dx, bar.bar.id === options.hoverBarId);
	}

	drawTotals(painter, layout, layout.root, theme, tm);
	drawHeader(painter, layout, theme, tm);

	if (dragId && options.drag) {
		const dragged = layout.bars.find((b) => b.bar.id === dragId);
		if (dragged) {
			ctx.save();
			ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
			ctx.shadowBlur = 6;
			ctx.shadowOffsetY = 2;
			drawBar(painter, dragged, theme, tm, options, options.drag.dx, true);
			ctx.restore();
		}
	}
	ctx.restore();
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
): void {
	const colors = theme.colors;
	const band = group.band === 'odd' ? colors.bandOdd : colors.bandEven;
	const bottom = group.rect.y + group.rect.height - (group.total?.rect.height ?? 0);

	if (group.level >= 0) {
		const h = group.headerRect;
		p.fillRect(h.x, h.y, h.width, bottom - h.y, band);
		p.text(
			group.label,
			h.x + tm.padding,
			h.y + tm.padding + tm.rowFontSize,
			'left',
			tm.rowFont,
			colors.rowHeaderText,
			h.width - tm.padding * 2,
		);
	}
	for (const lane of group.lanes) {
		p.fillRect(layout.gridX, lane.rect.y, layout.gridWidth, lane.rect.height, band);
	}
	for (const child of group.children) drawGroupBackgrounds(p, layout, child, theme, tm);

	if (group.level >= 0) {
		const lineColor = pick(colors.rowLines, group.level, '#999');
		const y = bottom - 1;
		p.line(group.headerRect.x, y, layout.gridX - tm.padding, y, lineColor);
		p.line(layout.gridX, y, layout.gridX + layout.gridWidth, y, lineColor);
	}
}

function drawGridLines<T>(p: Painter, layout: EventCalendarLayout<T>, theme: Theme, tm: ThemeMetrics): void {
	const colors = theme.colors;
	const top = layout.headerHeight;
	const bottom = layout.height - tm.padding;
	for (const line of layout.gridLines) {
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
	const textX = x + tm.padding + 1;
	const maxWidth = rect.width - tm.padding * 2 - 1;
	if (maxWidth < 6) return;

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
): void {
	for (const child of group.children) drawTotals(p, layout, child, theme, tm);
	if (group.total) drawTotalRow(p, layout, group.total, theme, tm);
}

function drawTotalRow<T>(
	p: Painter,
	layout: EventCalendarLayout<T>,
	total: TotalRowLayout,
	theme: Theme,
	tm: ThemeMetrics,
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
			if (!column || !text) return;
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

function drawHeader<T>(p: Painter, layout: EventCalendarLayout<T>, theme: Theme, tm: ThemeMetrics): void {
	const colors = theme.colors;
	p.fillRect(0, 0, layout.width, layout.headerHeight, colors.background);

	for (const cell of layout.headerCells) drawHeaderCell(p, cell, theme, tm);

	if (layout.legend.length > 0) {
		const y = tm.padding + tm.axisFontSize + 1;
		const size = Math.ceil(tm.axisFontSize * 0.8);
		let x = layout.gridX + 2;
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

function drawHeaderCell(p: Painter, cell: HeaderCell, theme: Theme, tm: ThemeMetrics): void {
	const colors = theme.colors;
	const x =
		cell.align === 'center' ? cell.x + cell.width / 2 : cell.align === 'left' ? cell.x + 2 : cell.x + cell.width - 2;
	p.text(cell.text, x, cell.y, cell.align, tm.axisFont, colors.axisText);
	if (!cell.bracket || cell.width < 6) return;
	const top = cell.y - tm.axisFontSize;
	p.line(cell.x, top, cell.x, cell.y, colors.axisMark);
	p.line(cell.x + cell.width, top, cell.x + cell.width, cell.y, colors.axisMark);
	if (cell.tier === 'year') p.line(cell.x, cell.y + 3, cell.x + cell.width, cell.y + 3, colors.axisMark);
}
