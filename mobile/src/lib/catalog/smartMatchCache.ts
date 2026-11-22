import type { PlayerTrack } from '../player';
import type { PlayStat } from './smartRules';

export interface SmartMatches {
	definition: string;
	ids: string[];
	tracks?: PlayerTrack[];
	completedAt?: number;
	feedbackRevision?: string | null;
	stats?: Record<string, PlayStat>;
	ratings?: Record<string, number>;
	genres?: Record<string, string[]>;
	genreFields?: string[];
}

let storage: Promise<IDBDatabase> | undefined;
function database() {
	return (storage ??= new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open('dn.mobile.smart-matches', 1);
		req.onupgradeneeded = () => req.result.createObjectStore('matches');
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => {
				db.close();
				storage = undefined;
			};
			resolve(db);
		};
		req.onerror = () => reject(req.error);
	}).catch((e) => {
		storage = undefined;
		throw e;
	}));
}
export async function savedMatches(key: string) {
	try {
		const db = await database();
		const cached = await new Promise<SmartMatches | undefined>((resolve, reject) => {
			const req = db.transaction('matches').objectStore('matches').get(key);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		if (cached) return cached;
	} catch {
		/* Fall back to the original on-device cache. */
	}
	try {
		return JSON.parse(localStorage.getItem(key + '.matches') ?? 'null') as SmartMatches | null;
	} catch {
		return null;
	}
}
export async function storeMatches(key: string, value?: SmartMatches, current?: () => boolean) {
	try {
		const db = await database();
		if (current && !current()) return false;
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('matches', 'readwrite');
			const store = tx.objectStore('matches');
			if (value) store.put(value, key);
			else store.delete(key);
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error);
		});
		localStorage.removeItem(key + '.matches');
		return true;
	} catch {
		/* Reading library matches online works even if the device cache is full. */
		return false;
	}
}
