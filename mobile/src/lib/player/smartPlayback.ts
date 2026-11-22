import { Capacitor } from '@capacitor/core';
import type { Session } from '../connection';
import { playbackAddresses, type PlayerTrack } from '../player';
import { queueSizeCheck } from '../catalog/libraryQueue';
import { attachBrowserSmartSnapshot, refillSize, type LibraryContinuation } from './libraryWindow';
import { nativePlayer } from './native';
import { shuffled } from './shuffle';

export async function prepareSmartPlayback(
	session: Session,
	matches: PlayerTrack[],
	index: number,
	shuffle: boolean,
	signal?: AbortSignal
): Promise<{ tracks: PlayerTrack[]; index: number; continuation?: LibraryContinuation }> {
	signal?.throwIfAborted();
	if (!Number.isInteger(index) || index < 0 || index >= matches.length)
		throw Error('Choose a matching track to play.');
	const ordered = shuffle ? await shuffled(matches, session) : matches;
	const selected = shuffle ? 0 : index;
	const platform = Capacitor.getPlatform();
	if (ordered.length <= refillSize || platform === 'ios') {
		ordered.forEach(queueSizeCheck(session.serverUrl));
		return { tracks: ordered, index: selected };
	}
	const snapshot = crypto.randomUUID();
	const total = ordered.length;
	const start = Math.max(0, Math.floor(selected / refillSize) * refillSize - 50);
	const loaded = Math.min(total, Math.floor(selected / refillSize) * refillSize + refillSize);
	const continuation: LibraryContinuation = {
		smartSnapshot: snapshot,
		filters: {},
		after: loaded < total ? String(loaded) : null,
		loaded,
		total
	};
	if (platform === 'android') {
		for (let offset = 0; offset < total; offset += refillSize) {
			signal?.throwIfAborted();
			const tracks = playbackAddresses(ordered.slice(offset, offset + refillSize), session);
			await nativePlayer.storeSmartPage({
				serverUrl: session.serverUrl,
				token: session.token,
				userId: session.userId,
				snapshot,
				start: offset,
				total,
				tracks
			});
		}
	} else {
		attachBrowserSmartSnapshot(
			continuation,
			playbackAddresses(ordered, session).map((track, smartIndex) => ({ ...track, smartIndex }))
		);
	}
	signal?.throwIfAborted();
	const tracks = ordered
		.slice(start, loaded)
		.map((track, i) => ({ ...track, smartIndex: start + i }));
	tracks.forEach(queueSizeCheck(session.serverUrl));
	return { tracks, index: selected - start, continuation };
}
