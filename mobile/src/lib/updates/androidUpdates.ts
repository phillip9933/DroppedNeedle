import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface AndroidUpdatePreferences {
	channel: 'stable' | 'beta';
	automaticChecks: boolean;
	wifiDownload: boolean;
}

export interface AndroidUpdateState extends AndroidUpdatePreferences {
	supported: boolean;
	installedVersion: string;
	checking: boolean;
	downloading: boolean;
	bytesDownloaded: number;
	ready: boolean;
	offer: boolean;
	lastChecked: number;
	error: string | null;
	canInstall: boolean;
	available: { tag: string; version: string; sizeBytes: number; notes?: string } | null;
}

type TaggedRelease = { tag: string };

interface AndroidUpdates {
	getState(): Promise<AndroidUpdateState>;
	check(): Promise<void>;
	setPreferences(settings: Partial<AndroidUpdatePreferences>): Promise<void>;
	download(release: TaggedRelease): Promise<void>;
	cancelDownload(): Promise<void>;
	dismiss(release: TaggedRelease): Promise<void>;
	install(release: TaggedRelease): Promise<void>;
	openInstallSettings(): Promise<void>;
	addListener(
		event: 'updateState',
		callback: (state: AndroidUpdateState) => void
	): Promise<PluginListenerHandle>;
}

export const nativeUpdates = registerPlugin<AndroidUpdates>('DNUpdates');

export function watchAndroidUpdates(
	receive: (state: AndroidUpdateState) => void,
	onerror: (error: unknown) => void
) {
	let active = true;
	let revision = 0;
	const listener = nativeUpdates.addListener('updateState', (state) => {
		if (!active) return;
		revision++;
		receive(state);
	});

	async function refresh() {
		if (!active) return;
		const read = ++revision;
		try {
			const state = await nativeUpdates.getState();
			if (active && revision === read) receive(state);
		} catch (error) {
			if (active && revision === read) onerror(error);
		}
	}

	void listener.then(refresh, refresh);
	function visible() {
		if (document.visibilityState === 'visible') void refresh();
	}
	document.addEventListener('visibilitychange', visible);
	return {
		refresh,
		stop() {
			active = false;
			document.removeEventListener('visibilitychange', visible);
			void listener.then((handle) => handle.remove()).catch(() => {});
		}
	};
}
