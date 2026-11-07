import { DateTime } from 'luxon';

/**
 * Anything the event calendar accepts as a date.
 *
 * - `string` — ISO 8601. Date-only strings (`2024-03-01`) are taken literally. Strings with a time and offset are
 *   converted to {@link EventCalendarConfig.zone} before the calendar date is read.
 * - `Date` / `number` (epoch ms) — read in {@link EventCalendarConfig.zone} (default: the system zone).
 * - `DateTime` — its own calendar date is used (`year`/`month`/`day` in whatever zone it carries).
 */
export type DateInput = DateTime | Date | string | number;

const MS_PER_DAY = 86_400_000;

/**
 * Internally every date is a *calendar date*: a Luxon `DateTime` at 00:00 UTC. Day arithmetic on these is exact
 * (no DST gaps), and comparison is a plain number comparison.
 */
export type CalendarDate = DateTime;

/** Build a calendar date from year/month/day. */
export function calendarDate(year: number, month: number, day: number): CalendarDate {
	return DateTime.utc(year, month, day);
}

/** Strip time and zone from a DateTime, keeping its own year/month/day. */
export function toCalendarDate(dt: DateTime): CalendarDate {
	return DateTime.utc(dt.year, dt.month, dt.day);
}

/**
 * Convert a {@link DateInput} into a calendar date. Returns `null` for unparseable input.
 */
export function parseDateInput(input: DateInput, zone: string): CalendarDate | null {
	let dt: DateTime;
	if (DateTime.isDateTime(input)) {
		dt = input;
	} else if (input instanceof Date) {
		dt = DateTime.fromJSDate(input, { zone });
	} else if (typeof input === 'number') {
		dt = DateTime.fromMillis(input, { zone });
	} else if (typeof input === 'string') {
		const trimmed = input.trim();
		// Date-only strings are calendar dates already; never shift them through a zone.
		dt = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
			? DateTime.fromISO(trimmed, { zone: 'utc' })
			: DateTime.fromISO(trimmed, { setZone: true }).setZone(zone);
	} else {
		return null;
	}
	return dt.isValid ? toCalendarDate(dt) : null;
}

/** Integer day number (days since 1970-01-01) of a calendar date. */
export function dayNumber(date: CalendarDate): number {
	return Math.round(date.toMillis() / MS_PER_DAY);
}

/** Calendar date from a day number. */
export function fromDayNumber(day: number): CalendarDate {
	return DateTime.fromMillis(day * MS_PER_DAY, { zone: 'utc' });
}

/** Number of days from `a` to `b` (negative when `b` is earlier). */
export function diffDays(a: CalendarDate, b: CalendarDate): number {
	return dayNumber(b) - dayNumber(a);
}

/** Inclusive day count of the range `[start, end]`. */
export function inclusiveDays(start: CalendarDate, end: CalendarDate): number {
	return Math.abs(diffDays(start, end)) + 1;
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
	return fromDayNumber(dayNumber(date) + days);
}

export function minDate(a: CalendarDate, b: CalendarDate): CalendarDate {
	return dayNumber(a) <= dayNumber(b) ? a : b;
}

export function maxDate(a: CalendarDate, b: CalendarDate): CalendarDate {
	return dayNumber(a) >= dayNumber(b) ? a : b;
}

/** Today's calendar date in `zone`. */
export function today(zone: string): CalendarDate {
	return toCalendarDate(DateTime.now().setZone(zone));
}
