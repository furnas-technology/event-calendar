import { inclusiveDays, parseDateInput } from '../calendar/dates';
import type { EventCalendarConfig } from '../config';
import { type ResolvedMetric, readValue } from './aggregate';
import type { NormalizedRow } from './types';

export interface NormalizeResult<T> {
	rows: NormalizedRow<T>[];
	skipped: { index: number; reason: string }[];
}

/** Parse dates, group keys and metric values of every row once. Input rows are never mutated. */
export function normalizeRows<T>(
	rows: readonly T[],
	config: EventCalendarConfig<T>,
	metrics: readonly ResolvedMetric<T>[],
	zone: string,
): NormalizeResult<T> {
	const emptyLabel = config.emptyLabel ?? '(blank)';
	const out: NormalizedRow<T>[] = [];
	const skipped: { index: number; reason: string }[] = [];

	rows.forEach((row, index) => {
		let start = parseDateInput(config.start(row), zone);
		let end = parseDateInput(config.end(row), zone);
		if (!start || !end) {
			skipped.push({ index, reason: !start ? 'invalid start date' : 'invalid end date' });
			return;
		}
		if (end.toMillis() < start.toMillis()) [start, end] = [end, start];

		const path: string[] = [];
		const labels: string[] = [];
		for (const level of config.groupBy) {
			const raw = level.key(row);
			const key = raw === null || raw === undefined ? '' : String(raw);
			path.push(key);
			const label = level.label ? level.label(row) : key;
			labels.push(label === '' ? emptyLabel : label);
		}

		const values: Record<string, number | null> = {};
		for (const metric of metrics) values[metric.id] = readValue(metric, row);

		const mergeKey = config.bars?.mergeKey;
		out.push({
			row,
			index,
			id: config.rowId ? String(config.rowId(row)) : String(index),
			start,
			end,
			days: inclusiveDays(start, end),
			path,
			labels,
			mergeKey: mergeKey ? String(mergeKey(row)) : '',
			values,
		});
	});

	return { rows: out, skipped };
}
