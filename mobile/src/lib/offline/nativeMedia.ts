import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { OfflineBridge } from './web';

type Account = { serverUrl: string; userId: string };
export type HistoryStatus = { enabled: boolean; pending: number };
export const nativeMedia = registerPlugin<
	OfflineBridge & {
		historySettings(owner: Account): Promise<HistoryStatus>;
		setOfflineHistory(change: Account & { enabled: boolean }): Promise<HistoryStatus>;
		discardOfflineHistory(owner: Account): Promise<HistoryStatus>;
		addListener(
			event: 'historyChanged' | 'mediaChanged',
			update: () => void
		): Promise<PluginListenerHandle>;
	}
>('DNOffline');
