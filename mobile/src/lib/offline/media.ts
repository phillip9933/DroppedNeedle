import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, postJson, type Session } from '../connection';
import { localSong, path } from '../catalog/catalog';
import { inventory } from './library';
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
const native = registerPlugin<
	OfflineBridge & {
		addListener(name: 'mediaChanged', listener: () => void): Promise<PluginListenerHandle>;
	}
>('DNOffline');
const backend = () => (nativeOffline ? native : webOffline);
export const mediaChanged = 'dn-offline-media';
let activeBatches = 0;

function account(session: OfflineAccount) {
	if (!offlineSupported) throw Error('Offline music is unavailable on this platform.');
	if (!session.userId) throw Error('Reconnect to DN once to identify your offline library.');
	return { serverUrl: session.serverUrl, userId: session.userId };
}
export function offlineSnapshot(session: OfflineAccount): Promise<OfflineSnapshot> {
	return backend().snapshot(account(session));
}
export async function offlineInventory(session: OfflineAccount) {
	return inventory(await offlineSnapshot(session));
}
export function watchOfflineMedia(listener: () => void) {
	const update = () => {
		if (!activeBatches) listener();
	};
	window.addEventListener(mediaChanged, update);
	const nativeListener = nativeOffline ? native.addListener('mediaChanged', update) : null;
	return () => {
		window.removeEventListener(mediaChanged, update);
		void nativeListener?.then((handle) => handle.remove());
	};
}
export async function preferredOffline(session: OfflineAccount) {
	if (!offlineSupported || !session.userId) return false;
	return (await backend().options(account(session))).offlineOnly;
}
export async function configureOffline(session: OfflineAccount, options: OfflineOptions) {
	const existing = await backend().options(account(session));
	const next = await backend().configure({ ...account(session), options });
	if (
		existing.autoDownload !== next.autoDownload ||
		existing.offlineOnly !== next.offlineOnly ||
		existing.downloadMiB !== next.downloadMiB ||
		existing.unmeteredOnly !== next.unmeteredOnly
	)
		await stopAutoDownloads(session);
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
async function withRatings(session: PlayerAccess, tracks: PlayerTrack[]) {
	if (!tracks.length || !navigator.onLine) return tracks;
	try {
		const ratings = await postJson<components['schemas']['RatingLookupResponse']>(
			{ displayName: '', ...session },
			path('/api/v3/ratings/lookup'),
			{ track_ids: tracks.map((t) => t.id) }
		);
		if (!ratings?.tracks || typeof ratings.tracks !== 'object') return tracks;
		return tracks.map((t) => ({ ...t, rating: ratings.tracks[t.id] ?? 0 }));
	} catch {
		return tracks;
	}
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
	activeBatches++;
	try {
		const options = await backend().options(owner);
		for (let start = 0; start < unique.length; start += 100) {
			signal?.throwIfAborted();
			const batch = unique.slice(start, start + 100);
			for (const track of options.offlineOnly ? batch : await withRatings(session, batch)) {
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
		}
	} finally {
		if (--activeBatches === 0) window.dispatchEvent(new Event(mediaChanged));
	}
	const success = saved + (saved === 1 ? ' song saved offline.' : ' songs saved offline.');
	return {
		saved,
		failed,
		message: failed ? (saved ? success + ' ' : '') + failed + ' failed. ' + lastError : success
	};
}
const syncs = new Map<string, { pending: Promise<number>; abort: AbortController }>();
const syncKey = (a: OfflineAccount) => JSON.stringify([a.serverUrl, a.userId]);
export async function stopAutoDownloads(session: OfflineAccount) {
	const key = syncKey(session),
		job = syncs.get(key);
	if (!job) return;
	syncs.delete(key);
	job.abort.abort();
	if (session.userId) await backend().cancelAutomatic(account(session));
}

export function runAutoDownloads(session: Session, signal?: AbortSignal): Promise<number> {
	if (signal?.aborted || !offlineSupported || !session.userId || !navigator.onLine)
		return Promise.resolve(0);
	const key = syncKey(session);
	const previous = syncs.get(key);
	if (previous) return previous.pending;
	const abort = new AbortController();
	signal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
	const pending = sync().finally(() => {
		if (syncs.get(key)?.pending === pending) syncs.delete(key);
	});
	syncs.set(key, { pending, abort });
	return pending;
	async function sync() {
		const owner = account(session);
		const settings = await backend().options(owner);
		const source = settings.autoDownload;
		if (!source || source === 'off' || settings.offlineOnly || signal?.aborted) return 0;
		const response = await getJson<components['schemas']['TrackListPage']>(
			session,
			path(
				'/api/v3/library/tracks',
				{},
				{
					limit: 25,
					sort: 'date_added',
					order: 'desc',
					favorites: source === 'favorites' ? 'true' : undefined
				}
			),
			signal
		);
		signal?.throwIfAborted();
		const tracks = response.items.slice(0, 25).map((t) => localSong(t));
		const { ids } = await backend().planAutomatic({
			...owner,
			source,
			ids: tracks.map((t) => t.id)
		});
		const wanted = new Set(ids);
		activeBatches++;
		try {
			for (const track of await withRatings(
				session,
				tracks.filter((t) => wanted.has(t.id))
			)) {
				signal?.throwIfAborted();
				if (!navigator.onLine) break;
				await backend().save({
					...owner,
					token: session.token,
					track: retainedTrack(track, session.serverUrl),
					...(!nativeOffline ? { signal } : {}),
					source
				});
			}
		} finally {
			if (--activeBatches === 0) window.dispatchEvent(new Event(mediaChanged));
		}
		if (!wanted.size) return 0;
		const snapshot = await backend().snapshot(owner);
		return snapshot.items.filter((item) => wanted.has(item.track.id) && item.origin === 'automatic')
			.length;
	}
}
export function storageSize(bytes: number) {
	if (!bytes) return '0 B';
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1048576) return Math.ceil(bytes / 1024) + ' KiB';
	if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MiB';
	return (bytes / 1073741824).toFixed(1) + ' GiB';
}
