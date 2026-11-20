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

export type QueuePlacement = 'next' | 'end';
export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
	repeat: RepeatMode;
	tracks: PlayerTrack[];
	index: number;
	playing: boolean;
	position: number;
	duration: number;
	error: string | null;
}

export type PlayerAction =
	| 'toggle'
	| 'seek'
	| 'skipTo'
	| 'next'
	| 'previous'
	| 'clear'
	| 'move'
	| 'remove'
	| 'shuffleUpcoming'
	| 'cycleRepeat';
export interface PlaybackBridge {
	setQueue(
		options: PlayerAccess & { tracks: PlayerTrack[]; index: number; placement?: QueuePlacement }
	): Promise<PlayerState>;
	command(options: { action: PlayerAction; value?: number; to?: number }): Promise<PlayerState>;
	getState(): Promise<PlayerState>;
}

const empty: PlayerState = {
	repeat: 'off',
	tracks: [],
	index: -1,
	playing: false,
	position: 0,
	duration: 0,
	error: null
};
const native = registerPlugin<
	PlaybackBridge & { restore(access: PlayerAccess): Promise<PlayerState> }
>('DNPlayer');
const backend = Capacitor.isNativePlatform() ? native : browserPlayer();
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

function command(action: PlayerAction, value?: number, to?: number) {
	return update(() => backend.command({ action, value, to }));
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

async function submitTracks(
	tracks: PlayerTrack[],
	index: number,
	access: PlayerAccess,
	placement?: QueuePlacement
) {
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
	return update(() => backend.setQueue({ ...access, tracks: queue, index, placement }));
}

export const player = {
	async restore(access: PlayerAccess) {
		if (Capacitor.getPlatform() === 'android') {
			await update(() => native.restore({ serverUrl: access.serverUrl, token: access.token }));
		}
	},
	subscribe: state.subscribe,
	setQueue: (tracks: PlayerTrack[], index: number, access: PlayerAccess) =>
		submitTracks(tracks, index, access),
	enqueue: (tracks: PlayerTrack[], access: PlayerAccess, placement: QueuePlacement = 'end') =>
		submitTracks(tracks, 0, access, placement),
	move: (from: number, to: number) => command('move', from, to),
	remove: (index: number) => command('remove', index),
	shuffleUpcoming: () => command('shuffleUpcoming'),
	cycleRepeat: () => command('cycleRepeat'),
	toggle: () => command('toggle'),
	seek: (seconds: number) => command('seek', seconds),
	skipTo: (index: number) => command('skipTo', index),
	next: () => command('next'),
	previous: () => command('previous'),
	clear: () => command('clear')
};
