import {
	type CalendarOption,
	type ControlsOptions,
	type GroupLevel,
	Timeline,
	type TimelineConfig,
} from '../../src/index';

/** One way of grouping a dataset, selectable from the toolbar. */
export interface DemoPreset<T> {
	label: string;
	/** Heading of each level, used to label the totals-depth options. */
	levels: string[];
	groupBy: GroupLevel<T>[];
	/** Initial sub-total depth for this preset (see `Timeline.setTotalsDepth`). */
	totalsDepth: number;
	/** Shows each row once per value of a multi-valued field, so it can be grouped by that field. */
	expand?: (row: T) => T[];
	/** `false` hides the grand total — use with `expand`, whose repeated rows a grand total would count twice. */
	grandTotal?: boolean;
}

export interface DemoDefinition<T> {
	id: string;
	title: string;
	summary: string;
	/** What to try in this demo. */
	tips: string[];
	/** Where the data comes from; `null` for synthetic data generated in the browser. */
	source: { label: string; url?: string; license: string } | null;
	rows: T[];
	config: Omit<TimelineConfig<T>, 'groupBy'>;
	presets: DemoPreset<T>[];
	/** Returns the row moved by `days`; enables the Editable toggle. */
	shift?: (row: T, days: number) => T;
	/** Calendar choices offered in the toolbar for this dataset. */
	calendars: { label: string; value: CalendarOption }[];
}

/** The part of a mounted demo the shared toolbar drives — no row type involved. */
export interface DemoHandle {
	/** The view controls (zoom, width, PNG, navigation) are built into the timeline; the shell only switches mode. */
	readonly timeline: Pick<Timeline<unknown>, 'setMode'>;
	readonly presets: readonly {
		label: string;
		levels: readonly string[];
		totalsDepth: number;
		grandTotal?: boolean;
	}[];
	readonly canEdit: boolean;
	applyPreset(index: number): void;
	/** `Timeline.setTotalsDepth`, keeping the grand total off for presets with `grandTotal: false`. */
	setTotalsDepth(depth: number | 'none'): void;
	setMerge(on: boolean): void;
	setEditable(on: boolean): void;
	setCalendar(index: number): void;
	setBarLines(lines: number): void;
	onLog(listener: (message: string) => void): void;
	destroy(): void;
}

export interface Demo {
	readonly id: string;
	readonly title: string;
	readonly summary: string;
	readonly tips: readonly string[];
	readonly source: DemoDefinition<unknown>['source'];
	readonly calendars: readonly { label: string }[];
	mount(host: HTMLElement): DemoHandle;
}

/** Every built-in view control; the timeline draws them as the second toolbar row. */
const viewControls: ControlsOptions = { zoom: true, width: true, savePng: true, navigation: true, months: true };

/** Wrap a typed demo so the shell can treat every dataset alike. */
export function defineDemo<T>(def: DemoDefinition<T>): Demo {
	return {
		id: def.id,
		title: def.title,
		summary: def.summary,
		tips: def.tips,
		source: def.source,
		calendars: def.calendars,
		mount(host) {
			let rows = def.rows;
			const firstPreset = def.presets[0];
			if (!firstPreset) throw new Error(`demo ${def.id} has no presets`);
			let preset = firstPreset;
			/** Displayed (possibly expanded) row → the source row it came from. */
			let origin = new Map<T, T>();
			const display = (): T[] => {
				origin = new Map();
				const expand = preset.expand;
				if (!expand) return rows;
				return rows.flatMap((row) => {
					const shown = expand(row);
					for (const s of shown) origin.set(s, row);
					return shown;
				});
			};
			const timeline = new Timeline<T>(
				host,
				{ controls: viewControls, ...def.config, groupBy: preset.groupBy },
				display(),
			);
			const setTotalsDepth = (depth: number | 'none') => {
				timeline.setTotalsDepth(depth);
				if (preset.grandTotal === false)
					timeline.setConfig({ totals: { ...timeline.getConfig().totals, grand: false } });
			};
			setTotalsDepth(preset.totalsDepth);
			const logListeners: ((message: string) => void)[] = [];
			const log = (message: string) => {
				for (const l of logListeners) l(message);
			};

			timeline.on('click', ({ bar }) =>
				log(
					`click  ${bar.groupLabels.join(' › ')}  ${bar.start.toISODate()} → ${bar.end.toISODate()}  (${bar.rows.length} row(s))`,
				),
			);

			const shift = def.shift;
			if (shift) {
				timeline.on('move', async ({ rows: moved, deltaDays }) => {
					await new Promise((resolve) => setTimeout(resolve, 120)); // pretend to save
					const ids = new Set(moved.map((r) => origin.get(r) ?? r));
					rows = rows.map((r) => (ids.has(r) ? shift(r, deltaDays) : r));
					timeline.setData(display());
					log(`move   ${ids.size} row(s) by ${deltaDays > 0 ? '+' : ''}${deltaDays} day(s)`);
					return true;
				});
			}

			return {
				timeline,
				presets: def.presets,
				canEdit: shift !== undefined,
				applyPreset(index) {
					const next = def.presets[index];
					if (!next) return;
					const reshape = next.expand !== preset.expand;
					preset = next;
					timeline.setConfig({ groupBy: next.groupBy });
					if (reshape) timeline.setData(display());
					setTotalsDepth(next.totalsDepth);
				},
				setTotalsDepth,
				setMerge(on) {
					timeline.setConfig({ bars: { ...timeline.getConfig().bars, mergeOverlapping: on } });
				},
				setEditable(on) {
					timeline.setConfig({ editable: on && shift !== undefined });
				},
				setCalendar(index) {
					const option = def.calendars[index];
					if (option) timeline.setConfig({ calendar: option.value });
				},
				setBarLines(lines) {
					timeline.setConfig({ theme: { barLines: lines } });
				},
				onLog(listener) {
					logListeners.push(listener);
				},
				destroy() {
					timeline.destroy();
				},
			};
		},
	};
}

/** Shift ISO date-only fields by whole days (demo helper). */
export function shiftIso(value: string, days: number): string {
	const d = new Date(`${value}T00:00:00Z`);
	return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Earliest ISO date among rows — for "chronological" group sorts. */
export function earliest<T>(rows: readonly T[], start: (row: T) => string): string {
	let min = '9999-12-31';
	for (const r of rows) if (start(r) < min) min = start(r);
	return min;
}
