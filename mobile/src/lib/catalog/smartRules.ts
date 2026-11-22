import type { LibraryFilter } from '../boards/filteredSections';
import type { PlayerTrack } from '../player';
import { foldSearchText } from './trackFilters';
import type { TrackPage } from './libraryQueue';

export const maxSmartTracks = 10_000;
export type TrackRule = {
	field: 'genre' | 'year' | 'format' | 'query' | 'rating' | 'favorite' | 'plays' | 'lastPlayed';
	op: 'is' | 'isNot' | 'atLeast' | 'atMost' | 'contains' | 'olderThan' | 'within';
	value: string | number | boolean | string[];
};
export type RuleGroup = { match: 'all' | 'any'; rules: (RuleGroup | TrackRule)[] };
export type PlaylistFilters = LibraryFilter & {
	rules?: RuleGroup;
	genre?: string;
	yearFrom?: number;
	yearTo?: number;
	minPlays?: number;
	maxPlays?: number;
	notPlayedDays?: number;
};
export type PlayStat = NonNullable<TrackPage['play_stats']>[string];

export function playlistRules(p: PlaylistFilters): RuleGroup {
	if (p.rules) return p.rules;
	const rules: TrackRule[] = [];
	if (p.query) rules.push({ field: 'query', op: 'contains', value: p.query });
	if (p.favorites) rules.push({ field: 'favorite', op: 'is', value: true });
	if (p.rating)
		rules.push({
			field: 'rating',
			op: p.ratingMode === 'at_most' ? 'atMost' : 'atLeast',
			value: p.rating
		});
	if (p.formats.length)
		rules.push({
			field: 'format',
			op: p.formatMode === 'without' ? 'isNot' : 'is',
			value: p.formats
		});
	if (p.genre) rules.push({ field: 'genre', op: 'is', value: p.genre });
	if (p.yearFrom !== undefined) rules.push({ field: 'year', op: 'atLeast', value: p.yearFrom });
	if (p.yearTo !== undefined) rules.push({ field: 'year', op: 'atMost', value: p.yearTo });
	if (p.minPlays !== undefined) rules.push({ field: 'plays', op: 'atLeast', value: p.minPlays });
	if (p.maxPlays !== undefined) rules.push({ field: 'plays', op: 'atMost', value: p.maxPlays });
	if (p.notPlayedDays !== undefined)
		rules.push({ field: 'lastPlayed', op: 'olderThan', value: p.notPlayedDays });
	return { match: 'all', rules };
}

export function validRules(root: RuleGroup): RuleGroup {
	let count = 0;
	function visit(node: RuleGroup | TrackRule, depth: number): RuleGroup | TrackRule {
		if (!node || typeof node !== 'object' || ++count > 256 || depth > 8)
			throw Error('The playlist rules are invalid or too deeply nested.');
		if ('match' in node) {
			if (
				!['all', 'any'].includes(node.match) ||
				!Array.isArray(node.rules) ||
				(depth > 0 && !node.rules.length)
			)
				throw Error('Add a rule to each group.');
			return { match: node.match, rules: node.rules.map((r) => visit(r, depth + 1)) };
		}
		const { field, op, value } = node;
		const numeric = typeof value === 'number' && Number.isSafeInteger(value);
		const comparison = op === 'is' || op === 'atLeast' || op === 'atMost';
		switch (field) {
			case 'favorite':
				if (op === 'is' && typeof value === 'boolean') return { field, op, value };
				break;
			case 'query':
			case 'genre':
				if (
					(field === 'query' ? op === 'contains' : op === 'is' || op === 'isNot') &&
					typeof value === 'string' &&
					value.trim() &&
					value.trim().length <= (field === 'query' ? 150 : 160)
				)
					return { field, op, value: value.trim() };
				break;
			case 'format': {
				const values = Array.isArray(value) ? value : [value];
				if (
					(op === 'is' || op === 'isNot') &&
					values.length &&
					values.every((v) => typeof v === 'string' && /^[a-z0-9][\w.+-]{0,31}$/i.test(v))
				)
					return {
						field,
						op,
						value: [...new Set((values as string[]).map((v) => v.toLowerCase()))]
					};
				break;
			}
			case 'year':
				if (comparison && numeric && value >= 1 && value <= 9999) return { field, op, value };
				break;
			case 'rating':
				if (comparison && numeric && value >= 1 && value <= 5) return { field, op, value };
				break;
			case 'plays':
				if (comparison && numeric && value >= 0 && value <= 1_000_000) return { field, op, value };
				break;
			case 'lastPlayed':
				if ((op === 'olderThan' || op === 'within') && numeric && value >= 1 && value <= 36500)
					return { field, op, value };
				break;
		}
		throw Error('Choose a valid condition and value for each rule.');
	}
	if (!root || typeof root !== 'object' || !('match' in root))
		throw Error('Choose how to match playlist rules.');
	return visit(root, 0) as RuleGroup;
}

