import { unreachableDn, type Session } from '../connection';
import {
	offlineSupported,
	preferredOffline,
	offlineInventory,
	watchOfflineMedia
} from '../offline/media';
import type { OfflineInventory } from '../offline/library';
import { errorMessage } from './catalog';

// Read policy before mounting online widgets. Keep an opened device collection alive through reconnect.
export function catalogSource(
	session: () => Session,
	active: () => boolean,
	keepDevice: () => boolean
) {
	let ready = $state(false),
		policyIssue = $state(''),
		forced = $state(false),
		connected = $state(navigator.onLine),
		failedConnection = $state(false),
		policyRetry = $state(0);
	let inventory = $state.raw<OfflineInventory>(),
		storageError = $state(''),
		storageBusy = $state(false),
		storageRetry = $state(0);
	const useDevice = $derived(forced || !connected || failedConnection);
	$effect(() => {
		const account = session();
		void policyRetry;
		let live = true,
			version = 0;
		ready = false;
		policyIssue = '';
		failedConnection = false;
		inventory = undefined;
		async function policy() {
			const current = ++version;
			ready = false;
			try {
				const value = offlineSupported && account.userId ? await preferredOffline(account) : false;
				if (live && version === current) {
					forced = value;
					ready = true;
					policyIssue = '';
				}
			} catch (cause) {
				if (live && version === current) {
					policyIssue = errorMessage(cause);
					ready = false;
				}
			}
		}
		const network = () => {
			connected = navigator.onLine;
			if (connected) failedConnection = false;
		};
		window.addEventListener('online', network);
		window.addEventListener('offline', network);
		window.addEventListener('dn-offline-policy', policy);
		void policy();
		return () => {
			live = false;
			window.removeEventListener('online', network);
			window.removeEventListener('offline', network);
			window.removeEventListener('dn-offline-policy', policy);
		};
	});
	$effect(() => {
		const account = session(),
			needs = useDevice || keepDevice();
		void storageRetry;
		if (!ready || !needs || !active()) return;
		let live = true,
			version = 0;
		async function read() {
			const n = ++version;
			if (!account.userId) {
				storageError = 'Reconnect to DroppedNeedle once to identify this device library.';
				storageBusy = false;
				return;
			}
			if (!offlineSupported) {
				storageError = 'Offline music is unavailable on this platform.';
				storageBusy = false;
				return;
			}
			storageBusy = true;
			storageError = '';
			try {
				const state = await offlineInventory(account);
				if (live && n === version) inventory = state;
			} catch (cause) {
				if (live && n === version) storageError = errorMessage(cause);
			} finally {
				if (live && n === version) storageBusy = false;
			}
		}
		const stop = watchOfflineMedia(read);
		void read();
		return () => {
			live = false;
			stop();
		};
	});

	return {
		get ready() {
			return ready;
		},
		get policyIssue() {
			return policyIssue;
		},
		get useDevice() {
			return useDevice;
		},
		get unreachable() {
			return failedConnection && connected && !forced;
		},
		get inventory() {
			return inventory;
		},
		get storageError() {
			return storageError;
		},
		get storageBusy() {
			return storageBusy;
		},
		retryPolicy() {
			policyRetry++;
		},
		retryStorage() {
			storageRetry++;
		},
		retryNetwork() {
			failedConnection = false;
		},
		connectionFailed(cause: unknown) {
			if (!unreachableDn(cause)) return false;
			failedConnection = true;
			return true;
		}
	};
}
