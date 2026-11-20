import type { Session } from '../connection';
import type { PlayerTrack } from '../player';
import {
	browsePage,
	defaultSort,
	type BrowseItem,
	type BrowseSnapshot,
	type Category
} from '../catalog/libraryBrowse';
import type { BrowseFilters } from '../catalog/trackFilters';
import type { FilterSection } from './filteredSections';
import type { Section } from './layout';

export function entityFilter(rule?: FilterSection) {
	return (
		!!rule &&
		rule.kind !== 'songs' &&
		(rule.favorites || rule.rating > 0 || rule.formats.length > 0)
	);
}

function confirmedKey(session: Session, rule: FilterSection) {
	return (
		'dn.mobile.shelf-matches.v1.' + JSON.stringify([session.serverUrl, session.userId, rule.id])
	);
}
function definition(rule: FilterSection) {
	const { kind, query, favorites, sort, rating, ratingMode, formats, formatMode } = rule;
	return JSON.stringify([kind, query, favorites, sort, rating, ratingMode, formats, formatMode]);
}
function confirmed(session: Session, rule: FilterSection): Set<string> {
	try {
		const saved = JSON.parse(localStorage.getItem(confirmedKey(session, rule)) ?? 'null');
		return new Set(
			saved?.definition === definition(rule) && Array.isArray(saved.ids) ? saved.ids : []
		);
	} catch {
		return new Set();
	}
}
// A song's stars and favorite flag do not describe its album or artist. Only keep
// entities actually returned by a matching DN rule for this listener.
export function recordShelfMatches(
	session: Session,
	rule: FilterSection,
	ids: string[],
	complete: boolean
) {
	if (!session.userId || !entityFilter(rule)) return;
	const matches = complete ? new Set<string>() : confirmed(session, rule);
	for (const id of ids) matches.add(id);
	try {
		localStorage.setItem(
			confirmedKey(session, rule),
			JSON.stringify({ definition: definition(rule), ids: [...matches] })
		);
	} catch {
		/* A full device can still browse the online shelf. */
	}
}

const categories: Record<string, Category> = {
	'library-albums': 'Albums',
	'library-artists': 'Artists',
	'library-tracks': 'Tracks',
	'library-playlists': 'Playlists',
	'library-recently-added': 'Albums',
	'library-genres': 'Genres'
};
export function shelfCategory(section: Section): Category {
	return section.filter
		? { songs: 'Tracks' as const, albums: 'Albums' as const, artists: 'Artists' as const }[
				section.filter.kind
			]
		: categories[section.id];
}
export async function shelfRows(
	session: Session,
	section: Section,
	tracks: PlayerTrack[] | undefined,
	signal: AbortSignal,
	progress?: (n: number, total: number) => void
): Promise<BrowseItem[]> {
	const category = shelfCategory(section),
		rule = section.filter,
		recent = section.id === 'library-recently-added';
	if (!category || (!tracks && category !== 'Genres')) return [];
	const sort = recent ? 'date_added' : (rule?.sort ?? defaultSort[category]),
		known = entityFilter(rule);
	const filters: BrowseFilters = {
		q: rule?.query ?? '',
		sort,
		order: ['album_count', 'date_added', 'year'].includes(sort) ? 'desc' : 'asc',
		favorites: !known && (rule?.favorites ?? false),
		rating: known ? 0 : (rule?.rating ?? 0),
		ratingMode: rule?.ratingMode ?? 'at_least',
		formats: known ? [] : (rule?.formats ?? []),
		formatMode: rule?.formatMode ?? 'with'
	};
	const snapshot: BrowseSnapshot = {};
	await browsePage(session, category, filters, null, signal, tracks, progress, snapshot);
	signal.throwIfAborted();
	const all = snapshot.items ?? [];
	if (known && rule) {
		const ids = confirmed(session, rule);
		return all.filter((item) => {
			const id = item.id.slice(category.length + 1);
			return (
				ids.has(id) &&
				item.localTracks?.some((track) =>
					category === 'Albums'
						? track.albumId === id
						: track.artistId === id || track.albumArtistId === id
				)
			);
		});
	}
	return recent ? all.filter((item) => (item.added ?? 0) > 0) : all;
}
