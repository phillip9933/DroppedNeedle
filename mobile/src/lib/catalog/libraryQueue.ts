import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, type Session } from '../connection';
import type { PlayerTrack } from '../player';
import { localSong, path } from './catalog';

export type TrackPage = components['schemas']['TrackListPage'];
const pageSize = 200;
export const maxQueueTracks = 2000;
const maxBytes = 1024 * 1024;
const changed = 'The track list changed while loading. Try again.';
const tooMany = 'Narrow your filters to 2,000 tracks or fewer to play this selection.';

export function queueSizeCheck(server: string) {
	const encoder = new TextEncoder();
	let bytes = 2;
	let count = 0;
	return (track: PlayerTrack) => {
		if (++count > maxQueueTracks) throw new Error(tooMany);
		// Android’s bridge returns the full queue with each playback snapshot, including absolute media URLs.
		bytes +=
			encoder.encode(
				JSON.stringify({
					...track,
					streamUrl: track.streamUrl.startsWith('https://')
						? track.streamUrl
						: server + track.streamUrl,
					artworkUrl:
						track.artworkUrl && !track.artworkUrl.startsWith('https://')
							? server + track.artworkUrl
							: track.artworkUrl
				})
			).length + 1;
		if (bytes > maxBytes)
			throw new Error(
				'The track details exceed the mobile queue’s 1 MiB limit. Narrow your filters and try again.'
			);
	};
}

/** Cursor pages in DN's sort order, with duplicate rows removed and list changes detected. */
export async function* trackPages(
	session: Session,
	filters: Record<string, string | number | undefined>,
	signal: AbortSignal,
	limit = pageSize,
	first?: TrackPage
): AsyncGenerator<TrackPage> {
	const ids = new Set<string>(),
		cursors = new Set<string>();
	let after: string | undefined, total: number | undefined;
	do {
		signal.throwIfAborted();
		const page: TrackPage =
			first ??
			(await getJson(
				session,
				path('/api/v3/library/tracks', {}, { ...filters, limit, after }),
				signal
			));
		first = undefined;
		signal.throwIfAborted();
		if (
			!Number.isSafeInteger(page.total) ||
			page.total < 0 ||
			(total !== undefined && total !== page.total)
		)
			throw Error(changed);
		total = page.total;
		const items = page.items.filter((row) => {
			if (!row.id) throw Error(changed);
			if (ids.has(row.id)) return false;
			ids.add(row.id);
			return true;
		});
		if (ids.size > total) throw Error(changed);
		yield { ...page, items };
		after = page.next ?? undefined;
		if (after) {
			if (!items.length || cursors.has(after)) throw Error(changed);
			cursors.add(after);
		}
	} while (after);
	if (ids.size !== total) throw Error(changed);
}

export async function prepareLibraryQueue(
	session: Session,
	filters: Record<string, string | number | undefined>,
	signal: AbortSignal,
	onprogress?: (loaded: number, total: number) => void,
	forQueue = true,
	first?: TrackPage
): Promise<PlayerTrack[]> {
	const tracks: PlayerTrack[] = [];
	const checkSize = forQueue ? queueSizeCheck(session.serverUrl) : undefined;
	for await (const page of trackPages(session, filters, signal, pageSize, first)) {
		if (forQueue && page.total > maxQueueTracks) throw Error(tooMany);
		for (const row of page.items) {
			const track = localSong(row);
			checkSize?.(track);
			tracks.push(track);
		}
		onprogress?.(tracks.length, page.total);
	}
	if (!tracks.length) throw Error('No tracks match these filters.');
	return tracks;
}
