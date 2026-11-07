import type { CalendarDate } from './dates';

export type PeriodUnit = 'week' | 'month' | 'year';

/** A week, month or year in a {@link TimeCalendar}. `start` and `end` are inclusive calendar dates. */
export interface Period {
	readonly unit: PeriodUnit;
	readonly start: CalendarDate;
	readonly end: CalendarDate;
	/** Stable unique key, e.g. `month:2024-02-26`. */
	readonly key: string;
	/** The (fiscal/broadcast) year this period belongs to. */
	readonly year: number;
	/**
	 * Position of the period in its parent:
	 * - month: position within `year`, 1–12 (for a fiscal year starting in October, October is 1). The pair
	 *   `(year, number)` must increase by exactly one month from each month to the next — navigation and the
	 *   year-over-year axis rely on it
	 * - week: week of month, 1–6 (broadcast); ISO week number (Gregorian)
	 * - year: same as `year`
	 */
	readonly number: number;
	/** Short display label: `Mar`, `2024`, week label. */
	readonly label: string;
	/** Inclusive number of days. */
	readonly days: number;
}

/**
 * A calendar that can divide time into weeks, months and years. Implement this to plug in a retail (4-4-5) or
 * fiscal calendar. Every method receives and returns calendar dates (see {@link CalendarDate}).
 *
 * Invariants the event calendar relies on:
 * - periods of one unit tile time without gaps or overlaps
 * - every month starts on a week start and ends on a week end (not required by Gregorian, see `weeksAlignToMonths`)
 */
export interface TimeCalendar {
	readonly id: string;
	/** True when every month boundary is also a week boundary (broadcast-style calendars). */
	readonly weeksAlignToMonths: boolean;
	weekOf(date: CalendarDate): Period;
	monthOf(date: CalendarDate): Period;
	yearOf(date: CalendarDate): Period;
	/** Label for a month `number` 1–12 as defined by `monthOf` (used by the year-over-year axis). */
	monthLabel(monthNumber: number): string;
}
