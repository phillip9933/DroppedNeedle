import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PlayerAccess, PlayerTrack } from '../player';
import {
	retainedTrack,
	type OfflineAccount,
	type OfflineOptions,
	type OfflineSnapshot
} from './tracks';
export {
	cacheSizes,
	offlineDefaults,
	type OfflineItem,
	type OfflineOptions,
	type OfflineSnapshot
} from './tracks';
import { webOffline, type OfflineBridge } from './web';

export const offlineSupported =
	Capacitor.getPlatform() === 'android' || !Capacitor.isNativePlatform();
export const nativeOffline = Capacitor.getPlatform() === 'android';
const native = registerPlugin<OfflineBridge>('DNOffline');
const backend = () => (nativeOffline ? native : webOffline);
export const mediaChanged = 'dn-offline-media';

function account(session: OfflineAccount) {
	if (!offlineSupported) throw Error('Offline music is unavailable on this platform.');
	if (!session.userId) throw Error('Reconnect to DN once to identify your offline library.');
	return { serverUrl: session.serverUrl, userId: session.userId };
}
export function offlineSnapshot(session: OfflineAccount): Promise<OfflineSnapshot> {
	return backend().snapshot(account(session));
}
export async function preferredOffline(session: OfflineAccount) {
	if (!offlineSupported || !session.userId) return false;
	return (await backend().options(account(session))).offlineOnly;
}
export async function configureOffline(session: OfflineAccount, options: OfflineOptions) {
	const next = await backend().configure({ ...account(session), options });
	window.dispatchEvent(new Event(mediaChanged));
	return next;
}
export async function clearAutomatic(session: OfflineAccount) {
	await backend().clearCache(account(session));
	window.dispatchEvent(new Event(mediaChanged));
}
export async function removeOffline(session: OfflineAccount, ids: string[]) {
	await backend().remove({ ...account(session), ids });
	window.dispatchEvent(new Event(mediaChanged));
}
export async function saveOfflineTracks(
	session: PlayerAccess & OfflineAccount,
	tracks: PlayerTrack[],
	onprogress?: (complete: number, total: number) => void,
	signal?: AbortSignal
) {
	const owner = account(session);
	const unique = [...new Map(tracks.map((t) => [t.id, t])).values()];
	let saved = 0,
		failed = 0,
		lastError = '';
	try {
		for (const track of unique) {
			signal?.throwIfAborted();
			try {
				await backend().save({
					...owner,
					token: session.token,
					track: retainedTrack(track, session.serverUrl)
				});
				saved++;
			} catch (e) {
				failed++;
				lastError = e instanceof Error ? e.message : 'Download failed.';
			}
			onprogress?.(saved + failed, unique.length);
		}
	} finally {
		if (saved) window.dispatchEvent(new Event(mediaChanged));
	}
	const success = saved + (saved === 1 ? ' song saved offline.' : ' songs saved offline.');
	return {
		saved,
		failed,
		message: failed ? (saved ? success + ' ' : '') + failed + ' failed. ' + lastError : success
	};
}
export function storageSize(bytes: number) {
	if (!bytes) return '0 B';
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1048576) return Math.ceil(bytes / 1024) + ' KiB';
	if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MiB';
	return (bytes / 1073741824).toFixed(1) + ' GiB';
}
