import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, type Session } from '../connection';
import type { PlayerTrack } from '../player';
import { localSong, path } from './catalog';

type TrackPage = components['schemas']['TrackListPage'];
const pageSize = 200;
const maxTracks = 2000;
const maxBytes = 1024 * 1024;
const changed = 'The track list changed while loading. Try again.';
const tooMany = 'Narrow your filters to 2,000 tracks or fewer to play this selection.';

export function queueSizeCheck(server: string) {
	const encoder = new TextEncoder();
	let bytes = 2;
	let count = 0;
	return (track: PlayerTrack) => {
		if (++count > maxTracks) throw new Error(tooMany);
		// Android’s bridge returns the full queue with each playback snapshot, including absolute media URLs.
		bytes +=
			encoder.encode(
				JSON.stringify({
					...track,
					streamUrl: server + track.streamUrl,
					artworkUrl: track.artworkUrl ? server + track.artworkUrl : undefined
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
	forQueue = true
): Promise<PlayerTrack[]> {
	const tracks: PlayerTrack[] = [],
		ids = new Set<string>(),
		cursors = new Set<string>();
	const checkSize = forQueue ? queueSizeCheck(session.serverUrl) : undefined;
	let after: string | undefined, total: number | undefined;
	do {
		signal.throwIfAborted();
		const page: TrackPage = await getJson(
			session,
			path(
				'/api/v3/library/tracks',
				{},
				{
					...filters,
					limit: pageSize,
					after
				}
			),
			signal
		);
		signal.throwIfAborted();
		if (
			!Number.isSafeInteger(page.total) ||
			page.total < 0 ||
			(total !== undefined && total !== page.total)
		)
			throw new Error(changed);
		total = page.total;
		if (forQueue && total > maxTracks) throw new Error(tooMany);
		const previous = tracks.length;
		for (const row of page.items) {
			if (!row.id) throw new Error(changed);
			if (ids.has(row.id)) continue;
			const track = localSong(row);
			checkSize?.(track);
			ids.add(row.id);
			tracks.push(track);
		}
		if (tracks.length > total) throw new Error(changed);
		after = page.next ?? undefined;
		if (after) {
			if (previous === tracks.length || cursors.has(after)) throw new Error(changed);
			cursors.add(after);
		}
		onprogress?.(tracks.length, total);
	} while (after);
	if (tracks.length !== total) throw new Error(changed);
	if (!tracks.length) throw new Error('No tracks match these filters.');
	return tracks;
}
