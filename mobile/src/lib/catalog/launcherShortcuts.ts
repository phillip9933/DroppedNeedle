import { Capacitor, registerPlugin } from '@capacitor/core';
import { writable } from 'svelte/store';
import type { Session } from '../connection';
import {
	collectionKey,
	readHome,
	watchHome,
	pinKey,
	type HomePin,
	type HomeCollection
} from './homePins';
import { mixRequest } from './mixBuilder';
import { onPlaylistMembership, rememberedPlaylistTrackIds } from './playlistOffline';
import { accountId } from '../boards/layout';

type Account = Pick<Session, 'serverUrl' | 'userId'>;
const native = registerPlugin<{
	pinPlaylist(options: Account & { id: string; name: string }): Promise<void>;
	takePlaylist(options: Account): Promise<{ id?: string }>;
	replaceHomePins(options: Account & { pins: unknown[] }): Promise<void>;
}>('DNLauncher');
export const launcherShortcuts = Capacitor.getPlatform() === 'android';
export const pendingShortcut = writable<{ session: Session; id: string } | null>(null);
export function pinPlaylist(session: Session, id: string, name: string) {
	return native.pinPlaylist({ serverUrl: session.serverUrl, userId: session.userId, id, name });
}
export function takePlaylistShortcut(session: Session) {
	return native.takePlaylist({ serverUrl: session.serverUrl, userId: session.userId });
}
function carPin(session: Session, pin: HomePin, data: HomeCollection) {
	const mix = pin.kind === 'mix' ? data.mixes.find((m) => m.id === pin.id) : undefined;
	return {
		kind: pin.kind,
		id: pin.id,
		title: pin.title,
		artist: pin.artist,
		album: pin.album,
		localId: pin.localId,
		mbid: pin.mbid,
		stationType: pin.stationType,
		songs: data.lastTracks[pinKey(pin)],
		playlistIds: pin.kind === 'playlist' ? rememberedPlaylistTrackIds(session, pin.id) : undefined,
		plan: mix
			? mixRequest(mix)
			: pin.kind === 'station'
				? { seed_type: pin.stationType, seed_id: pin.id }
				: undefined
	};
}
export function mirrorHomePins(session: Session) {
	if (!launcherShortcuts) return;
	let live = true,
		stop: (() => void) | undefined,
		pending = Promise.resolve();
	void accountId(session)
		.then((userId) => {
			if (!live) return;
			const key = collectionKey(session.serverUrl, userId);
			const publish = (data: HomeCollection) => {
				const pins = data.pins
					.filter((p) => p.kind !== 'smart')
					.map((p) => carPin(session, p, data));
				pending = pending
					.then(async () => {
						if (live) await native.replaceHomePins({ serverUrl: session.serverUrl, userId, pins });
					})
					.catch(() => {
						/* Older Android builds still use the in-app pins. */
					});
			};
			const stopPins = watchHome(key, publish),
				stopMembership = onPlaylistMembership(session, () => publish(readHome(key)));
			stop = () => {
				stopPins();
				stopMembership();
			};
		})
		.catch(() => {});
	return () => {
		live = false;
		stop?.();
	};
}