type Params = Record<string, string | number | undefined>;
export function planRules(root: RuleGroup) {
	const params: Params = {};
	const assured = new Set<TrackRule>();
	const leaves: TrackRule[] = [];
	const mandatory = new Set<TrackRule>();
	function visit(node: TrackRule | RuleGroup, required: boolean) {
		if ('match' in node) {
			for (const child of node.rules)
				visit(child, required && (node.match === 'all' || node.rules.length === 1));
			return;
		}
		leaves.push(node);
		if (!required) return;
		mandatory.add(node);
		const { field, op, value } = node;
		if (field === 'genre' && op === 'is' && !params.genre) params.genre = String(value);
		else if (field === 'favorite' && value === true) params.favorites = 'true';
		else if (field === 'query' && !params.q) params.q = String(value);
		else if (field === 'format' && !params.formats) {
			params.formats = (value as string[]).join(',');
			params.format_mode = op === 'isNot' ? 'without' : 'with';
		} else if (field === 'rating' && !params.rating) {
			params.rating = Number(value);
			params.rating_mode = op === 'atMost' || (op === 'is' && value === 1) ? 'at_most' : 'at_least';
			if (op === 'is' && value !== 1 && value !== 5) return;
		} else return;
		assured.add(node);
	}
	visit(root, true);
	// Each extra genre cursor must be a subset of the unfiltered-by-genre main cursor.
	if (params.genre && leaves.some((r) => r.field === 'genre' && !assured.has(r))) {
		delete params.genre;
		for (const r of assured) if (r.field === 'genre') assured.delete(r);
	}
	return { params, assured, leaves, mandatory };
}

export function matchesRules(root: RuleGroup, test: (rule: TrackRule) => boolean): boolean {
	const match = (r: RuleGroup | TrackRule): boolean =>
		'match' in r ? matchesRules(r, test) : test(r);
	return (
		!root.rules.length || (root.match === 'all' ? root.rules.every(match) : root.rules.some(match))
	);
}

export function trackMatches(
	rule: TrackRule,
	track: PlayerTrack,
	history: PlayStat | undefined,
	now: number,
	confirmed: boolean,
	knownGenres?: Set<string>
) {
	const { field, op, value } = rule;
	const equal = op !== 'isNot';
	switch (field) {
		case 'favorite':
			return track.favorite === undefined ? confirmed : track.favorite === value;
		case 'format':
			return track.format
				? (value as string[]).includes(track.format.toLowerCase()) === equal
				: confirmed;
		case 'query': {
			const text = [track.title, track.artist, track.album].map(foldSearchText);
			return foldSearchText(String(value))
				.split(/\s+/)
				.every((word) => text.some((s) => s.includes(word)));
		}
		case 'genre': {
			const needle = foldSearchText(String(value));
			if (knownGenres) return knownGenres.has(needle) === equal;
			if (!track.genre) return confirmed;
			const tags = [track.genre, ...track.genre.split(/[;|]/)];
			return tags.some((g) => foldSearchText(g.trim()) === needle) === equal;
		}
		case 'lastPlayed':
			if (!history) return false;
			if (history.play_count === 0) return op === 'olderThan';
			if (history.last_played == null) return false;
			return op === 'olderThan'
				? history.last_played <= now - Number(value) * 86400
				: history.last_played >= now - Number(value) * 86400;
		default: {
			const n =
				field === 'year' ? track.year : field === 'rating' ? track.rating : history?.play_count;
			if (n === undefined) return field === 'plays' ? false : confirmed;
			if (field === 'rating' && !n) return false;
			return op === 'atLeast'
				? n >= Number(value)
				: op === 'atMost'
					? n <= Number(value)
					: n === value;
		}
	}
}
