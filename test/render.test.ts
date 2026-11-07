import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import type { EventCalendarConfig } from '../src/config';
import { computeLayout, prepareData } from '../src/layout/layout';
import { type Context2D, drawEventCalendar } from '../src/render/canvas';
import { contrastText, parseColor } from '../src/render/color';
import { defaultTheme, mergeTheme } from '../src/render/theme';
import { type FlightVehicle, generateFlightVehicles } from './fixtures/flightVehicles';

const config: EventCalendarConfig<FlightVehicle> = {
	start: (r) => r.startDate,
	end: (r) => r.endDate,
	rowId: (r) => r.id,
	groupBy: [
		{ key: (r) => r.mediaGroup, subtotal: true },
		{ key: (r) => r.mediaType, subtotal: true },
		{ key: (r) => r.vehicle },
	],
	metrics: [{ id: 'cost', label: 'Cost', value: (r) => r.cost }],
	totals: { grand: true },
	bars: { color: () => '#ff0000' },
	zone: 'UTC',
};

function render(view: 'continuous' | 'yoy' = 'continuous') {
	const canvas = createCanvas(10, 10);
	const ctx = canvas.getContext('2d');
	const measure = (text: string, font: string) => {
		ctx.font = font;
		return ctx.measureText(text).width;
	};
	const layout = computeLayout(prepareData(generateFlightVehicles(), config), {
		width: 1400,
		measureText: measure,
		theme: defaultTheme,
		view: { mode: view, start: null, months: null },
	});
	canvas.width = layout.width;
	canvas.height = layout.height;
	drawEventCalendar(ctx as unknown as Context2D, layout, defaultTheme, { measure });
	return { ctx, layout };
}

describe('canvas renderer', () => {
	it('draws bars in their colour at their layout position', () => {
		const { ctx, layout } = render();
		const wide = layout.bars.find((b) => b.rect.width > 30);
		expect(wide).toBeDefined();
		if (!wide) return;
		// Probe just inside the bar's left edge, below the text baseline area.
		const px = ctx.getImageData(Math.round(wide.rect.x + 2), Math.round(wide.rect.y + wide.rect.height - 3), 1, 1).data;
		expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]);
	});

	it('paints total rows and the header without throwing', () => {
		const { ctx, layout } = render();
		const total = layout.grandTotal;
		expect(total).not.toBeNull();
		if (!total) return;
		const px = ctx.getImageData(
			Math.round(total.rect.x + total.rect.width - 3),
			Math.round(total.rect.y + total.rect.height / 2),
			1,
			1,
		).data;
		expect(px[3]).toBe(255);
		expect(px[0]).toBeGreaterThan(200); // pinkish grand-total fill over white
	});

	it('renders year-over-year mode with a legend', () => {
		const { layout } = render('yoy');
		expect(layout.legend.length).toBeGreaterThan(0);
	});

	it('renders an empty state', () => {
		const canvas = createCanvas(400, 200);
		const ctx = canvas.getContext('2d');
		const measure = (t: string) => t.length * 7;
		const layout = computeLayout(prepareData([], config), {
			width: 400,
			measureText: measure,
			theme: defaultTheme,
			view: { mode: 'continuous', start: null, months: null },
		});
		expect(layout.empty).toBe(true);
		expect(() => drawEventCalendar(ctx as unknown as Context2D, layout, defaultTheme, { measure })).not.toThrow();
	});
});

describe('colour helpers', () => {
	it('parses hex and rgb(a)', () => {
		expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
		expect(parseColor('#00ff0080')?.a).toBeCloseTo(0.5, 2);
		expect(parseColor('rgba(1, 2, 3, 0.4)')).toEqual({ r: 1, g: 2, b: 3, a: 0.4 });
		expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
		expect(parseColor('papayawhip')).toBeNull();
	});

	it('picks readable text', () => {
		expect(contrastText(parseColor('#ffffff'), 'dark', 'light')).toBe('dark');
		expect(contrastText(parseColor('#1f3a93'), 'dark', 'light')).toBe('light');
	});

	it('merges themes without dropping nested colours', () => {
		const t = mergeTheme(defaultTheme, { scale: 2, colors: { background: '#000' } });
		expect(t.scale).toBe(2);
		expect(t.colors.background).toBe('#000');
		expect(t.colors.palette).toBe(defaultTheme.colors.palette);
	});
});
