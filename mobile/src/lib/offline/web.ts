import type { PlayerTrack } from '../player';
import {
	cacheSizes,
	offlineDefaults,
	retainedTrack,
	type OfflineItem,
	type OfflineOptions,
	type OfflineSnapshot
} from './tracks';

type Account = { serverUrl: string; userId: string };
type Entry = OfflineItem & { scope: string; id: string; audio: Blob };
export interface OfflineBridge {
	snapshot(a: Account): Promise<OfflineSnapshot>;
	options(a: Account): Promise<OfflineOptions>;
	configure(a: Account & { options: OfflineOptions }): Promise<OfflineOptions>;
	clearCache(a: Account): Promise<void>;
	remove(a: Account & { ids: string[] }): Promise<void>;
	save(a: Account & { token: string; track: PlayerTrack }): Promise<void>;
}
const scope = (a: Account) => JSON.stringify([a.serverUrl, a.userId]);
let opened: Promise<IDBDatabase> | undefined;
function database() {
	if (!opened)
		opened = new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open('dn.mobile.offline.v1', 1);
			req.onupgradeneeded = () => {
				req.result
					.createObjectStore('tracks', { keyPath: ['scope', 'id'] })
					.createIndex('scope', 'scope');
				req.result.createObjectStore('options');
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => {
				opened = undefined;
				reject(req.error);
			};
		});
	return opened;
}
function result<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((ok, bad) => {
		req.onsuccess = () => ok(req.result);
		req.onerror = () => bad(req.error);
	});
}
async function transaction<T>(
	mode: IDBTransactionMode,
	operation: (tracks: IDBObjectStore, prefs: IDBObjectStore) => Promise<T>
) {
	const tx = (await database()).transaction(['tracks', 'options'], mode);
	const complete = new Promise<void>((ok, bad) => {
		tx.oncomplete = () => ok();
		tx.onabort = () => bad(tx.error ?? Error('Offline storage write failed.'));
	});
	try {
		const out = await operation(tx.objectStore('tracks'), tx.objectStore('options'));
		await complete;
		return out;
	} catch (e) {
		try {
			tx.abort();
		} catch {
			/* A failed request can already have ended the transaction. */
		}
		await complete.catch(() => {});
		throw e;
	}
}
async function rows(store: IDBObjectStore, key: string): Promise<Entry[]> {
	return result(store.index('scope').getAll(IDBKeyRange.only(key)));
}
async function prefs(store: IDBObjectStore, key: string): Promise<OfflineOptions> {
	return (await result(store.get(key))) ?? { ...offlineDefaults };
}
async function trim(store: IDBObjectStore, key: string, limit: number) {
	const automatic = (await rows(store, key))
		.filter((t) => !t.pinned)
		.sort((a, b) => b.used - a.used);
	let total = 0;
	for (const t of automatic) {
		if (total + t.bytes <= limit) total += t.bytes;
		else store.delete([key, t.id]);
	}
}
type Revision = { cache: number; item: number };
async function revision(store: IDBObjectStore, key: string, id: string): Promise<Revision> {
	return {
		cache: (await result(store.get(['cache', key]))) ?? 0,
		item: (await result(store.get(['item', key, id]))) ?? 0
	};
}
export async function webPlaybackPolicy(a: Account, id: string) {
	const key = scope(a);
	return transaction('readonly', async (_, settings) => ({
		options: await prefs(settings, key),
		revision: await revision(settings, key, id)
	}));
}
async function write(a: Account, track: PlayerTrack, audio: Blob, pin: boolean, started: Revision) {
	const key = scope(a);
	await transaction('readwrite', async (store, settings) => {
		const existing: Entry | undefined = await result(store.get([key, track.id]));
		if (existing?.pinned) return;
		const current = await revision(settings, key, track.id);
		if (current.item !== started.item) throw Error('The offline copy was removed.');
		if (!pin && current.cache !== started.cache) return;
		const opts = await prefs(settings, key);
		if (!pin && (!opts.autoCache || !audio.size || audio.size > opts.cacheMiB * 1048576)) return;
		await result(
			store.put({
				scope: key,
				id: track.id,
				track: retainedTrack(track, a.serverUrl),
				audio,
				pinned: pin,
				bytes: audio.size,
				used: Date.now()
			} satisfies Entry)
		);
		if (!pin) await trim(store, key, opts.cacheMiB * 1048576);
	});
}
export async function webLocalAudio(a: Account, id: string) {
	return transaction('readwrite', async (store) => {
		const entry: Entry | undefined = await result(store.get([scope(a), id]));
		if (!entry) return null;
		entry.used = Date.now();
		await result(store.put(entry));
		return entry.audio;
	});
}
export async function cacheWebPlayback(
	a: Account,
	track: PlayerTrack,
	audio: Blob,
	started: Revision
) {
	try {
		await write(a, track, audio, false, started);
	} catch {
		/* Optional caching must not interrupt playback if storage is full. */
	}
}
export const webOffline: OfflineBridge = {
	async snapshot(a) {
		const key = scope(a);
		return transaction('readonly', async (store, settings) => ({
			options: await prefs(settings, key),
			items: (await rows(store, key))
				.map(({ track, bytes, pinned, used }) => ({ track, bytes, pinned, used }))
				.sort((a, b) => b.used - a.used)
		}));
	},
	async options(a) {
		return transaction('readonly', async (_, settings) => prefs(settings, scope(a)));
	},
	async configure(a) {
		if (!cacheSizes.includes(a.options.cacheMiB)) throw Error('Choose a supported cache size.');
		const key = scope(a);
		return transaction('readwrite', async (store, settings) => {
			await result(settings.put(a.options, key));
			await trim(store, key, a.options.cacheMiB * 1048576);
			return a.options;
		});
	},
	async remove(a) {
		const key = scope(a);
		await transaction('readwrite', async (store, settings) => {
			for (const id of a.ids) {
				const marker = ['item', key, id];
				await result(settings.put(((await result(settings.get(marker))) ?? 0) + 1, marker));
				await result(store.delete([key, id]));
			}
		});
	},
	async clearCache(a) {
		const key = scope(a);
		await transaction('readwrite', async (store, settings) => {
			const marker = ['cache', key];
			await result(settings.put(((await result(settings.get(marker))) ?? 0) + 1, marker));
			for (const e of await rows(store, key)) if (!e.pinned) store.delete([key, e.id]);
		});
	},
	async save(a) {
		const key = scope(a);
		const started = await transaction('readwrite', async (store, settings) => {
			const cached: Entry | undefined = await result(store.get([key, a.track.id]));
			if (!cached) return revision(settings, key, a.track.id);
			cached.pinned = true;
			cached.used = Date.now();
			await result(store.put(cached));
			return null;
		});
		if (!started) return;
		if (!navigator.onLine) throw Error('Reconnect to download this song.');
		const source = new URL(a.serverUrl + a.track.streamUrl);
		source.searchParams.set('format', 'raw');
		const response = await fetch(source, {
			headers: { Authorization: 'Bearer ' + a.token },
			credentials: 'omit',
			redirect: 'error',
			cache: 'no-store',
			referrerPolicy: 'no-referrer',
			signal: AbortSignal.timeout(180000)
		});
		if (response.status !== 200 || !isAudio(response.headers.get('content-type')))
			throw Error('DN could not serve this audio file.');
		const blob = await response.blob();
		const expected = response.headers.get('content-length');
		if (
			!blob.size ||
			(expected && !response.headers.get('content-encoding') && Number(expected) !== blob.size)
		)
			throw Error('The audio download was incomplete.');
		await write(a, a.track, blob, true, started);
	}
};
export function isAudio(value: string | null) {
	const mime = value?.split(';')[0].trim().toLowerCase();
	return (
		!!mime &&
		(mime.startsWith('audio/') ||
			['application/octet-stream', 'application/ogg', 'application/flac'].includes(mime))
	);
}
