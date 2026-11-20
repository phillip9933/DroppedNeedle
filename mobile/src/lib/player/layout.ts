export const playerWidgets = [
	{ id: 'player-artwork', label: 'Artwork', option: 'Use large artwork', enabled: true },
	{ id: 'player-track', label: 'Track details', option: 'Show album title', enabled: true },
	{
		id: 'player-timeline',
		label: 'Playback position',
		option: 'Show elapsed and total time',
		enabled: true
	},
	{
		id: 'player-transport',
		label: 'Playback controls',
		option: 'Use a large play button',
		enabled: true
	},
	{ id: 'player-modes', label: 'Playback modes', option: 'Show button labels', enabled: true },
	{ id: 'player-lyrics', label: 'Lyrics', option: 'Start expanded', enabled: false },
	{ id: 'player-tools', label: 'Track tools', option: 'Start expanded', enabled: false },
	{ id: 'player-up-next', label: 'Up next', option: 'Show upcoming tracks', enabled: true }
] as const;

export const navigationFields = [
	{ id: 'player-close', label: 'Close player' },
	{ id: 'player-settings', label: 'Player settings' },
	{ id: 'player-queue', label: 'Play queue' },
	{ id: 'player-output', label: 'Cast and audio output' }
] as const;
export type NavigationId = (typeof navigationFields)[number]['id'];
export function isNavigation(id: string): id is NavigationId {
	return navigationFields.some((action) => action.id === id);
}
export function navigationPlacement(
	id: NavigationId,
	sections: readonly { id: string; placement?: 'header-start' | 'header-end' | 'hidden' }[]
) {
	const action = sections.find((s) => s.id === id);
	return action
		? (action.placement ?? 'canvas')
		: id === 'player-close'
			? 'header-start'
			: 'header-end';
}

export const trackToolFields = [
	{ id: 'player-favorite', label: 'Favorite' },
	{ id: 'player-playlist', label: 'Add to playlist' },
	{ id: 'player-rating', label: 'Track rating' },
	{ id: 'player-quality', label: 'Audio quality' }
] as const;
export const playerFields = [
	...navigationFields,
	...trackToolFields,
	{ id: 'player-seek', label: 'Seek bar' },
	{ id: 'player-title', label: 'Track title' },
	{ id: 'player-artist', label: 'Artist' },
	{ id: 'player-album', label: 'Album' },
	{ id: 'player-text', label: 'Custom text' },
	{ id: 'player-elapsed', label: 'Elapsed time' },
	{ id: 'player-duration', label: 'Duration' },
	{ id: 'player-remaining', label: 'Remaining time' },
	{ id: 'player-previous', label: 'Previous track' },
	{ id: 'player-toggle', label: 'Play or pause' },
	{ id: 'player-next', label: 'Next track' },
	{ id: 'player-repeat', label: 'Repeat' },
	{ id: 'player-shuffle', label: 'Shuffle upcoming' }
] as const;

export function playerDefaults() {
	return playerWidgets
		.filter((w) => w.id !== 'player-up-next')
		.map((w) => ({ id: w.id, title: '', preview: w.enabled }));
}
