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

export async function prepareLibraryQueue(
	session: Session,
	filters: Record<string, string | number | undefined>,
	signal: AbortSignal,
	onprogress?: (loaded: number, total: number) => void,
	forQueue = true,
	playlist?: {
		limit: number;
		matches?: (row: TrackPage['items'][number], page: TrackPage) => boolean;
	},
	first?: TrackPage
): Promise<PlayerTrack[]> {
	if (
		playlist &&
		(!Number.isInteger(playlist.limit) || playlist.limit < 1 || playlist.limit > maxQueueTracks)
	)
		throw new Error('Choose a playlist limit between 1 and 2,000 tracks.');
	const tracks: PlayerTrack[] = [],
		ids = new Set<string>(),
		cursors = new Set<string>();
	const checkSize = forQueue ? queueSizeCheck(session.serverUrl) : undefined;
	let after: string | undefined, total: number | undefined;
	do {
		signal.throwIfAborted();
		const page: TrackPage =
			first ??
			(await getJson(
				session,
				path(
					'/api/v3/library/tracks',
					{},
					{
						...filters,
						limit:
							playlist && !playlist.matches
								? Math.min(pageSize, playlist.limit - tracks.length)
								: pageSize,
						after
					}
				),
				signal
			));
		first = undefined;
		signal.throwIfAborted();
		if (
			!Number.isSafeInteger(page.total) ||
			page.total < 0 ||
			(total !== undefined && total !== page.total)
		)
			throw new Error(changed);
		total = page.total;
		const target = playlist ? Math.min(total, playlist.limit) : total;
		if (forQueue && target > maxQueueTracks) throw new Error(tooMany);
		const previous = ids.size;
		for (const row of page.items) {
			if (!row.id) throw new Error(changed);
			if (ids.has(row.id)) continue;
			ids.add(row.id);
			if (playlist?.matches && !playlist.matches(row, page)) continue;
			const track = localSong(row);
			checkSize?.(track);
			tracks.push(track);
			if (playlist && tracks.length === target) break;
		}
		if (ids.size > total) throw new Error(changed);
		after = playlist && tracks.length === target ? undefined : (page.next ?? undefined);
		if (after) {
			if (previous === ids.size || cursors.has(after)) throw new Error(changed);
			cursors.add(after);
		}
		onprogress?.(tracks.length, target);
	} while (after);
	if (ids.size !== total && !(playlist && tracks.length === playlist.limit))
		throw new Error(changed);
	if (!playlist && !tracks.length) throw new Error('No tracks match these filters.');
	return tracks;
}
