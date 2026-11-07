import { type CalendarDate, dayNumber, minDate } from '../calendar/dates';
import { monthsBetweenInclusive, shiftPeriod } from '../calendar/periods';
import type { Period, TimeCalendar } from '../calendar/types';
import type { ViewMode } from '../config';
import { clamp } from '../render/theme';

/** Navigation state the host controls (via the `EventCalendar` API). */
export interface ViewRequest {
	mode: ViewMode;
	/** Requested first visible date; snapped to its month and clamped to the data. `null` = first data month. */
	start: CalendarDate | null;
	/** Requested visible months; `null` = all. */
	months: number | null;
}

export interface ResolvedView {
	mode: ViewMode;
	start: CalendarDate;
	end: CalendarDate;
	months: Period[];
	offset: number;
	totalMonths: number;
	firstDataMonth: Period;
	lastDataMonth: Period;
}

/** Resolve the visible window for continuous mode, clamped so it never leaves the data's months. */
export function resolveContinuousView(
	request: ViewRequest,
	dataStart: CalendarDate,
	dataEnd: CalendarDate,
	calendar: TimeCalendar,
): ResolvedView {
	const firstDataMonth = calendar.monthOf(dataStart);
	const lastDataMonth = calendar.monthOf(dataEnd);
	const totalMonths = monthsBetweenInclusive(calendar, dataStart, dataEnd);
	const length = clamp(Math.round(request.months ?? totalMonths), 1, totalMonths);

	let offset = 0;
	if (request.start) {
		const requested = calendar.monthOf(request.start);
		offset = (requested.year - firstDataMonth.year) * 12 + (requested.number - firstDataMonth.number);
	}
	offset = clamp(offset, 0, totalMonths - length);

	const months: Period[] = [];
	let month = shiftPeriod(calendar, firstDataMonth, offset);
	for (let i = 0; i < length; i++) {
		months.push(month);
		month = shiftPeriod(calendar, month, 1);
	}
	const first = months[0] as Period;
	const last = months[months.length - 1] as Period;
	return {
		mode: 'continuous',
		start: first.start,
		end: last.end,
		months,
		offset,
		totalMonths,
		firstDataMonth,
		lastDataMonth,
	};
}

/** Maps calendar dates to x positions. */
export interface XScale {
	/** Left edge of the day. */
	left(date: CalendarDate): number;
	/** Right edge of the day. */
	right(date: CalendarDate): number;
	/** Half-open interval for lane packing, in axis units. */
	interval(start: CalendarDate, end: CalendarDate): { lo: number; hi: number };
	readonly dayWidth: number;
}

export function continuousScale(view: ResolvedView, gridX: number, gridWidth: number): XScale {
	const startDay = dayNumber(view.start);
	const days = dayNumber(view.end) - startDay + 1;
	const dayWidth = gridWidth / days;
	return {
		dayWidth,
		left: (date) => gridX + (dayNumber(date) - startDay) * dayWidth,
		right: (date) => gridX + (dayNumber(date) - startDay + 1) * dayWidth,
		interval: (start, end) => ({ lo: dayNumber(start), hi: dayNumber(end) + 1 }),
	};
}

/**
 * Year-over-year scale: twelve equal month columns; a date is placed proportionally within its (broadcast) month, so
 * every year lines up month-for-month (the original `getMonthDayWidth`/`getYOYPosX`).
 */
export function yoyScale(calendar: TimeCalendar, gridX: number, gridWidth: number): XScale {
	const monthWidth = gridWidth / 12;
	const position = (date: CalendarDate, edge: 0 | 1): number => {
		const month = calendar.monthOf(date);
		const dayIndex = dayNumber(date) - dayNumber(month.start) + edge;
		return month.number - 1 + dayIndex / month.days;
	};
	return {
		dayWidth: 0,
		left: (date) => gridX + position(date, 0) * monthWidth,
		right: (date) => gridX + position(date, 1) * monthWidth,
		interval: (start, end) => ({ lo: position(start, 0), hi: position(end, 1) }),
	};
}

/** In YoY mode a bar is drawn within its own year; clip its end to that year. */
export function clipToYear(calendar: TimeCalendar, start: CalendarDate, end: CalendarDate): CalendarDate {
	return minDate(end, calendar.yearOf(start).end);
}
