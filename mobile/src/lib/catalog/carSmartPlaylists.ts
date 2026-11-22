import { Capacitor, registerPlugin } from '@capacitor/core';
import { accountId } from '../boards/layout';
import type { Session } from '../connection';
import { preferredOffline } from '../offline/media';
import { playbackAddresses } from '../player';
import { refillSize } from '../player/libraryWindow';
import { nativePlayer } from '../player/native';
import { readSmartPlaylists, readSmartSnapshot, smartPlaylistTracks } from './smartPlaylists';

type Account = { serverUrl: string; userId: string };
const car = registerPlugin<{
	carPlaylistIndex(
		options: Account & {
			lists: { id: string; name: string; definition: string }[];
		}
	): Promise<{ completed: Record<string, number> }>;
	carPlaylistReady(
		options: Account & {
			id: string;
			definition: string;
			snapshot: string;
			total: number;
			completedAt: number;
		}
	): Promise<void>;
}>('DNLauncher');

// Android Auto can start the media service without ever launching a WebView.
export function mirrorSmartPlaylists(session: Session) {
	if (Capacitor.getPlatform() !== 'android') return;
	const controller = new AbortController();
	const { signal } = controller;
	let running = false,
		all = true;
	const changed = new Set<string>();
	async function sync() {
		if (running || signal.aborted) return;
		running = true;
		try {
			const account = {
				serverUrl: session.serverUrl,
				userId: await accountId(session)
			};
			while (!signal.aborted && (all || changed.size)) {
				const scanAll = all,
					pending = new Set(changed);
				all = false;
				changed.clear();
				const lists = await readSmartPlaylists(session);
				const definitions = lists.map(({ id, name, ...rules }) => ({
					id,
					name,
					definition: JSON.stringify(rules)
				}));
				signal.throwIfAborted();
				const { completed } = await car.carPlaylistIndex({
					...account,
					lists: definitions
				});
				for (const [i, list] of lists.entries()) {
					if (!scanAll && !pending.has(list.id)) continue;
					try {
						let result = await readSmartSnapshot(session, list);
						if (!result && navigator.onLine && !(await preferredOffline(account))) {
							await smartPlaylistTracks(session, list, signal);
							result = await readSmartSnapshot(session, list);
						}
						if (!result || completed[list.id] === result.completedAt) continue;
						const snapshot = crypto.randomUUID(),
							total = result.tracks.length;
						for (let start = 0; start < total; start += refillSize) {
							signal.throwIfAborted();
							await nativePlayer.storeSmartPage({
								...account,
								token: session.token,
								snapshot,
								total,
								start,
								tracks: playbackAddresses(result.tracks.slice(start, start + refillSize), session)
							});
						}
						signal.throwIfAborted();
						await car.carPlaylistReady({
							...account,
							id: list.id,
							definition: definitions[i].definition,
							snapshot,
							total,
							completedAt: result.completedAt
						});
					} catch {
						if (!signal.aborted) console.warn('Could not update an Android Auto smart playlist.');
					}
				}
			}
		} catch {
			if (!signal.aborted) console.warn('Could not sync the Android Auto playlist index.');
		} finally {
			running = false;
		}
	}
	const onChange = (event: Event) => {
		const detail = (event as CustomEvent<{ serverUrl: string; userId?: string; id: string }>)
			.detail;
		if (
			detail.serverUrl !== session.serverUrl ||
			(session.userId && detail.userId !== session.userId)
		)
			return;
		changed.add(detail.id);
		void sync();
	};
	const online = () => {
		all = true;
		void sync();
	};
	window.addEventListener('dn-smart-playlist-updated', onChange);
	window.addEventListener('online', online);
	void sync();
	return () => {
		controller.abort();
		window.removeEventListener('dn-smart-playlist-updated', onChange);
		window.removeEventListener('online', online);
	};
}
