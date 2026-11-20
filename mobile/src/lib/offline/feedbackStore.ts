import type { OfflineAccount, OfflineItem } from './tracks';

export type FeedbackField = 'favorite' | 'rating';
export type FeedbackValue = boolean | number;
export type FeedbackRecord = {
	scope: string;
	id: string;
	field: FeedbackField;
	value: FeedbackValue;
	revision: string;
	state: 'pending' | 'blocked' | 'confirmed';
};

export const feedbackScope = (s: OfflineAccount) =>
	s.userId ? JSON.stringify([s.serverUrl, s.userId]) : '';
export const feedbackChanged = 'dn-track-feedback';
export function notifyFeedback(record: FeedbackRecord, metadataChanged = false) {
	window.dispatchEvent(new CustomEvent(feedbackChanged, { detail: record }));
	if (metadataChanged) window.dispatchEvent(new Event('dn-offline-media'));
}
const leaseMs = 90_000;
let opening: Promise<IDBDatabase> | undefined;
function db() {
	if (!opening)
		opening = new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('dn.mobile.track-feedback', 1);
			request.onupgradeneeded = () => {
				request.result
					.createObjectStore('edits', { keyPath: ['scope', 'id', 'field'] })
					.createIndex('scope', 'scope');
				request.result.createObjectStore('leases');
			};
			request.onsuccess = () => {
				const connection = request.result;
				connection.onversionchange = () => {
					connection.close();
					opening = undefined;
				};
				resolve(connection);
			};
			request.onerror = () => {
				opening = undefined;
				reject(request.error);
			};
		});
	return opening;
}
const read = <T>(r: IDBRequest<T>) =>
	new Promise<T>((ok, bad) => {
		r.onsuccess = () => ok(r.result);
		r.onerror = () => bad(r.error);
	});
async function tx<T>(
	name: 'edits' | 'leases',
	mode: IDBTransactionMode,
	action: (store: IDBObjectStore) => Promise<T>
) {
	const transaction = (await db()).transaction(name, mode);
	const completion = new Promise<void>((ok, bad) => {
		transaction.oncomplete = () => ok();
		transaction.onabort = () => bad(transaction.error ?? Error('Could not save your track edit.'));
	});
	try {
		const value = await action(transaction.objectStore(name));
		await completion;
		return value;
	} catch (cause) {
		try {
			transaction.abort();
		} catch {
			/* The request may already have aborted. */
		}
		await completion.catch(() => {});
		throw cause;
	}
}
export function feedbackRows(scope: string): Promise<FeedbackRecord[]> {
	if (!scope) return Promise.resolve([]);
	return tx('edits', 'readonly', (s) => read(s.index('scope').getAll(scope)));
}
export function trackFeedback(scope: string, id: string): Promise<FeedbackRecord[]> {
	if (!scope) return Promise.resolve([]);
	return tx('edits', 'readonly', (s) =>
		read(s.getAll(IDBKeyRange.bound([scope, id, ''], [scope, id, '\uffff'])))
	);
}
export async function overlayFeedback(account: OfflineAccount, items: OfflineItem[]) {
	if (!items.length) return items;
	const byID = new Map<string, Partial<{ favorite: boolean; rating: number }>>();
	for (const row of await feedbackRows(feedbackScope(account))) {
		const patch = byID.get(row.id) ?? {};
		if (row.field === 'favorite' && typeof row.value === 'boolean') patch.favorite = row.value;
		if (row.field === 'rating' && typeof row.value === 'number') patch.rating = row.value;
		byID.set(row.id, patch);
	}
	return items.map((item) =>
		byID.has(item.track.id)
			? { ...item, track: { ...item.track, ...byID.get(item.track.id) } }
			: item
	);
}
export async function writeFeedback(
	scope: string,
	id: string,
	field: FeedbackField,
	value: FeedbackValue
) {
	const record: FeedbackRecord = {
		scope,
		id,
		field,
		value,
		state: 'pending',
		revision: crypto.randomUUID()
	};
	await tx('edits', 'readwrite', (s) => read(s.put(record)));
	return record;
}
export async function settleFeedback(
	record: FeedbackRecord,
	state: FeedbackRecord['state'],
	value = record.value
) {
	return tx('edits', 'readwrite', async (s) => {
		const current: FeedbackRecord | undefined = await read(
			s.get([record.scope, record.id, record.field])
		);
		if (current?.revision !== record.revision) return;
		const result = { ...record, state, value };
		await read(s.put(result));
		return result;
	});
}
// A delayed GET cannot overwrite a newer edit, including one already acknowledged by DN.
export async function confirmedFeedback(
	scope: string,
	id: string,
	field: FeedbackField,
	value: FeedbackValue,
	observed: FeedbackRecord | undefined
) {
	if (!scope) return value;
	let updated: FeedbackRecord | undefined;
	const accepted = await tx('edits', 'readwrite', async (s) => {
		const current: FeedbackRecord | undefined = await read(s.get([scope, id, field]));
		if (!current) return value;
		if (
			current.state === 'confirmed' &&
			observed?.state === 'confirmed' &&
			current.revision === observed.revision &&
			current.value !== value
		) {
			updated = { ...current, value, revision: crypto.randomUUID() };
			await read(s.put(updated));
			return value;
		}
		return current.value;
	});
	if (updated) notifyFeedback(updated, true);
	return accepted;
}
export function takeLease(scope: string, owner: string) {
	return tx('leases', 'readwrite', async (s) => {
		const current: { owner: string; expires: number } | undefined = await read(s.get(scope));
		const now = Date.now();
		if (
			current &&
			current.owner !== owner &&
			current.expires > now &&
			current.expires <= now + leaseMs * 2
		)
			return false;
		await read(s.put({ owner, expires: now + leaseMs }, scope));
		return true;
	});
}
export async function releaseLease(scope: string, owner: string) {
	await tx('leases', 'readwrite', async (s) => {
		const lease = await read(s.get(scope));
		if (lease?.owner === owner) await read(s.delete(scope));
	});
}
