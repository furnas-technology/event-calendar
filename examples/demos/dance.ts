import { createFiscalCalendar, type GroupInfo } from '../../src/index';
import competitions from '../data/dance-competitions.json';
import { defineDemo, earliest, shiftIso } from './types';

export interface DanceCompetition {
	id: string;
	name: string;
	venue: string;
	city: string;
	/** AU state or territory, or `Overseas / online`. */
	state: string;
	start: string;
	end: string;
	/** Base dance styles offered, e.g. `Jazz`, `Tap`. */
	styles: string[];
	/** Section types offered, e.g. `Standard`, `Championship`. */
	categories: string[];
	/** The one category this row stands for, when a preset shows a competition once per category. */
	category?: string;
}

const OVERSEAS = 'Overseas / online';
const NOT_LISTED = 'Not listed';
const categoryOrder = ['Standard', 'Championship', 'Improvisation', 'Scholarship', 'Dancers with Disabilities'];
const int = new Intl.NumberFormat('en-AU');
const day = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dates = (r: DanceCompetition) =>
	day.formatRange(new Date(`${r.start}T00:00:00Z`), new Date(`${r.end}T00:00:00Z`));
const list = (values: readonly string[]) => (values.length ? values.join(', ') : NOT_LISTED);

type Group = GroupInfo<DanceCompetition>;
const byCount = (a: Group, b: Group) =>
	(b.metrics.competitions ?? 0) - (a.metrics.competitions ?? 0) || a.label.localeCompare(b.label);
/** Largest first, with the catch-all group last. */
const byCountLast = (last: string) => (a: Group, b: Group) =>
	Number(a.key === last) - Number(b.key === last) || byCount(a, b);
const chronological = (a: Group, b: Group) =>
	earliest(a.rows, (r) => r.start).localeCompare(earliest(b.rows, (r) => r.start)) || a.label.localeCompare(b.label);
const categoryRank = (key: string) => {
	if (key === NOT_LISTED) return Number.POSITIVE_INFINITY;
	const i = categoryOrder.indexOf(key);
	return i < 0 ? categoryOrder.length : i;
};
const byCategory = (a: Group, b: Group) => categoryRank(a.key) - categoryRank(b.key) || a.label.localeCompare(b.label);

/** One row per category type, so a competition appears under each category it offers. */
const perCategory = (r: DanceCompetition): DanceCompetition[] =>
	(r.categories.length ? r.categories : [NOT_LISTED]).map((category) => ({
		...r,
		id: `${r.id}~${category}`,
		category,
	}));

const competitionLevel = { key: (r: DanceCompetition) => r.name, sort: chronological };

export const danceDemo = defineDemo<DanceCompetition>({
	id: 'dance',
	title: 'Dance competitions',
	summary:
		'Australian dance competitions and eisteddfods listed for 2026–2027, with where they are held, the base dance ' +
		'styles they offer and their category types (standard, championship, improvisation, scholarship, dancers with ' +
		'disabilities). Group by state, by city or by category type.',
	tips: [
		'Totals show the number of competitions and the average number of styles each offers.',
		'Group by "Category type › Competition" to see how many competitions run championships or scholarships — each ' +
			'competition appears under every category it offers, so there is no grand total.',
		'Hover a bar for the venue, the styles and the category types; turn on Editable and drag it to reschedule.',
	],
	source: {
		label: 'Australian dance-competition listings, snapshot October 2026 (deleted listings removed)',
		license: 'Furnas Technology',
	},
	rows: competitions as DanceCompetition[],
	config: {
		start: (r) => r.start,
		end: (r) => r.end,
		rowId: (r) => r.id,
		metrics: [
			{
				id: 'competitions',
				label: 'Competitions',
				value: () => 1,
				aggregate: 'count',
				allocate: 'start',
				format: (n) => int.format(n),
			},
			{
				id: 'styles',
				label: 'Avg styles',
				value: (r) => r.styles.length || null,
				aggregate: 'avg',
				allocate: 'active',
				format: (n) => n.toFixed(1),
			},
		],
		totals: { grand: true, metrics: ['competitions', 'styles'] },
		bars: {
			label: (bar) => {
				const r = bar.rows[0];
				if (!r) return [];
				return [r.name, `${r.styles.length} styles · ${list(r.categories)}`];
			},
		},
		tooltip: (bar) => {
			const r = bar.rows[0];
			if (!r) return null;
			const el = document.createElement('div');
			el.style.whiteSpace = 'normal';
			el.style.maxWidth = '360px';
			const line = (text: string, css = '') => {
				const div = document.createElement('div');
				div.style.cssText = css;
				div.textContent = text;
				return div;
			};
			const place = [r.venue, [r.city, r.state === OVERSEAS ? '' : r.state].filter(Boolean).join(' ')]
				.filter(Boolean)
				.join(' · ');
			el.append(
				line(r.name, 'font-weight:700'),
				line(`${place} · ${dates(r)}`),
				line(`Styles (${r.styles.length}): ${list(r.styles)}`, 'margin-top:4px'),
				line(`Categories: ${list(r.categories)}`),
			);
			return el;
		},
		calendar: 'gregorian',
		zone: 'Australia/Sydney',
		locale: 'en-AU',
		emptyLabel: '(no city)',
		view: { start: '2026-01-01', months: 3 },
	},
	presets: [
		{
			label: 'State › Competition',
			levels: ['State'],
			totalsDepth: 1,
			groupBy: [{ key: (r) => r.state, sort: byCountLast(OVERSEAS) }, competitionLevel],
		},
		{
			label: 'City › Competition',
			levels: ['City'],
			totalsDepth: 1,
			groupBy: [
				{
					key: (r) => (r.city ? `${r.city}|${r.state}` : ''),
					label: (r) => (!r.city || r.state === OVERSEAS ? r.city : `${r.city} (${r.state})`),
					sort: byCountLast(''),
				},
				competitionLevel,
			],
		},
		{
			label: 'Category type › Competition',
			levels: ['Category type'],
			totalsDepth: 1,
			expand: perCategory,
			grandTotal: false,
			groupBy: [{ key: (r) => r.category ?? NOT_LISTED, sort: byCategory }, competitionLevel],
		},
	],
	shift: (r, days) => ({ ...r, start: shiftIso(r.start, days), end: shiftIso(r.end, days) }),
	calendars: [
		{ label: 'Gregorian calendar', value: 'gregorian' },
		{ label: 'Australian FY (Jul–Jun)', value: createFiscalCalendar({ startMonth: 7, locale: 'en-AU' }) },
		{ label: 'Broadcast calendar', value: 'broadcast' },
	],
});
