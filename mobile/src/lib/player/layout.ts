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

export function playerDefaults() {
	return playerWidgets
		.filter((w) => w.id !== 'player-up-next')
		.map((w) => ({ id: w.id, title: '', preview: w.enabled }));
}
