import { Cloud, CloudDownload, Download, HardDrive } from '@lucide/svelte';
import { originLabels } from '../offline/library';
import type { OfflineOrigin } from '../offline/tracks';

export type TrackStatus = OfflineOrigin | 'online';
export const trackStatusLabels = { ...originLabels, online: 'Online only' };
export const trackStatusIcons = {
	downloaded: Download,
	automatic: CloudDownload,
	cached: HardDrive,
	online: Cloud
};
