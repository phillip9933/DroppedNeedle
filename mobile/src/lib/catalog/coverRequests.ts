import { getArtwork, type Session } from '../connection';

// Capacitor's native transport does not share the browser's per-host request pool.
const pending = new WeakMap<Session, Map<string, CoverRequest>>();
const waiting = new Set<CoverRequest>();
type CoverRequest = {
	start: () => Promise<void>;
	listeners: Set<(source: string) => void>;
};
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
		request = {
			listeners,
			start: async () => {
				try {
					const source = await getArtwork(session, path);
					for (const listener of listeners) listener(source);
				} catch {
					// Cover keeps its local artwork placeholder when the server has no image.
				} finally {
					entries.delete(path);
				}
			}
		};
		entries.set(path, request);
		waiting.add(request);
	}
	request.listeners.add(receive);
	drain();
	return () => {
		request.listeners.delete(receive);
		if (!request.listeners.size && waiting.delete(request)) entries.delete(path);
	};
}
