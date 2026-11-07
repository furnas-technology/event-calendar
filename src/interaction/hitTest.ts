import type { BarLayout, EventCalendarLayout, GroupLayout, LaneLayout } from '../layout/types';

export type HitTester<T> = (x: number, y: number) => BarLayout<T> | null;

/** Build a bar lookup: binary search the lane by y, then the bar by x. O(log lanes + log bars). */
export function createHitTester<T>(layout: EventCalendarLayout<T>): HitTester<T> {
	const lanes: LaneLayout<T>[] = [];
	const collect = (group: GroupLayout<T>) => {
		lanes.push(...group.lanes);
		for (const child of group.children) collect(child);
	};
	collect(layout.root);
	lanes.sort((a, b) => a.rect.y - b.rect.y);

	return (x, y) => {
		let lo = 0;
		let hi = lanes.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const lane = lanes[mid] as LaneLayout<T>;
			if (y < lane.rect.y) hi = mid - 1;
			else if (y >= lane.rect.y + lane.rect.height) lo = mid + 1;
			else return findInLane(lane.bars, x, y);
		}
		return null;
	};
}

function findInLane<T>(bars: readonly BarLayout<T>[], x: number, y: number): BarLayout<T> | null {
	// Bars in a lane never overlap and are sorted by x.
	let lo = 0;
	let hi = bars.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const bar = bars[mid] as BarLayout<T>;
		if (x < bar.rect.x) hi = mid - 1;
		else if (x > bar.rect.x + bar.rect.width) lo = mid + 1;
		else return y >= bar.rect.y && y <= bar.rect.y + bar.rect.height ? bar : null;
	}
	return null;
}
