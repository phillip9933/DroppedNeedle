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

export async function prepareLibraryQueue(
	session: Session,
	filters: Record<string, string | number | undefined>,
	signal: AbortSignal,
	onprogress: (loaded: number, total: number) => void
): Promise<PlayerTrack[]> {
	const tracks: PlayerTrack[] = [],
		ids = new Set<string>(),
		cursors = new Set<string>();
	const encoder = new TextEncoder();
	let after: string | undefined,
		total: number | undefined,
		bytes = 2;
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
		if (total > maxTracks) throw new Error(tooMany);
		const previous = tracks.length;
		for (const row of page.items) {
			if (!row.id) throw new Error(changed);
			if (ids.has(row.id)) continue;
			const track = localSong(row);
			// Android’s bridge returns the full queue with each playback snapshot.
			// Account for the absolute media URLs sent to the service.
			bytes +=
				encoder.encode(
					JSON.stringify({
						...track,
						streamUrl: session.serverUrl + track.streamUrl,
						artworkUrl: track.artworkUrl ? session.serverUrl + track.artworkUrl : undefined
					})
				).length + 1;
			if (bytes > maxBytes)
				throw new Error(
					'The track details exceed the mobile queue’s 1 MiB limit. Narrow your filters and try again.'
				);
			if (tracks.length >= maxTracks) throw new Error(tooMany);
			ids.add(row.id);
			tracks.push(track);
		}
		if (tracks.length > total) throw new Error(changed);
		after = page.next ?? undefined;
		if (after) {
			if (previous === tracks.length || cursors.has(after)) throw new Error(changed);
			cursors.add(after);
		}
		onprogress(tracks.length, total);
	} while (after);
	if (tracks.length !== total) throw new Error(changed);
	if (!tracks.length) throw new Error('No tracks match these filters.');
	return tracks;
}
