import type { Session } from '../connection';
import type { PlayerTrack } from '../player';

export type OfflineAccount = Pick<Session, 'serverUrl' | 'userId'>;
export type OfflineOptions = {
	autoCache: boolean;
	unmeteredOnly: boolean;
	cacheMiB: number;
	offlineOnly: boolean;
};
export type OfflineItem = { track: PlayerTrack; pinned: boolean; bytes: number; used: number };
export type OfflineSnapshot = { items: OfflineItem[]; options: OfflineOptions };
export const offlineDefaults: OfflineOptions = {
	autoCache: false,
	unmeteredOnly: true,
	cacheMiB: 512,
	offlineOnly: false
};
export const cacheSizes = [128, 256, 512, 1024, 2048, 4096];

export function retainedTrack(track: PlayerTrack, serverUrl: string): PlayerTrack {
	const base = new URL(serverUrl);
	base.pathname = base.pathname.replace(/\/?$/, '/');
	const stream = new URL(track.streamUrl.replace(/^\/(?!\/)/, ''), base);
	const path = 'api/v3/stream/local/' + encodeURIComponent(track.id);
	if (
		!track.id ||
		base.protocol !== 'https:' ||
		stream.origin !== base.origin ||
		stream.username ||
		stream.password ||
		stream.pathname !== base.pathname + path
	)
		throw Error('Choose a song in this DroppedNeedle library.');
	let artworkUrl: string | undefined;
	if (track.artworkUrl) {
		const art = new URL(track.artworkUrl.replace(/^\/(?!\/)/, ''), base);
		if (
			art.origin === base.origin &&
			!art.username &&
			!art.password &&
			art.pathname.startsWith(base.pathname + 'api/v3/')
		) {
			artworkUrl = '/' + art.pathname.slice(base.pathname.length);
			const size = art.searchParams.get('size');
			if (size && /^[0-9]{1,4}$/.test(size)) artworkUrl += '?size=' + size;
		}
	}
	return {
		id: track.id,
		title: track.title,
		album: track.album,
		artist: track.artist,
		duration: track.duration,
		streamUrl: '/' + path,
		artworkUrl
	};
}
