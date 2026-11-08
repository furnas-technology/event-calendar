/**
 * The listings have no organiser field, so the organisation is read from the competition name: names follow
 * "ORGANISATION - City - Sections" loosely, and the aliases cover organisations whose listings are named inconsistently
 * (first match wins). With real data, use its organiser field instead.
 */
const aliases: readonly [RegExp, string][] = [
	[/^ADRENALINE?\b/i, 'Adrenalin Dance Competition'],
	[/^O+H LA LA\b/i, 'Ooh La La Dance Extravaganza'],
	[/^DANCE ?SPEC\b/i, 'DanceSpec'],
	[/^EBSDN\b/i, 'EBSDN'],
	[/^AUSTRALIAN CLASSICAL (GALA|GRAND PRIX)/i, 'Australian Classical Grand Prix'],
	[/^COMDANCE\b/i, 'Comdance Born to Perform'],
	[/^DANCE EXPLOSION\b/i, 'Dance Explosion Wollongong'],
	[/^HOLLYWOOD BOUND\b/i, 'Hollywood Bound'],
	[/^IN THE SPOTLIGHT\b/i, 'In the Spotlight'],
	[/^INSPIRE ART CHALLENGE\b/i, 'Inspire Art Challenge'],
	[/^RAISE THE BARRE\b/i, 'Raise the Barre Dance Festival'],
	[/^SPACE\b/i, 'SPACE (Sydney Performing Arts Competition)'],
	[/^SYDNEY WEST\b/i, 'Sydney West Dance Challenge'],
	[/^LIVE TO DANCE\b/i, 'Live to Dance Ultimate Challenge'],
	[/^LIVE, DREAM, DANCE\b/i, 'Live, Dream, Dance Eisteddfod'],
	[/^LAKESIDE DANCE\b/i, 'Lakeside Dance Challenge'],
	[/^ON CUE\b/i, 'On Cue National Eisteddfod'],
	[/^COFFS HARBOUR\b/i, 'Coffs Harbour and District Dance Eisteddfod'],
	[/^TRIPLE TURN\b/i, 'Triple Turn Dance Experience'],
	[/^FIERCE\b/i, 'FIERCE Talent Dance Competition'],
	[/^BPAC\b/i, 'BPAC'],
	[/^GOLD COAST EISTEDDFOD\b/i, 'Gold Coast Eisteddfod'],
	[/^EVOLUTION DANCE\b/i, 'Evolution Dance Competition'],
];

/** Words after the organisation's name that describe the event, not who runs it. */
const SECTIONS = /\s+(SOLOS?|TROUPES?|TROUPS|GROUPS?|DUOS?|Solo\b|Event\s|CUP|SCHOLARSHIPS?|FINAL|20\d\d).*$/i;
const ACRONYMS = new Set(['AICD', 'ATOD', 'AUS', 'BPAC', 'BYZE', 'CDO', 'EBSDN', 'IRBD', 'TPM', 'WIN', 'X']);
const SMALL = new Set(['and', 'of', 'to', 'the']);

function titleCase(text: string): string {
	return text
		.split(/\s+/)
		.map((word, i) => {
			const lower = word.toLowerCase();
			if (ACRONYMS.has(word.toUpperCase())) return word.toUpperCase();
			if (i > 0 && SMALL.has(lower)) return lower;
			return lower.charAt(0).toUpperCase() + lower.slice(1);
		})
		.join(' ');
}

/** The organisation that runs a competition, from its name. */
export function organisationOf(name: string): string {
	for (const [pattern, organisation] of aliases) if (pattern.test(name)) return organisation;
	const first = name.replace(/[–—]/g, '-').split(/\s+-\s*|\s*-\s+|\/\s|\s\(|,/)[0] ?? name;
	return titleCase(first.replace(SECTIONS, '').trim() || first.trim());
}

/**
 * A distinct colour per organisation: hues a golden angle apart, in three lightness bands so neighbours differ in
 * lightness too. Assigned in alphabetical order over every listing, so an organisation keeps its colour whatever is
 * filtered, grouped or scrolled into view.
 */
export function organisationColours(names: readonly string[]): (organisation: string) => string {
	const organisations = [...new Set(names.map(organisationOf))].sort((a, b) => a.localeCompare(b));
	const colours = new Map(
		organisations.map((organisation, i) => {
			const hue = (i * 137.508) % 360;
			const lightness = [52, 38, 66][i % 3] ?? 52;
			const saturation = [68, 60, 72][Math.floor(i / 3) % 3] ?? 68;
			return [organisation, hslToHex(hue, saturation, lightness)] as const;
		}),
	);
	return (organisation) => colours.get(organisation) ?? '#888888';
}

function hslToHex(h: number, s: number, l: number): string {
	const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
	const channel = (n: number) => {
		const k = (n + h / 30) % 12;
		const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(value * 255)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${channel(0)}${channel(8)}${channel(4)}`;
}
