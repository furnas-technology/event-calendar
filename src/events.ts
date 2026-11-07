import type { CalendarDate } from './calendar/dates';
import type { Bar, EventCalendarLayout, ViewState } from './layout/types';

export interface BarClickEvent<T> {
	bar: Bar<T>;
	rows: readonly T[];
	nativeEvent: PointerEvent;
}

export interface BarHoverEvent<T> {
	/** `null` when the pointer left a bar. */
	bar: Bar<T> | null;
}

export interface BarMoveEvent<T> {
	bar: Bar<T>;
	rows: readonly T[];
	/** Whole days the bar was moved (negative = earlier). */
	deltaDays: number;
	newStart: CalendarDate;
	newEnd: CalendarDate;
}

/**
 * Handler signatures. A `move` handler accepts the move by returning (or resolving to) `true`; anything else, or a
 * rejection, reverts the bar. After accepting, update your data and call `setData` — the bar stays at its new
 * position until then.
 */
export interface EventCalendarEventMap<T> {
	click: (event: BarClickEvent<T>) => void;
	hover: (event: BarHoverEvent<T>) => void;
	move: (event: BarMoveEvent<T>) => boolean | Promise<boolean>;
	viewchange: (view: ViewState) => void;
	render: (event: { layout: EventCalendarLayout<T> }) => void;
}

export type Unsubscribe = () => void;

export class Emitter<M extends { [K in keyof M]: (...args: never[]) => unknown }> {
	private readonly handlers = new Map<keyof M, Set<M[keyof M]>>();

	on<K extends keyof M>(type: K, handler: M[K]): Unsubscribe {
		let set = this.handlers.get(type);
		if (!set) {
			set = new Set();
			this.handlers.set(type, set);
		}
		set.add(handler);
		return () => {
			set.delete(handler);
		};
	}

	listeners<K extends keyof M>(type: K): M[K][] {
		return [...(this.handlers.get(type) ?? [])] as M[K][];
	}

	emit<K extends keyof M>(type: K, ...args: Parameters<M[K]>): void {
		for (const handler of this.listeners(type)) {
			try {
				(handler as (...a: Parameters<M[K]>) => unknown)(...args);
			} catch (error) {
				console.error(`[event-calendar] "${String(type)}" handler threw`, error);
			}
		}
	}

	clear(): void {
		this.handlers.clear();
	}
}
