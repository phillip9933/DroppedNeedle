import type { Session } from '../connection';
import type { OfflineInventory } from '../offline/library';
import type { OfflineOrigin } from '../offline/tracks';
import type { BrowseItem } from './libraryBrowse';
import { offlinePlaylists } from './playlistOffline';

export const originLabels = {
	downloaded: 'Downloaded',
	automatic: 'Automatically saved',
	cached: 'Playback cache'
} as const;
const fold = (s: string | undefined) => s?.trim().toLocaleLowerCase() ?? '';
const albumName = (album?: string, artist?: string) =>
	'album-name:' + JSON.stringify([fold(album), fold(artist)]);

export function originIndex(session: Session, data?: OfflineInventory) {
	const index = new Map<string, Set<OfflineOrigin>>();
	function add(key: string, origin: OfflineOrigin) {
		const origins = index.get(key) ?? new Set<OfflineOrigin>();
		origins.add(origin);
		index.set(key, origins);
	}
	if (!data) return index;
	for (const { track, origin } of data.items) {
		add('track:' + track.id, origin);
		if (track.albumId) add('album:' + track.albumId, origin);
		else add(albumName(track.album, track.albumArtist || track.artist), origin);
		for (const [id, name] of [
			[track.artistId, track.artist],
			[track.albumArtistId, track.albumArtist]
		]) {
			if (id) add('artist:' + id, origin);
			else if (name && !(track.artistId && fold(name) === fold(track.artist)))
				add('artist-name:' + fold(name), origin);
		}
		add('genre:' + fold(track.genre), origin);
	}
	for (const p of offlinePlaylists(
		session,
		data.items.map((i) => i.track)
	)) {
		for (const t of p.localTracks) add(p.id, data.byId.get(t.id)!.origin);
	}
	return index;
}
export function itemOrigins(row: BrowseItem, index: Map<string, Set<OfflineOrigin>>) {
	const found = new Set(index.get(row.track ? 'track:' + row.track.id : row.id));
	if (row.genre !== undefined)
		for (const o of index.get('genre:' + fold(row.genre)) ?? []) found.add(o);
	if (row.album)
		for (const o of index.get(albumName(row.title, row.album.artist)) ?? []) found.add(o);
	if (row.artist) for (const o of index.get('artist-name:' + fold(row.title)) ?? []) found.add(o);
	for (const t of row.localTracks ?? [])
		for (const o of index.get('track:' + t.id) ?? []) found.add(o);
	return (Object.keys(originLabels) as OfflineOrigin[]).filter((o) => found.has(o));
}
