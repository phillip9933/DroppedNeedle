import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import type { PlayerTrack } from '../player';
import { DnError, getJson, mutateJson, postJson, type Session } from '../connection';
import { cover, path, playerTrack } from './catalog';
import { forgetPlaylist, rememberPlaylistList, rememberPlaylistTracks } from './playlistOffline';

type Schema = components['schemas'];
export type Playlist = Schema['PlaylistSummary'];

export async function playlists(session: Session, signal?: AbortSignal) {
	const list = await getJson<Schema['PlaylistListResponse']>(
		session,
		path('/api/v3/playlists'),
		signal
	);
	const visible = list.playlists.filter((p): p is Playlist => !p.is_redacted && 'name' in p);
	rememberPlaylistList(session, visible, playlistArtwork);
	return visible;
}

// Playlist imports may include an external artwork URL. Keep media on this DN server.
function localCover(raw?: string | null) {
	const album = raw?.match(/^\/api\/v3\/library\/albums\/([\w-]+)\/artwork(?:\?|$)/);
	if (album) return cover(null, album[1]);
	const group = raw?.match(/^\/api\/v3\/covers\/release-group\/([\w-]+)(?:\?|$)/);
	return group ? cover(group[1]) : undefined;
}

export function playlistArtwork(p: Playlist): string[] {
	if (p.custom_cover_url)
		return [path('/api/v3/playlists/{playlist_id}/cover', { playlist_id: p.id })];
	return [
		...new Set((p.cover_urls ?? []).map((url) => localCover(url)).filter((s): s is string => !!s))
	].slice(0, 4);
}
export function playlistCover(p: Playlist) {
	return playlistArtwork(p)[0];
}

export async function readPlaylist(session: Session, playlist: Playlist, signal?: AbortSignal) {
	const params = { playlist_id: playlist.id };
	const url = path('/api/v3/playlists/{playlist_id}', params);
	let detail = await getJson<Schema['PlaylistDetail']>(session, url, signal);
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
				detail = await getJson<Schema['PlaylistDetail']>(session, url, signal);
		} catch (cause) {
			signal?.throwIfAborted();
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
	if (!resolutionFailed) rememberPlaylistTracks(session, detail, tracks, playlistArtwork(detail));
	return { playlist: detail as Playlist, rows, tracks, resolutionFailed };
}

export function createPlaylist(session: Session, name: string) {
	return postJson<Schema['PlaylistDetail']>(session, path('/api/v3/playlists'), {
		name
	} satisfies Schema['CreatePlaylistBody']);
}

export function renamePlaylist(session: Session, id: string, name: string) {
	return mutateJson<Schema['PlaylistDetail']>(
		session,
		path('/api/v3/playlists/{playlist_id}', { playlist_id: id }),
		'PUT',
		{ name } satisfies Schema['UpdatePlaylistBody']
	);
}

export function addLocalTracks(session: Session, id: string, tracks: PlayerTrack[]) {
	return postJson<Schema['AddTracksResponse']>(
		session,
		path('/api/v3/playlists/{playlist_id}/tracks', { playlist_id: id }),
		{
			tracks: tracks.map((track) => ({
				track_name: track.title.trim() || 'Untitled track',
				artist_name: track.artist.trim() || 'Unknown artist',
				album_name: track.album.trim() || 'Unknown album',
				source_type: 'local',
				track_source_id: track.id,
				available_sources: ['local'],
				duration: track.duration,
				cover_url: localCover(track.artworkUrl)
			}))
		} satisfies Schema['AddTracksBody']
	);
}

export function movePlaylistEntry(session: Session, id: string, entry: string, position: number) {
	return mutateJson<Schema['ReorderResponse']>(
		session,
		path('/api/v3/playlists/{playlist_id}/tracks/reorder', { playlist_id: id }),
		'PATCH',
		{ track_id: entry, new_position: position } satisfies Schema['ReorderBody']
	);
}

export function removePlaylistEntry(session: Session, id: string, entry: string) {
	return mutateJson<Schema['StatusResponse']>(
		session,
		path('/api/v3/playlists/{playlist_id}/tracks/{track_id}', { playlist_id: id, track_id: entry }),
		'DELETE'
	);
}

export async function deletePlaylist(session: Session, id: string) {
	const result = await mutateJson<Schema['StatusResponse']>(
		session,
		path('/api/v3/playlists/{playlist_id}', { playlist_id: id }),
		'DELETE'
	);
	forgetPlaylist(session, id);
	return result;
}

export function playlistVisibility(session: Session, id: string, isPublic: boolean) {
	return mutateJson<Playlist>(
		session,
		path('/api/v3/playlists/{playlist_id}/visibility', { playlist_id: id }),
		'PATCH',
		{ is_public: isPublic } satisfies Schema['VisibilityBody']
	);
}

export type Member = Schema['PlaylistMember'];

export function playlistMembers(session: Session, id: string) {
	return getJson<Schema['MembersResponse']>(
		session,
		path('/api/v3/playlists/{playlist_id}/members', { playlist_id: id })
	);
}

export async function playlistPeople(session: Session, id: string) {
	const [members, directory, me] = await Promise.all([
		playlistMembers(session, id),
		getJson<Schema['UserDirectoryResponse']>(session, path('/api/v3/users/directory')),
		getJson<{ id: string }>(session, path('/api/v3/me'))
	]);
	return { members: members.members, users: directory.users.filter((user) => user.id !== me.id) };
}

export function sharePlaylist(session: Session, id: string, members: Member[]) {
	return mutateJson<Schema['MembersResponse']>(
		session,
		path('/api/v3/playlists/{playlist_id}/members', { playlist_id: id }),
		'PUT',
		{
			user_ids: members.map((member) => member.user_id),
			editor_ids: members.filter((member) => member.can_edit).map((member) => member.user_id)
		} satisfies Schema['MembersBody']
	);
}
