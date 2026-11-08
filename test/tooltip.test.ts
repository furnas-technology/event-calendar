import { describe, expect, it } from 'vitest';
import { placeFloating } from '../src/interaction/tooltip';

const bounds = { x: 0, y: 0, width: 1000, height: 800 };

describe('placeFloating', () => {
	it('puts the box below a bar, aligned with its start in the left half', () => {
		expect(placeFloating({ width: 200, height: 100 }, { x: 100, y: 50, width: 80, height: 20 }, bounds, 4)).toEqual({
			x: 100,
			y: 74,
		});
	});

	it('aligns with the bar end in the right half and stays inside the right edge', () => {
		const anchor = { x: 900, y: 50, width: 90, height: 20 };
		expect(placeFloating({ width: 300, height: 100 }, anchor, bounds, 4).x).toBe(690);
		// Wider than the room left of the bar's end: clamped to the bounds.
		expect(placeFloating({ width: 300, height: 100 }, { x: 990, y: 50, width: 9, height: 20 }, bounds, 4).x).toBe(696);
	});

	it('flips above when there is no room below', () => {
		expect(placeFloating({ width: 200, height: 100 }, { x: 100, y: 750, width: 80, height: 20 }, bounds, 4).y).toBe(
			646,
		);
	});

	it('keeps a box taller than the room on either side inside the bounds', () => {
		const { y } = placeFloating({ width: 200, height: 700 }, { x: 100, y: 300, width: 80, height: 20 }, bounds, 4);
		expect(y).toBeGreaterThanOrEqual(4);
		expect(y + 700).toBeLessThanOrEqual(796);
	});

	it('honours offset bounds (a scrolled or zoomed visual viewport)', () => {
		const offset = { x: 200, y: 100, width: 400, height: 300 };
		const p = placeFloating({ width: 150, height: 50 }, { x: 0, y: 0, width: 10, height: 10 }, offset, 4);
		expect(p).toEqual({ x: 204, y: 104 });
	});
});
