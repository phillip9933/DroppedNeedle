import type { Session } from '../connection';
import type { PlayerTrack } from '../player';
import type { Playlist } from './playlists';
type RecordValue = { id: string; name: string; covers: string[]; ids?: string[] };
function key(session: Session) {
	return session.userId
		? 'dn.mobile.offline-playlists.v1.' + JSON.stringify([session.serverUrl, session.userId])
		: null;
}
function read(key: string): RecordValue[] {
	try {
		const value = JSON.parse(localStorage.getItem(key) ?? '[]');
		return Array.isArray(value)
			? value.filter(
					(p) => typeof p?.id === 'string' && typeof p.name === 'string' && Array.isArray(p.covers)
				)
			: [];
	} catch {
		return [];
	}
}
function write(k: string, value: RecordValue[]) {
	try {
		localStorage.setItem(k, JSON.stringify(value));
	} catch {
		/* An exhausted browser cache leaves playback available by track. */
	}
}
export function rememberedPlaylistNames(session: Session) {
	const k = key(session);
	return k ? read(k).map(({ id, name }) => ({ id, name })) : [];
}
export function rememberPlaylistList(
	session: Session,
	list: Playlist[],
	art: (p: Playlist) => string[]
) {
	const k = key(session);
	if (!k) return;
	const old = new Map(read(k).map((p) => [p.id, p]));
	write(
		k,
		list.map((p) => ({ id: p.id, name: p.name, covers: art(p), ids: old.get(p.id)?.ids }))
	);
}
export function rememberPlaylistTracks(
	session: Session,
	p: Playlist,
	tracks: PlayerTrack[],
	covers: string[]
) {
	const k = key(session);
	if (!k) return;
	write(k, [
		...read(k).filter((x) => x.id !== p.id),
		{ id: p.id, name: p.name, covers, ids: tracks.map((t) => t.id) }
	]);
}
export function forgetPlaylist(session: Session, id: string) {
	const k = key(session);
	if (k)
		write(
			k,
			read(k).filter((p) => p.id !== id)
		);
}
export function offlinePlaylists(session: Session, tracks: PlayerTrack[], onlyId?: string) {
	const k = key(session);
	if (!k) return [];
	const byId = new Map(tracks.map((t) => [t.id, t]));
	return read(k).flatMap((p) => {
		if (onlyId && 'playlist:' + p.id !== onlyId) return [];
		const available = (p.ids ?? []).flatMap((id) => byId.get(id) ?? []);
		return available.length
			? [
					{
						id: 'playlist:' + p.id,
						title: p.name,
						count: available.length,
						knownPlayable: p.ids?.length,
						subtitle: available.length + ' available offline',
						covers: p.covers,
						localTracks: available
					}
				]
			: [];
	});
}
