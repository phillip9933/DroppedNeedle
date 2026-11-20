import { Capacitor, registerPlugin } from '@capacitor/core';
import { writable } from 'svelte/store';
import { browserPlayer } from './player/browser';

export interface PlayerTrack {
	id: string;
	title: string;
	artist: string;
	album: string;
	streamUrl: string;
	artworkUrl?: string;
	duration?: number;
}

export interface PlayerAccess {
	serverUrl: string;
	token: string;
}

export interface PlayerState {
	tracks: PlayerTrack[];
	index: number;
	playing: boolean;
	position: number;
	duration: number;
	error: string | null;
}

export type PlayerAction = 'toggle' | 'seek' | 'skipTo' | 'next' | 'previous' | 'clear';
export interface PlaybackBridge {
	setQueue(options: PlayerAccess & { tracks: PlayerTrack[]; index: number }): Promise<PlayerState>;
	command(options: { action: PlayerAction; value?: number }): Promise<PlayerState>;
	getState(): Promise<PlayerState>;
}

const empty: PlayerState = {
	tracks: [],
	index: -1,
	playing: false,
	position: 0,
	duration: 0,
	error: null
};
const backend = Capacitor.isNativePlatform()
	? registerPlugin<PlaybackBridge>('DNPlayer')
	: browserPlayer();
let sequence = 0;
const state = writable(empty, () => {
	const timer = setInterval(() => {
		if (!document.hidden) void refresh();
	}, 1000);
	document.addEventListener('visibilitychange', refresh);
	void refresh();
	return () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', refresh);
	};
});

async function update(operation: () => Promise<PlayerState>) {
	const ticket = ++sequence;
	try {
		const next = await operation();
		if (ticket === sequence) state.set(next);
	} catch (error) {
		if (ticket === sequence) {
			state.update((s) => ({
				...s,
				error: error instanceof Error ? error.message : 'Playback failed.'
			}));
		}
		throw error;
	}
}

async function refresh() {
	if (document.hidden) return;
	try {
		await update(() => backend.getState());
	} catch {
		// The next foreground poll reconnects after a service interruption.
	}
}

function command(action: PlayerAction, value?: number) {
	return update(() => backend.command({ action, value }));
}

function mediaUrl(base: URL, address: string, prefix: string) {
	const url = new URL(address.replace(/^\/(?!\/)/, ''), base);
	if (
		url.origin !== base.origin ||
		url.username ||
		url.password ||
		!url.pathname.startsWith(base.pathname + prefix)
	) {
		throw new Error('The media address is outside this DroppedNeedle library.');
	}
	return url.href;
}

export const player = {
	subscribe: state.subscribe,
	async setQueue(tracks: PlayerTrack[], index: number, access: PlayerAccess) {
		if (!Number.isInteger(index) || index < 0 || index >= tracks.length)
			throw new Error('Choose a track to play.');
		const base = new URL(access.serverUrl);
		if (
			base.protocol !== 'https:' ||
			!access.token ||
			base.username ||
			base.password ||
			base.search ||
			base.hash
		) {
			throw new Error('Playback requires a secure DroppedNeedle connection.');
		}
		base.pathname = base.pathname.replace(/\/?$/, '/');
		const queue = tracks.map((track) => ({
			...track,
			streamUrl: mediaUrl(base, track.streamUrl, 'api/v3/stream/local/'),
			artworkUrl: track.artworkUrl ? mediaUrl(base, track.artworkUrl, 'api/v3/') : undefined
		}));
		return update(() => backend.setQueue({ ...access, tracks: queue, index }));
	},
	toggle: () => command('toggle'),
	seek: (seconds: number) => command('seek', seconds),
	skipTo: (index: number) => command('skipTo', index),
	next: () => command('next'),
	previous: () => command('previous'),
	clear: () => command('clear')
};
