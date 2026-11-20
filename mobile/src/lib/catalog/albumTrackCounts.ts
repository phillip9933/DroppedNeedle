import type { Session } from '../connection';

export type AlbumCount = { total: number; seenAt: number };
type Observation = AlbumCount & { scope: string; id: string };
const limit = 512;
const memory = new WeakMap<Session, Map<string, AlbumCount>>();
let opening: Promise<IDBDatabase> | undefined;

function database() {
	if (!opening) {
		opening = new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('dn.mobile.album-counts', 1);
			request.onupgradeneeded = () => {
				request.result
					.createObjectStore('albums', { keyPath: ['scope', 'id'] })
					.createIndex('seenAt', 'seenAt');
			};
			request.onsuccess = () => {
				const db = request.result;
				db.onversionchange = () => {
					db.close();
					opening = undefined;
				};
				resolve(db);
			};
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(Error('Album count storage is unavailable.'));
		}).catch((error) => {
			opening = undefined;
			throw error;
		});
	}
	return opening;
}
const scope = (s: Session) => s.userId && JSON.stringify([s.serverUrl, s.userId]);
const validId = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 512;
const validTotal = (n: number) => Number.isSafeInteger(n) && n >= 0;

export async function rememberAlbumCounts(
	session: Session,
	albums: { id: string; track_count: number }[]
) {
	const account = scope(session);
	if (!account) return;
	const seenAt = Date.now();
	const current = memory.get(session) ?? new Map<string, AlbumCount>();
	const rows: Observation[] = [];
	for (const { id, track_count: total } of albums.slice(-limit)) {
		if (!validId(id) || !validTotal(total)) continue;
		current.delete(id);
		current.set(id, { total, seenAt });
		if (current.size > limit) current.delete(current.keys().next().value!);
		rows.push({ scope: account, id, total, seenAt });
	}
	if (!rows.length) return;
	memory.set(session, current);
	try {
		const db = await database();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('albums', 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error);
			const store = tx.objectStore('albums');
			for (const row of rows) store.put(row);
			const size = store.count();
			size.onsuccess = () => {
				let excess = Math.min(limit, size.result - limit);
				if (excess <= 0) return;
				const oldest = store.index('seenAt').openKeyCursor();
				oldest.onsuccess = () => {
					const cursor = oldest.result;
					if (!cursor) return;
					store.delete(cursor.primaryKey);
					if (--excess > 0) cursor.continue();
				};
			};
		});
	} catch {
		// The observed count remains available while this session is open.
	}
}

export async function albumTrackCount(session: Session, id: string) {
	const account = scope(session);
	if (!account || !validId(id)) return;
	const live = memory.get(session)?.get(id);
	if (live && live.seenAt <= Date.now()) return live;
	try {
		const db = await database();
		return await new Promise<AlbumCount | undefined>((resolve, reject) => {
			const request = db.transaction('albums').objectStore('albums').get([account, id]);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const row = request.result;
				resolve(
					row?.scope === account &&
						row.id === id &&
						validTotal(row.total) &&
						Number.isSafeInteger(row.seenAt) &&
						row.seenAt > 0 &&
						row.seenAt <= Date.now()
						? { total: row.total, seenAt: row.seenAt }
						: undefined
				);
			};
		});
	} catch {
		return undefined;
	}
}
