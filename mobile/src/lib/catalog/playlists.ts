import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import type { PlayerTrack } from '../player';
import { DnError, getJson, postJson, type Session } from '../connection';
import { cover, path, playerTrack } from './catalog';

type Schema = components['schemas'];
export type Playlist = Schema['PlaylistSummary'];

export async function playlists(session: Session) {
	const list = await getJson<Schema['PlaylistListResponse']>(session, path('/api/v3/playlists'));
	return list.playlists.filter((p): p is Playlist => !p.is_redacted && 'name' in p);
}

// Playlist imports may include an external artwork URL. Keep media on this DN server.
function localCover(raw?: string | null) {
	const album = raw?.match(/^\/api\/v3\/library\/albums\/([\w-]+)\/artwork(?:\?|$)/);
	if (album) return cover(null, album[1]);
	const group = raw?.match(/^\/api\/v3\/covers\/release-group\/([\w-]+)(?:\?|$)/);
	return group ? cover(group[1]) : undefined;
}

export function playlistCover(p: Playlist) {
	if (p.custom_cover_url)
		return path('/api/v3/playlists/{playlist_id}/cover', { playlist_id: p.id });
	return p.cover_urls.map(localCover).find(Boolean);
}

export async function readPlaylist(session: Session, playlist: Playlist) {
	const params = { playlist_id: playlist.id };
	const url = path('/api/v3/playlists/{playlist_id}', params);
	let detail = await getJson<Schema['PlaylistDetail']>(session, url);
	const unresolved = detail.tracks.filter(
		(t) => !t.source_type && !t.library_file_id && t.album_id
	);
	let resolutionFailed = false;
	if (detail.is_owner && unresolved.length) {
		try {
			// DN links imported entries after the album arrives. The detail carries the new file IDs.
			const { sources } = await postJson<Schema['ResolveSourcesResponse']>(
				session,
				path('/api/v3/playlists/{playlist_id}/resolve-sources', params)
			);
			if (unresolved.some((t) => sources[t.id]?.includes('local')))
				detail = await getJson<Schema['PlaylistDetail']>(session, url);
		} catch (cause) {
			if (cause instanceof DnError && [401, 403, 404].includes(cause.status)) throw cause;
			resolutionFailed = true;
		}
	}
	const tracks: PlayerTrack[] = [];
	const rows = detail.tracks.map((entry) => {
		const file =
			entry.source_type === 'local'
				? entry.library_file_id || entry.track_source_id
				: entry.available_sources?.includes('local')
					? entry.library_file_id
					: null;
		const index = file ? tracks.length : null;
		if (file)
			tracks.push(
				playerTrack(
					file,
					entry.track_name,
					entry.artist_name,
					entry.album_name,
					localCover(entry.cover_url),
					entry.duration
				)
			);
		return { entry, index };
	});
	return { rows, tracks, resolutionFailed };
}
