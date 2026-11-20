import type { components, paths } from '../../../../frontend/src/lib/api/v3/openapi';
import { DnError, getJson, postJson, type Session } from '../connection';
import type { PlayerTrack } from '../player';

type Schema = components['schemas'];
export type CatalogTab = 'library' | 'search' | 'requests';
export type OnPlay = (tracks: PlayerTrack[], index: number) => Promise<void> | void;
export type Edition = Schema['AlbumEditionItem'];
export type RequestItem = Schema['RequestItem'];
export type Album = {
	title: string;
	artist: string;
	year?: number | null;
	localId?: string | null;
	group?: string | null;
	art?: string;
	requested?: boolean;
	release?: string | null;
	imported?: boolean;
};

function path<T extends keyof paths>(
	template: T,
	params: Record<string, string> = {},
	query: Record<string, string | number | undefined> = {}
) {
	const route = template.replace(/\{([^}]+)\}/g, (_, key: string) => {
		if (!params[key]) throw new Error('A DroppedNeedle item is missing its ID.');
		return encodeURIComponent(params[key]);
	});
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) search.set(key, String(value));
	}
	return search.size ? route + '?' + search : route;
}

export function cover(group?: string | null, localId?: string | null, missing = false) {
	if (missing) return undefined;
	if (group)
		return path(
			'/api/v3/covers/release-group/{release_group_id}',
			{ release_group_id: group },
			{ size: 500 }
		);
	if (localId) return path('/api/v3/library/albums/{id}/artwork', { id: localId }, { size: 500 });
}

function playerTrack(
	id: string,
	title: string,
	artist: string,
	album: string,
	art: string | undefined,
	duration?: number | null
): PlayerTrack {
	return {
		id,
		title,
		artist,
		album,
		streamUrl: path('/api/v3/stream/{source}/{*key}', { source: 'local', '*key': id }),
		artworkUrl: art,
		duration: duration ?? undefined
	};
}

export async function library(session: Session, after?: string) {
	const url = path(
		'/api/v3/library/albums',
		{},
		{ limit: 30, sort: 'date_added', order: 'desc', after }
	);
	const page = await getJson<Schema['AlbumPage']>(session, url);
	return {
		albums: page.items.map((a): Album => ({
			title: a.title,
			artist: a.artist_name,
			year: a.year,
			localId: a.id,
			group: a.release_group_mbid,
			art: cover(
				a.release_group_mbid,
				a.id,
				a.art_missing || (!a.release_group_mbid && !a.cover_available)
			)
		})),
		next: page.next
	};
}

export async function search(session: Session, term: string) {
	const url = path(
		'/api/v3/search',
		{},
		{ q: term, buckets: 'albums,tracks', limit_albums: 40, limit_tracks: 16 }
	);
	const result = await getJson<Schema['SearchResponse']>(session, url);
	const albums = result.albums
		.filter((a) => a.id || a.musicbrainz_id)
		.map((a): Album => ({
			title: a.title,
			artist: a.artist ?? '',
			year: a.year,
			localId: a.id,
			group: a.musicbrainz_id,
			art: cover(a.musicbrainz_id, a.id, a.art_missing),
			requested: a.requested
		}));
	const tracks = result.tracks.flatMap((t) => {
		if (!t.track || !t.id) return [];
		const d = t.track;
		const art = cover(
			d.release_group_mbid,
			d.album_id,
			t.art_missing || (!d.release_group_mbid && !d.cover_available)
		);
		return [playerTrack(t.id, t.title, t.artist ?? '', d.album_title, art, d.duration_seconds)];
	});
	return { albums, tracks, partial: result.album_status !== 'ok' };
}

