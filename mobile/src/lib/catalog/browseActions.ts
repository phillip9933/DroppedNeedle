import type { Session } from '../connection';
import type { PlayerTrack } from '../player';
import type { OnPlay } from './catalog';
import {
	browsePage,
	requestFilters,
	resolveItem,
	type Category,
	type BrowseItem,
	type BrowseFilters
} from './libraryBrowse';
import { prepareLibraryQueue, queueSizeCheck } from './libraryQueue';
import { shuffled } from '../player/shuffle';

export { shuffled };

export function beginPlaybackPreparation(cancel: () => void) {
	window.dispatchEvent(new Event('dn-playback-intent'));
	const interrupt = () => cancel();
	window.addEventListener('dn-playback-intent', interrupt);
	return () => window.removeEventListener('dn-playback-intent', interrupt);
}

export function playlistShuffle() {
	let revision = 0;
	const cancel = () => revision++;
	return {
		cancel,
		async play(tracks: PlayerTrack[], session: Session, onplay: OnPlay) {
			const finish = beginPlaybackPreparation(cancel);
			const current = ++revision;
			try {
				const order = await shuffled(tracks, session);
				if (revision !== current) return;
				finish();
				await onplay(order, 0);
			} catch (cause) {
				if (revision === current) throw cause;
			} finally {
				finish();
			}
		}
	};
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
	if (!available && (category === 'Tracks' || (category === 'Genres' && !filters.q.trim()))) {
		const query = category === 'Tracks' ? requestFilters(filters) : { sort: 'album', order: 'asc' };
		const tracks = await prepareLibraryQueue(
			session,
			shuffle ? { ...query, sort: 'random', order: 'asc' } : query,
			signal,
			progress
		);
		const order = shuffle ? await shuffled(tracks, session, 'server') : tracks;
		signal.throwIfAborted();
		return order;
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
	const order = shuffle ? await shuffled(all, session) : all;
	signal.throwIfAborted();
	return order;
}
