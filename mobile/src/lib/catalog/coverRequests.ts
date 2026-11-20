import { getArtwork, type Session } from '../connection';
import { cachedValue, storeValue } from '../offline/viewedMedia';
import { mediaChanged, preferredOffline } from '../offline/media';

// Capacitor's native transport does not share the browser's per-host request pool.
const pending = new WeakMap<Session, Map<string, CoverRequest>>();
const waiting = new Set<CoverRequest>();
type CoverRequest = {
	start: () => Promise<void>;
	listeners: Set<(source: string) => void>;
	source?: string;
};
const freshFor = 7 * 24 * 60 * 60 * 1000;
let offlineModes = new WeakMap<Session, Promise<boolean>>();
window.addEventListener(mediaChanged, () => {
	offlineModes = new WeakMap();
});
function offlineOnly(session: Session) {
	const pending = offlineModes.get(session);
	if (pending) return pending;
	const mode = preferredOffline(session).catch(() => false);
	offlineModes.set(session, mode);
	return mode;
}
let running = 0;
function drain() {
	for (const request of waiting) {
		if (running >= 4) break;
		waiting.delete(request);
		running++;
		void request.start().finally(() => {
			running--;
			drain();
		});
	}
}

export function observeCover(session: Session, path: string, receive: (source: string) => void) {
	const entries = pending.get(session) ?? new Map<string, CoverRequest>();
	pending.set(session, entries);
	let request = entries.get(path);
	if (!request) {
		const listeners = new Set<(source: string) => void>();
		const job: CoverRequest = {
			listeners,
			start: async () => {
				try {
					const cached = await cachedValue(session, 'artwork', path).catch(() => undefined);
					if (cached?.source) {
						job.source = cached.source;
						for (const listener of listeners) listener(cached.source);
						if (Date.now() - (cached.fetched ?? 0) < freshFor) return;
					}
					if (!navigator.onLine || !listeners.size || (await offlineOnly(session))) return;
					const source = await getArtwork(session, path);
					job.source = source;
					for (const listener of listeners) listener(source);
					if (cached) await storeValue(session, 'artwork', path, source, cached.revision);
				} catch {
					// Cover keeps its local artwork placeholder when the server has no image.
				} finally {
					entries.delete(path);
				}
			}
		};
		request = job;
		entries.set(path, request);
		waiting.add(request);
	}
	request.listeners.add(receive);
	if (request.source) receive(request.source);
	drain();
	return () => {
		request.listeners.delete(receive);
		if (!request.listeners.size && waiting.delete(request)) entries.delete(path);
	};
}
