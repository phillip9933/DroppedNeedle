import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, readSecret, writeSecret, removeSecret, type Session } from '../connection';
import { libraryFilter } from '../boards/filteredSections';
import { localAlbum, path, type Album } from '../catalog/catalog';
import { localBrowse, type BrowseItem } from '../catalog/libraryBrowse';
import type { LocalArtist } from '../catalog/LocalArtistDetail.svelte';
import { offlineInventory, preferredOffline } from '../offline/media';
import { availableTracks, type Availability } from '../offline/library';
import type { PlayerTrack } from '../player';

export type Credit = 'album' | 'artist';
export type SavedScope = Exclude<Availability, 'all'>;
export type OnlineCredit =
	{ kind: 'album'; album: Album } | { kind: 'artist'; artist: LocalArtist };
export type RelatedItem = OnlineCredit | { kind: 'saved'; item: BrowseItem };
export type PlayerCredit = { kind: Credit; track: PlayerTrack; scope?: SavedScope };

// Store only the source filter and two track IDs. The native queue remains authoritative after a restart.
function savedScopeKey(session: Session) {
	return 'dn.mobile.queue-source.v1.' + JSON.stringify([session.serverUrl, session.userId]);
}
let pendingSource = Promise.resolve();
export function rememberQueueSource(
	session: Session,
	scope?: SavedScope,
	tracks: PlayerTrack[] = []
) {
	if (!session.userId) return;
	const key = savedScopeKey(session);
	const record =
		scope && tracks.length
			? { scope, ids: [tracks[0].id, tracks[tracks.length - 1].id] }
			: undefined;
	// Keep rapid queue replacement or sign-out ordered, using the same protected account storage as DN sessions.
	pendingSource = pendingSource
		.then(() => (record ? writeSecret(key, record) : removeSecret(key)))
		.catch(() => {});
}
export async function restoredQueueSource(
	session: Session,
	tracks: PlayerTrack[]
): Promise<SavedScope | undefined> {
	if (!session.userId || !tracks.length) return;
	await pendingSource;
	const saved = await readSecret<{ scope: SavedScope; ids: string[] }>(
		savedScopeKey(session)
	).catch(() => null);
	if (
		saved &&
		['offline', 'downloaded', 'automatic', 'cached'].includes(saved.scope) &&
		Array.isArray(saved.ids) &&
		tracks.some((t) => saved.ids.includes(t.id))
	)
		return saved.scope;
}

// Groups for legacy files have no catalog ID. Only use a group that actually contains this file.
function savedCredit(kind: Credit, track: PlayerTrack, tracks: PlayerTrack[]) {
	const member = tracks.find((t) => t.id === track.id);
	if (!member || !member[kind]?.trim()) return;
	const groups = localBrowse(kind === 'album' ? 'Albums' : 'Artists', tracks, {
		...libraryFilter(),
		q: '',
		order: 'asc'
	});
	const available = groups.filter((g) => g.localTracks?.some((t) => t.id === track.id));
	const fold = (text?: string) => text?.trim().toLocaleLowerCase();
	if (kind === 'album') {
		if (available.length !== 1) return;
		if (
			!member.albumId &&
			groups.filter(
				(g) =>
					fold(g.title) === fold(member.album) &&
					fold(g.subtitle) === fold(member.albumArtist || member.artist)
			).length !== 1
		)
			return;
		return available[0];
	}
	if (member.artistId)
		return (
			available.find((g) => g.id === 'Artists:' + member.artistId) ??
			available.find((g) => g.title === member.artist && g.id === 'Artists:' + member.albumArtistId)
		);
	const names = groups.filter((g) => fold(g.title) === fold(member.artist));
	return names.length === 1 && available.includes(names[0]) ? names[0] : undefined;
}

export async function resolveCredit(
	session: Session,
	credit: PlayerCredit,
	signal: AbortSignal
): Promise<RelatedItem | undefined> {
	const { kind, scope, track } = credit;
	const savedOnly = !!scope || !navigator.onLine || (await preferredOffline(session));
	signal.throwIfAborted();
	const key = kind === 'album' ? 'albumId' : 'artistId';
	let id = track[key];
	if (savedOnly || !id) {
		if (!session.userId) return;
		const data = await offlineInventory(session);
		signal.throwIfAborted();
		const member = data.byId.get(track.id)?.track;
		if (id && member?.[key] && id !== member[key]) return;
		id ??= member?.[key];
		if (savedOnly || !id) {
			const item = savedCredit(kind, track, availableTracks(data, scope ?? 'offline'));
			return item ? { kind: 'saved', item } : undefined;
		}
	}
	if (kind === 'artist') return { kind, artist: { id, name: track.artist } };
	const album = await getJson<components['schemas']['AlbumDetailView']>(
		session,
		path('/api/v3/library/albums/{id}', { id }),
		signal
	);
	if (album.id !== id) throw Error('DroppedNeedle returned a different album.');
	return { kind, album: localAlbum(album) };
}
