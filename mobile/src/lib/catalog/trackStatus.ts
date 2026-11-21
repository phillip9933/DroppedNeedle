import { Cloud, Download } from '@lucide/svelte';

export type TrackStatus = 'offline' | 'online';
export const trackStatusLabels = { offline: 'Available offline', online: 'Online only' };
export const trackStatusIcons = { offline: Download, online: Cloud };
