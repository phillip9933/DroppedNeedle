import { onMount } from 'svelte';
import type { Session } from '../connection';
import type { OfflineInventory } from '../offline/library';
import { offlineInventory, offlineSupported, watchOfflineMedia } from '../offline/media';
import { errorMessage } from './catalog';

export type DetailInventory = {
	readonly inventory?: OfflineInventory;
	readonly storageError: string;
	retryStorage(): void;
};

// A collection and all of its rows share the same device read. Media events may arrive in a burst.
export function detailInventory(session: () => Session, active: () => boolean) {
	let inventory = $state.raw<OfflineInventory>(),
		storageError = $state(''),
		revision = $state(0);
	let account = '',
		visible = $state(!document.hidden);
	onMount(() => {
		const changed = () => (visible = !document.hidden);
		document.addEventListener('visibilitychange', changed);
		return () => document.removeEventListener('visibilitychange', changed);
	});
	$effect(() => {
		const current = session(),
			key = JSON.stringify([current.serverUrl, current.userId]);
		void revision;
		if (key !== account) {
			account = key;
			inventory = undefined;
			storageError = '';
		}
		if (!active() || !visible || !offlineSupported || !current.userId) return;
		let live = true,
			reading = false,
			queued = false;
		async function refresh() {
			if (reading) {
				queued = true;
				return;
			}
			reading = true;
			do {
				queued = false;
				try {
					const result = await offlineInventory(current);
					if (live) {
						inventory = result;
						storageError = '';
					}
				} catch (cause) {
					if (live) storageError = errorMessage(cause);
				}
			} while (live && queued);
			reading = false;
		}
		const stop = watchOfflineMedia(refresh);
		void refresh();
		return () => {
			live = false;
			stop();
		};
	});
	return {
		get inventory() {
			return inventory;
		},
		get storageError() {
			return storageError;
		},
		retryStorage() {
			revision++;
		}
	};
}
