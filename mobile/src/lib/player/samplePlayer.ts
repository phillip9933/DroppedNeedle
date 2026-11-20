import { readable } from 'svelte/store';
import type { PlayerState } from '../player';
import type { Session } from '../connection';

export const sampleSession: Session = { serverUrl: '', token: '', displayName: 'Preview' };
export const samplePlayer = readable<PlayerState>({
	tracks: ['Track 1', 'Track Title', 'Track 3', 'Track 4'].map((title, i) => ({
		id: String(i),
		title,
		artist: 'Artist Name',
		album: 'Album Title',
		streamUrl: '',
		duration: 238
	})),
	index: 1,
	playing: true,
	position: 84,
	duration: 238,
	repeat: 'off',
	error: null
});
