import type { Session } from '../connection';
import type { PlayerTrack } from '../player';
import {
	browsePage,
	requestFilters,
	resolveItem,
	type Category,
	type BrowseItem,
	type BrowseFilters
} from './libraryBrowse';
import { prepareLibraryQueue, queueSizeCheck } from './libraryQueue';

export function shuffled<T>(values: T[]): T[] {
	const result = [...values];
	for (let i = result.length - 1; i > 0; i--) {
		const other = Math.floor(Math.random() * (i + 1));
		[result[i], result[other]] = [result[other], result[i]];
	}
	return result;
}

export function playbackFilter(
	category: Category,
	filters: BrowseFilters,
	row?: BrowseItem
): Record<string, string | number | undefined> | undefined {
	if (row) {
		if (row.localTracks) return;
		if (row.album?.localId) return { album_id: row.album.localId, sort: 'album', order: 'asc' };
		if (row.artist) return { artist_id: row.artist.id, sort: 'album', order: 'asc' };
		if (row.genre) return { genre: row.genre, sort: 'album', order: 'asc' };
		return;
	}
	if (category === 'Tracks') return requestFilters(filters);
	// An album/artist favorite or search applies to that entity, not its individual tracks.
	if (filters.q.trim() || filters.favorites || filters.rating || filters.formats.length) return;
	if (category === 'Genres') return { sort: 'album', order: 'asc' };
	if (category === 'Artists' && filters.sort === 'name')
		return { sort: 'artist', order: filters.order };
	if (category === 'Albums' && (filters.sort === 'name' || filters.sort === 'artist'))
		return { sort: filters.sort === 'name' ? 'album' : 'artist', order: filters.order };
}
export async function collectionTracks(
	session: Session,
	category: Category,
	filters: BrowseFilters,
	signal: AbortSignal,
	available: PlayerTrack[] | undefined,
	shuffle: boolean,
	progress: (done: number, total: number) => void
) {
	if (!available && category === 'Tracks') {
		return prepareLibraryQueue(
			session,
			{ ...requestFilters(filters), ...(shuffle ? { sort: 'random', order: 'asc' } : {}) },
			signal,
			progress
		);
	}
	if (!available && category === 'Genres' && !filters.q.trim()) {
		return prepareLibraryQueue(
			session,
			{ sort: shuffle ? 'random' : 'album', order: 'asc' },
			signal,
			progress
		);
	}
	const all: PlayerTrack[] = [],
		cursorHistory = new Set<string>(),
		ids = new Set<string>(),
		size = queueSizeCheck(session.serverUrl);
	let cursor: string | null = null;
	do {
		signal.throwIfAborted();
		const page = await browsePage(session, category, filters, cursor, signal, available);
		for (const item of page.items) {
			const group = await resolveItem(session, item, signal, true);
			signal.throwIfAborted();
			for (const track of group) {
				if (ids.has(track.id)) continue;
				ids.add(track.id);
				size(track);
				all.push(track);
			}
		}
		cursor = page.next ?? null;
		if (cursor && cursorHistory.has(cursor))
			throw Error('The collection changed while loading. Try again.');
		if (cursor) cursorHistory.add(cursor);
	} while (cursor);
	if (!all.length) throw Error('No playable tracks match these filters.');
	return shuffle ? shuffled(all) : all;
}
