import { DateTime } from 'luxon';
import { createFiscalCalendar, type GroupInfo } from '../../src/index';
import competitions from '../data/dance-competitions.json';
import { organisationColours, organisationOf } from './danceOrganisations';
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

const ZONE = 'Australia/Sydney';
/** Competitions starting from the beginning of last month to the end of the month 11 months from now. */
const thisMonth = DateTime.now().setZone(ZONE).startOf('month');
const from = thisMonth.minus({ months: 1 }).toISODate() ?? '';
const until = thisMonth.plus({ months: 11 }).endOf('month').toISODate() ?? '';
const upcoming = (competitions as DanceCompetition[]).filter((r) => r.start >= from && r.start <= until);

/** Each organisation's competitions share a colour, assigned over every listing so it never changes. */
const colourOf = organisationColours((competitions as DanceCompetition[]).map((r) => r.name));
const organisationColour = (r: DanceCompetition | undefined) => (r ? colourOf(organisationOf(r.name)) : '#888888');

const OVERSEAS = 'Overseas / online';
const NOT_LISTED = 'Not listed';
const categoryOrder = ['Standard', 'Championship', 'Improvisation', 'Scholarship', 'Dancers with Disabilities'];
const int = new Intl.NumberFormat('en-AU');
const day = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dates = (r: DanceCompetition) =>
	day.formatRange(new Date(`${r.start}T00:00:00Z`), new Date(`${r.end}T00:00:00Z`));
const list = (values: readonly string[]) => (values.length ? values.join(', ') : NOT_LISTED);
/** Venue, city and state (no state for overseas / online listings). */
const address = (r: DanceCompetition) =>
	[r.venue, [r.city, r.state === OVERSEAS ? '' : r.state].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

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
const stateLevel = { key: (r: DanceCompetition) => r.state, sort: byCountLast(OVERSEAS) };

export const danceDemo = defineDemo<DanceCompetition>({
	id: 'dance',
	title: 'Dance competitions',
	summary:
		'Australian dance competitions and eisteddfods starting from last month to 11 months ahead, with where they are held, the base dance ' +
		'styles they offer and their category types (standard, championship, improvisation, scholarship, dancers with ' +
		'disabilities). Each organisation has its own colour. Group by state and organisation, by state, by city or by ' +
		'category type.',
	tips: [
		'Each organisation (read from the competition name) has its own colour, so its events stand out in any grouping.',
		'Only competitions running in the months in view are listed; totals show how many there are and the average ' +
			'number of styles each offers.',
		'Group by "Category type › Competition" to see how many competitions run championships or scholarships — each ' +
			'competition appears under every category it offers, so there is no grand total.',
		'Three months fill the width: scroll sideways (wheel, trackpad, swipe, or drag with the mouse) or use the arrows ' +
			'to move through the year ahead. The competition names stay fixed on screens at least 768px wide.',
		'Hover or tap a bar for the venue, the styles and the category types (a tap pins it; tap elsewhere to close); ' +
			'turn on Editable and drag it to reschedule.',
	],
	source: {
		label: 'Australian dance-competition listings, snapshot October 2026 (deleted listings removed)',
		license: 'Furnas Technology',
	},
	rows: upcoming,
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
			color: (bar) => organisationColour(bar.rows[0]),
			label: (bar) => {
				const r = bar.rows[0];
				if (!r) return [];
				return [r.name, address(r) || NOT_LISTED];
			},
		},
		tooltip: (bar) => {
			const r = bar.rows[0];
			if (!r) return null;
			const el = document.createElement('div');
			const line = (text: string, css = '') => {
				const div = document.createElement('div');
				div.style.cssText = css;
				div.textContent = text;
				return div;
			};
			el.append(
				line(r.name, 'font-weight:700'),
				line(organisationOf(r.name), `color:${organisationColour(r)};font-weight:600`),
				line([address(r), dates(r)].filter(Boolean).join(' · ')),
				line(`Styles (${r.styles.length}): ${list(r.styles)}`, 'margin-top:4px'),
				line(`Categories: ${list(r.categories)}`),
			);
			return el;
		},
		calendar: 'gregorian',
		zone: ZONE,
		locale: 'en-AU',
		emptyLabel: '(no city)',
		view: { months: 3 },
	},
	presets: [
		{
			label: 'State › Organisation',
			levels: ['State', 'Organisation'],
			totalsDepth: 1,
			groupBy: [stateLevel, { key: (r) => organisationOf(r.name), sort: 'asc' }],
		},
		{
			label: 'State › Competition',
			levels: ['State'],
			totalsDepth: 1,
			groupBy: [stateLevel, competitionLevel],
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