/** The match endpoint takes a local copy ID or chooses DN's preferred copy of a group. */
async function localTracks(session: Session, album: Album): Promise<Schema['TrackView'][]> {
	if (album.release && !album.localId) {
		const status = await getJson<Schema['LibraryAlbumStatus']>(
			session,
			path('/api/v3/library/albums/{id}/status', { id: album.release })
		);
		// Several copies can hold this exact edition. Queue the one DN selects.
		return status.tracks.filter((track) => track.album_id === status.album_id);
	}
	const id = album.localId || album.group;
	if (!id) return [];
	const tracks: Schema['TrackView'][] = [];
	try {
		let total: number;
		do {
			const url = path(
				'/api/v3/library/albums/match/{mbid}',
				{ mbid: id },
				{ limit: 200, offset: tracks.length }
			);
			const page = await getJson<Schema['TrackPage']>(session, url);
			tracks.push(...page.items);
			total = page.total;
			if (!page.items.length) break;
		} while (tracks.length < total);
	} catch (e) {
		if (e instanceof DnError && e.status === 404 && !tracks.length) return [];
		throw e;
	}
	return tracks;
}

export async function albumTracks(session: Session, album: Album) {
	const tracks = await localTracks(session, album);
	return tracks
		.sort((a, b) => a.disc_number - b.disc_number || a.track_number - b.track_number)
		.map((t) =>
			playerTrack(
				t.id,
				t.title,
				t.artist_name || album.artist,
				t.album_title,
				cover(
					t.release_group_mbid,
					t.album_id,
					t.art_missing || (!t.release_group_mbid && !t.cover_available)
				),
				t.duration_seconds
			)
		);
}

export function editions(session: Session, albumId: string) {
	return getJson<Schema['AlbumEditionsResponse']>(
		session,
		path('/api/v3/albums/{album_id}/editions', { album_id: albumId })
	);
}

export function editionTracks(session: Session, albumId: string, release: string) {
	return getJson<Schema['AlbumTracksInfo']>(
		session,
		path('/api/v3/albums/{album_id}/editions/{release_mbid}/tracks', {
			album_id: albumId,
			release_mbid: release
		})
	);
}

export function editionLabel(e: Edition) {
	return (
		[
			e.disambiguation || e.title,
			e.date,
			e.country,
			e.media_formats?.join(' / '),
			e.label,
			e.catalog_number || e.barcode,
			e.track_count ? e.track_count + ' tracks' : ''
		]
			.filter(Boolean)
			.join(' · ') || e.release_mbid
	);
}

export async function requestAlbum(session: Session, album: Album, release: string | null) {
	if (!album.group) throw new Error('This album has no MusicBrainz release group.');
	const body: Schema['AlbumIntake'] = {
		musicbrainz_id: album.group,
		release_mbid: release,
		album: album.title,
		artist: album.artist,
		year: album.year
	};
	const answer = await postJson<Schema['IntakeResponse']>(
		session,
		path('/api/v3/requests/albums'),
		body
	);
	if (!answer.success)
		throw new Error(answer.message || 'DroppedNeedle could not accept the request.');
	return answer;
}

export function activeRequests(session: Session) {
	return getJson<Schema['ActiveRequestsResponse']>(session, path('/api/v3/requests/active'));
}

export function requestHistory(session: Session, page: number) {
	return getJson<Schema['HistoryResponse']>(
		session,
		path('/api/v3/requests/history', {}, { page, page_size: 30 })
	);
}

export function requestedAlbum(r: RequestItem): Album | null {
	const group = r.request_kind === 'album' ? r.musicbrainz_id : r.track_release_group_mbid;
	return group
		? {
				title: r.album_title,
				artist: r.artist_name,
				group,
				year: r.year,
				release: r.release_mbid,
				imported: r.status === 'imported',
				art: cover(group),
				requested: !['failed', 'rejected', 'cancelled', 'incomplete', 'imported'].includes(r.status)
			}
		: null;
}

export function statusLabel(r: RequestItem) {
	const status = r.waiting_reason || r.task_state || r.status;
	return status.replaceAll('_', ' ').replace(/^./, (s) => s.toUpperCase());
}

export function errorMessage(e: unknown) {
	return e instanceof Error ? e.message : 'Could not reach DroppedNeedle.';
}
