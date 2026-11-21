import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { PlayerTrack } from '../player';
import type { OfflineBridge } from './web';

type Account = { serverUrl: string; userId: string };
export type HistoryStatus = { enabled: boolean; pending: number };
export type DownloadNotificationState = 'appOff' | 'appOn' | 'channelOff' | 'on';
export type ManualStatus = {
	state:
		'idle' | 'queued' | 'downloading' | 'waitingNetwork' | 'waitingOffline' | 'failed' | 'complete';
	total: number;
	saved: number;
	pending: number;
	failed: number;
	lastError: string;
	current?: Pick<PlayerTrack, 'id' | 'title' | 'artist'>;
	failures?: Array<Pick<PlayerTrack, 'id' | 'title' | 'artist'> & { reason: string }>;
};
export const nativeMedia = registerPlugin<
	OfflineBridge & {
		companion(
			owner: Account & { kind: 'artwork' | 'lyrics'; key: string }
		): Promise<{ source?: string }>;
		refreshMetadata(owner: Account & { observedIds: string[] }): Promise<{
			updated: number;
			unavailable: number;
			confirmed?: Record<string, { rating?: number; favorite?: boolean }>;
		}>;
		diagnostics(owner: Account): Promise<{ text: string }>;
		shareDiagnostics(input: Account & { text: string }): Promise<void>;
		saveDiagnostics(input: Account & { text: string }): Promise<{ saved: boolean }>;
		enqueueManual(batch: Account & { tracks: PlayerTrack[] }): Promise<{
			saved: number;
			queued: number;
			alreadyQueued: number;
			failed: number;
			status: ManualStatus;
		}>;
		syncCollections(owner: Account): Promise<{ saved: number; message?: string }>;
		manualStatus(owner: Account): Promise<ManualStatus>;
		takeDownloadNotification(): Promise<{ open: boolean }>;
		downloadNotificationSettings(): Promise<{ state: DownloadNotificationState }>;
		openDownloadNotificationSettings(): Promise<void>;
		cancelManual(owner: Account): Promise<ManualStatus>;
		retryManual(owner: Account): Promise<ManualStatus>;
		historySettings(owner: Account): Promise<HistoryStatus>;
		setOfflineHistory(change: Account & { enabled: boolean }): Promise<HistoryStatus>;
		discardOfflineHistory(owner: Account): Promise<HistoryStatus>;
		addListener(
			event: 'historyChanged' | 'mediaChanged' | 'manualChanged',
			update: () => void
		): Promise<PluginListenerHandle>;
	}
>('DNOffline');
