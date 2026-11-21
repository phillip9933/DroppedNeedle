import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, postJson, apiAddress, type Session } from '../connection';
import { localSong, path, radioSong } from '../catalog/catalog';
import { validLocalFileId } from '../offline/tracks';
import type { PlayerTrack } from '../player';

type Schema = components['schemas'];
const mbid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const valid = (value: string | null | undefined) =>
	value && mbid.test(value) ? value.toLowerCase() : undefined;

export type HeardTrack = Pick<PlayerTrack, 'id' | 'recordingMbid'>;
export async function similarTracks(
	session: Session,
	tracks: PlayerTrack[],
	signal: AbortSignal,
	history: HeardTrack[] = []
) {
	const recent = tracks.slice(-25).reverse();
	let last = recent[0];
	if (!recent.some((t) => valid(t.artistMbid)) && !valid(last.releaseGroupMbid) && !last.genre) {
		const page = await getJson<{ items: Schema['TrackView'][] }>(
			session,
			path(
				'/api/v3/library/tracks',
				{},
				{
					q: last.title,
					album_id: last.albumId || undefined,
					artist_id: last.albumId ? undefined : last.artistId,
					limit: 100
				}
			),
			signal
		);
		const row = page.items.find((t) => t.id === last.id);
		if (row) recent[0] = last = localSong(row);
	}
	const items = recent.flatMap((t) => {
		const artist = valid(t.artistMbid);
		return artist
			? [
					{
						artist_mbid: artist,
						artist_name: t.artist,
						album_mbid: valid(t.releaseGroupMbid),
						album_name: t.album
					}
				]
			: [];
	});
	const group = valid(last.releaseGroupMbid);
	if (!items.length && !group && !last.genre)
		throw Error(
			'This queue has no artist, album or genre that DroppedNeedle can use for autoplay.'
		);
	const recordings = new Set(
		[...history, ...tracks, last].map((t) => valid(t.recordingMbid)).filter((v): v is string => !!v)
	);
	const files = new Set([...history, ...tracks].map((t) => t.id));
	const plan = await postJson<Schema['RadioPlanResponse']>(
		session,
		path('/api/v3/discover/radio/plan'),
		{
			seed_type: items.length ? 'items' : group ? 'album' : 'genre',
			items,
			seed_id: items.length ? undefined : group || last.genre,
			mode: 'library',
			count: 25,
			exclude_recording_mbids: [...recordings].slice(-500)
		} satisfies Schema['RadioPlanRequest'],
		signal
	);
	const next: PlayerTrack[] = [];
	for (const t of plan.tracks) {
		const id = t.local_file_id,
			recording = valid(t.recording_mbid);
		if (
			!t.in_library ||
			!validLocalFileId(id) ||
			files.has(id) ||
			(recording && recordings.has(recording))
		)
			continue;
		files.add(id);
		if (recording) recordings.add(recording);
		const item = radioSong(t, id);
		next.push({
			...item,
			streamUrl: apiAddress(session.serverUrl, item.streamUrl),
			artworkUrl: item.artworkUrl && apiAddress(session.serverUrl, item.artworkUrl)
		});
		if (next.length === 25) break;
	}
	if (!next.length) throw Error('DroppedNeedle found no new library tracks for this queue.');
	return next;
}
