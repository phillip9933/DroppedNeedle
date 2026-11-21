import type { Session } from '../connection';
import type { PlayerTrack } from '../player';
import { validLocalFileId } from '../offline/tracks';
import { localAlbumKey, type BrowseItem, type Category } from './libraryBrowse';
import { type Album, playerTrack } from './catalog';
import { type RadioSeed } from './discovery';
import { offlinePlaylists } from './playlistOffline';
import { readSmartPlaylists, smartPlaylistTracks } from './smartPlaylists';
import { tr } from '../i18n';
import { deviceTrackOrder } from './trackFilters';
import { shuffleLocally } from '../player/shuffle';

export type MixSeed = { id: string; title: string; artist: string; artistMbid: string };
export type Mix = { id: string; title: string; mode: 'artists' | 'albums'; seeds: MixSeed[] };
export type HomePin = {
	kind: 'artist' | 'album' | 'track' | 'genre' | 'playlist' | 'smart' | 'station' | 'mix';
	id: string;
	title: string;
	artist?: string;
	album?: string;
	localId?: string;
	mbid?: string;
	art?: string;
	stationType?: RadioSeed;
	track?: Omit<PlayerTrack, 'streamUrl' | 'artworkUrl'>;
};
export type HomeCollection = {
	pins: HomePin[];
	mixes: Mix[];
	lastTracks: Record<string, Pick<PlayerTrack, 'id' | 'title' | 'artist' | 'album'>[]>;
};
export const homeEvent = 'dn-home-collection';
const pinKinds = ['artist', 'album', 'track', 'genre', 'playlist', 'smart', 'station', 'mix'];
export const mbid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export const maxSeeds = 8;
export function collectionKey(server: string, owner: string) {
	return 'dn.mobile.home-pins.v1.' + JSON.stringify([server, owner]);
}
export function pinKey(pin: HomePin) {
	return JSON.stringify([pin.kind, pin.stationType ?? '', pin.id]);
}
export function readHome(key: string): HomeCollection {
	const empty: HomeCollection = { pins: [], mixes: [], lastTracks: {} };
	try {
		const data = JSON.parse(localStorage.getItem(key) || 'null');
		if (!data) return empty;
		const pins = Array.isArray(data.pins)
			? data.pins.filter(
					(p: HomePin) =>
						p &&
						pinKinds.includes(p.kind) &&
						typeof p.id === 'string' &&
						typeof p.title === 'string'
				)
			: [];
		const mixes = Array.isArray(data.mixes)
			? data.mixes.filter(
					(m: Mix) =>
						m &&
						typeof m.id === 'string' &&
						typeof m.title === 'string' &&
						['artists', 'albums'].includes(m.mode) &&
						Array.isArray(m.seeds) &&
						m.seeds.length > 0 &&
						m.seeds.length <= maxSeeds &&
						m.seeds.every(
							(s) =>
								s &&
								mbid.test(s.id) &&
								typeof s.artistMbid === 'string' &&
								typeof s.title === 'string' &&
								typeof s.artist === 'string'
						)
				)
			: [];
		const lastTracks = Object.fromEntries(
			Object.entries(data.lastTracks ?? {}).filter(
				([name, tracks]) =>
					name.startsWith('[') &&
					Array.isArray(tracks) &&
					tracks.every((t) => t && validLocalFileId(t.id) && typeof t.title === 'string')
			)
		) as HomeCollection['lastTracks'];
		return { pins, mixes, lastTracks };
	} catch {
		return empty;
	}
}
export function updateHome(key: string, change: (data: HomeCollection) => void) {
	const data = readHome(key);
	change(data);
	writeHome(key, data);
}
function writeHome(key: string, data: HomeCollection) {
	localStorage.setItem(key, JSON.stringify(data));
	window.dispatchEvent(new CustomEvent(homeEvent, { detail: key }));
}
export function watchHome(key: string, changed: (data: HomeCollection) => void) {
	const notify = (e: Event) => {
		if (
			(e instanceof StorageEvent && (e.key === key || e.key === null)) ||
			(e as CustomEvent).detail === key
		)
			changed(readHome(key));
	};
	changed(readHome(key));
	window.addEventListener(homeEvent, notify);
	window.addEventListener('storage', notify);
	return () => {
		window.removeEventListener(homeEvent, notify);
		window.removeEventListener('storage', notify);
	};
}
export function setPinned(key: string, pin: HomePin, enabled: boolean) {
	updateHome(key, (data) => {
		const id = pinKey(pin),
			position = data.pins.findIndex((p) => pinKey(p) === id);
		if (enabled && position < 0) data.pins.push(pin);
		else if (!enabled && position >= 0) {
			data.pins.splice(position, 1);
			if (pin.kind !== 'mix') delete data.lastTracks[id];
		}
	});
}
export function movePin(key: string, pin: HomePin, step: number) {
	updateHome(key, (data) => {
		const from = data.pins.findIndex((p) => pinKey(p) === pinKey(pin)),
			to = from + step;
		if (from >= 0 && to >= 0 && to < data.pins.length)
			data.pins.splice(to, 0, ...data.pins.splice(from, 1));
	});
}
export function mixPin(mix: Mix): HomePin {
	return { kind: 'mix', id: mix.id, title: mix.title };
}
export function saveMix(key: string, mix: Mix) {
	updateHome(key, (data) => {
		const pos = data.mixes.findIndex((m) => m.id === mix.id);
		if (pos < 0) data.mixes.push(mix);
		else {
			if (
				JSON.stringify(data.mixes[pos].seeds) !== JSON.stringify(mix.seeds) ||
				data.mixes[pos].mode !== mix.mode
			)
				delete data.lastTracks[pinKey(mixPin(mix))];
			data.mixes[pos] = mix;
		}
		const pinned = data.pins.find((p) => p.kind === 'mix' && p.id === mix.id);
		if (pinned) pinned.title = mix.title;
	});
}
export function removeMix(key: string, mix: Mix) {
	updateHome(key, (data) => {
		data.mixes = data.mixes.filter((m) => m.id !== mix.id);
		data.pins = data.pins.filter((p) => p.kind !== 'mix' || p.id !== mix.id);
		delete data.lastTracks[pinKey(mixPin(mix))];
	});
}
export function rememberPlan(key: string, pin: HomePin, tracks: PlayerTrack[]) {
	if (!tracks.length) return;
	const data = readHome(key),
		id = pinKey(pin);
	if (
		!data.pins.some((p) => pinKey(p) === id) &&
		!(pin.kind === 'mix' && data.mixes.some((m) => m.id === pin.id))
	)
		return;
	data.lastTracks[id] = tracks.map(({ id, title, artist, album }) => ({
		id,
		title,
		artist,
		album
	}));
	try {
		writeHome(key, data);
	} catch {
		/* Playback can continue if the device cannot store this plan. */
	}
}
export function albumPin(album: Album): HomePin | undefined {
	const id = album.group || album.localId;
	return id
		? {
				kind: 'album',
				id,
				title: album.title,
				artist: album.artist,
				art: album.art,
				localId: album.localId ?? undefined,
				mbid: album.group ?? undefined
			}
		: undefined;
}
export function artistPin(
	name: string,
	localId?: string | null,
	artistMbid?: string | null
): HomePin | undefined {
	const id = artistMbid || localId;
	return id
		? {
				kind: 'artist',
				id,
				title: name,
				localId: localId ?? undefined,
				mbid: artistMbid ?? undefined
			}
		: undefined;
}
export function trackPin({ streamUrl, artworkUrl, ...t }: PlayerTrack): HomePin | undefined {
	return streamUrl && validLocalFileId(t.id)
		? {
				kind: 'track',
				track: t,
				id: t.id,
				title: t.title,
				artist: t.artist,
				album: t.album,
				localId: t.albumId,
				mbid: t.releaseGroupMbid,
				art: artworkUrl?.startsWith('/api/v3/') ? artworkUrl : undefined
			}
		: undefined;
}
export function stationPin(type: RadioSeed, id: string, title: string): HomePin {
	return { kind: 'station', stationType: type, id, title };
}
export function browsePin(row: BrowseItem, category: Category): HomePin | undefined {
	if (row.track) return trackPin(row.track);
	if (row.album) return albumPin(row.album);
	if (row.artist) return artistPin(row.title, row.artist.id, row.artist.artist_mbid);
	if (row.smart) return { kind: 'smart', title: row.title, id: row.smart.id };
	if (category === 'Playlists' && row.id.startsWith('playlist:'))
		return { kind: 'playlist', title: row.title, id: row.id.slice(9), art: row.covers?.[0] };
	const t = row.localTracks?.[0];
	if (category === 'Genres') {
		const genre = row.genre ?? t?.genre;
		return genre ? { kind: 'genre', title: row.title, id: genre } : undefined;
	}
	if (!t) return;
	if (category === 'Albums')
		return {
			kind: 'album',
			id: t.releaseGroupMbid || localAlbumKey(t),
			localId: t.albumId,
			mbid: t.releaseGroupMbid,
			title: row.title,
			artist: row.subtitle,
			art: t.artworkUrl
		};
	if (category === 'Artists') {
		const primary = row.id === 'Artists:' + (t.albumArtistId || t.albumArtist);
		const id = primary ? t.albumArtistId : t.artistId;
		const artistMbid = t.artist === row.title ? t.artistMbid : undefined;
		return (
			artistPin(row.title, id, artistMbid) ?? {
				kind: 'artist',
				title: row.title,
				id: row.id.slice(8)
			}
		);
	}
}
export function pinTrack(pin: HomePin) {
	return {
		...pin.track,
		...playerTrack(
			pin.id,
			pin.title,
			pin.artist ?? '',
			pin.album ?? '',
			pin.art,
			pin.track?.duration
		),
		albumId: pin.localId,
		releaseGroupMbid: pin.mbid
	};
}
export function pinKindLabel(kind: HomePin['kind']) {
	switch (kind) {
		case 'album':
			return tr('Album', 'アルバム');
		case 'artist':
			return tr('Artist', 'アーティスト');
		case 'genre':
			return tr('Genre', 'ジャンル');
		case 'track':
			return tr('Track', '曲');
		case 'playlist':
			return tr('Playlist', 'プレイリスト');
		case 'smart':
			return tr('Smart playlist', 'スマートプレイリスト');
		case 'mix':
			return tr('Mix', 'ミックス');
		case 'station':
			return tr('Station', 'ステーション');
	}
}
export async function devicePinTracks(
	session: Session,
	pin: HomePin,
	data: HomeCollection,
	available: PlayerTrack[],
	signal: AbortSignal
) {
	switch (pin.kind) {
		case 'track':
			return available.filter((t) => t.id === pin.id);
		case 'album':
			return available
				.filter(
					(t) =>
						t.albumId === (pin.localId || pin.id) ||
						localAlbumKey(t) === pin.id ||
						(pin.mbid && t.releaseGroupMbid === pin.mbid)
				)
				.sort(deviceTrackOrder({ sort: 'album', order: 'asc' }));
		case 'artist':
			return available.filter(
				(t) =>
					(pin.localId && [t.artistId, t.albumArtistId].includes(pin.localId)) ||
					(pin.mbid && t.artistMbid === pin.mbid) ||
					(!t.artistId && t.artist === pin.title) ||
					(!t.albumArtistId && t.albumArtist === pin.title)
			);
		case 'genre':
			return available.filter((t) => t.genre?.toLocaleLowerCase() === pin.id.toLocaleLowerCase());
		case 'playlist':
			return offlinePlaylists(session, available, 'playlist:' + pin.id)[0]?.localTracks ?? [];
		case 'smart': {
			const rule = (await readSmartPlaylists(session)).find((r) => r.id === pin.id);
			return rule ? smartPlaylistTracks(session, rule, signal, available) : [];
		}
		case 'mix':
		case 'station': {
			const byId = new Map(available.map((t) => [t.id, t]));
			const previous = (data.lastTracks[pinKey(pin)] ?? []).flatMap(({ id }) => byId.get(id) ?? []);
			if (previous.length) return previous;
			if (pin.kind === 'station')
				return available.filter((t) =>
					pin.stationType === 'genre'
						? t.genre?.toLocaleLowerCase() === pin.id.toLocaleLowerCase()
						: pin.stationType === 'artist'
							? t.artistMbid === pin.id
							: t.releaseGroupMbid === pin.id
				);
			const mix = data.mixes.find((m) => m.id === pin.id);
			const ids = new Set(mix?.seeds.map((s) => s.id));
			return shuffleLocally(
				available.filter((t) =>
					ids.has((mix?.mode === 'albums' ? t.releaseGroupMbid : t.artistMbid) ?? '')
				),
				session
			).slice(0, 25);
		}
	}
}
