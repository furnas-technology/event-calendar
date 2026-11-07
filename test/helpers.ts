import type { EventCalendarConfig } from '../src/config';
import { computeLayout, type LayoutOptions, prepareData } from '../src/layout/layout';
import type { EventCalendarLayout, GroupLayout } from '../src/layout/types';
import type { ViewRequest } from '../src/layout/view';
import { defaultTheme } from '../src/render/theme';

/** Deterministic text measurer for layout tests (≈ 7 px per character). */
export const fakeMeasure = (text: string) => text.length * 7;

export function layoutOf<T>(
	rows: readonly T[],
	config: EventCalendarConfig<T>,
	view: Partial<ViewRequest> = {},
	extra: Partial<LayoutOptions> = {},
): EventCalendarLayout<T> {
	const prepared = prepareData(rows, config);
	return computeLayout(prepared, {
		width: 1200,
		measureText: fakeMeasure,
		theme: defaultTheme,
		view: { mode: 'continuous', start: null, months: null, ...view },
		...extra,
	});
}

export function flatGroups<T>(node: GroupLayout<T>): GroupLayout<T>[] {
	return node.children.flatMap((c) => [c, ...flatGroups(c)]);
}

export function findGroup<T>(layout: EventCalendarLayout<T>, ...path: string[]): GroupLayout<T> {
	const found = flatGroups(layout.root).find((g) => g.path.join('/') === path.join('/'));
	if (!found) throw new Error(`group ${path.join('/')} not found`);
	return found;
}
