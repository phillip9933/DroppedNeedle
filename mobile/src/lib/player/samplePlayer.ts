import { readable } from 'svelte/store';
import type { PlayerState } from '../player';
import type { Session } from '../connection';

export const sampleSession: Session = { serverUrl: '', token: '', displayName: 'Preview' };
export const samplePlayer = readable<PlayerState>({
	tracks: ['Low Water', 'Soft Current', 'Night Ferry', 'Shorebirds'].map((title, i) => ({
		id: String(i),
		title,
		artist: 'Northline',
		album: 'Tidal Memory',
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
