import type { Section } from '../boards/layout';
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
	{ id: 'player-menu', label: 'Navigation menu' },
	{ id: 'player-close', label: 'Close player' },
	{ id: 'player-settings', label: 'Player settings' },
	{ id: 'player-queue', label: 'Play queue' },
	{ id: 'player-output', label: 'Cast and audio output' }
] as const;
export type NavigationId = (typeof navigationFields)[number]['id'];
export function isNavigation(id: string): id is NavigationId {
	return navigationFields.some((action) => action.id === id);
}
export function showsNavigationMenu(section: Section) {
	return section.id === 'player-menu' && !(section.icon === 'none' && section.showLabel === false);
}
export const trackToolFields = [
	{ id: 'player-favorite', label: 'Favorite' },
	{ id: 'player-playlist', label: 'Add to playlist' },
	{ id: 'player-download', label: 'Offline download' },
	{ id: 'player-rating', label: 'Track rating' },
	{ id: 'player-quality', label: 'Audio quality' }
] as const;
export const playerFields = [
	...navigationFields,
	{ id: 'player-heading', label: 'Player heading' },
	{ id: 'player-sleep', label: 'Sleep timer' },
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

const bounds = {
	width: [1, 12],
	contentWidth: [20, 100],
	minHeight: [0, 640],
	gap: [0, 32],
	padding: [0, 32],
	iconSize: [12, 64],
	maxLines: [0, 8]
} as const;
type Measurement = keyof typeof bounds;
export const playerMeasurements = Object.keys(bounds) as Measurement[];
export function validMeasurement(name: Measurement, value: unknown): value is number {
	const [min, max] = bounds[name];
	return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export const playerIconOptions = [
	{ id: 'default', label: 'Default' },
	{ id: 'none', label: 'No icon' },
	{ id: 'play', label: 'Play' },
	{ id: 'circle-play', label: 'Circle play' },
	{ id: 'square-play', label: 'Square play' },
	{ id: 'skip-back', label: 'Previous' },
	{ id: 'skip-forward', label: 'Next' },
	{ id: 'rewind', label: 'Rewind' },
	{ id: 'fast-forward', label: 'Fast forward' },
	{ id: 'shuffle', label: 'Shuffle' },
	{ id: 'repeat', label: 'Repeat' },
	{ id: 'heart', label: 'Heart' },
	{ id: 'star', label: 'Star' },
	{ id: 'disc', label: 'Record' },
	{ id: 'music', label: 'Music note' },
	{ id: 'user-round', label: 'Artist' },
	{ id: 'album', label: 'Album' },
	{ id: 'type', label: 'Text' },
	{ id: 'list', label: 'Queue' },
	{ id: 'plus', label: 'Add' },
	{ id: 'download', label: 'Download' },
	{ id: 'settings', label: 'Sliders' },
	{ id: 'cast', label: 'Cast' },
	{ id: 'chevron-down', label: 'Chevron' },
	{ id: 'volume', label: 'Speaker' }
] as const;
export type PlayerIcon = (typeof playerIconOptions)[number]['id'];
export function isPlayerIcon(value: unknown): value is PlayerIcon {
	return playerIconOptions.some((i) => i.id === value);
}
export function isPlayerText(id: string) {
	return /^player-text(?:-(?:[2-9]|[1-9]\d+))?$/.test(id);
}
export function isPlayerMetadata(id: string) {
	return (
		['player-title', 'player-artist', 'player-album', 'player-heading'].includes(id) ||
		isPlayerText(id)
	);
}
export function supportsPlayerIcon(id: string) {
	return (
		isPlayerMetadata(id) ||
		isNavigation(id) ||
		[
			'player-previous',
			'player-toggle',
			'player-next',
			'player-repeat',
			'player-shuffle',
			'player-favorite',
			'player-playlist',
			'player-download',
			'player-sleep',
			'player-rating',
			'player-up-next',
			'player-lyrics',
			'player-tools'
		].includes(id)
	);
}
export function supportsPlayerLines(id: string) {
	return id === 'player-track' || isPlayerMetadata(id);
}
export function playerDefaults(): Section[] {
	return playerWidgets
		.filter((w) => w.id !== 'player-up-next')
		.flatMap<Section>((w) =>
			w.id === 'player-track'
				? ['player-title', 'player-artist', 'player-album'].map((id) => ({
						id,
						title: '',
						preview: true,
						padding: 0
					}))
				: w.id === 'player-modes'
					? [
							{ id: w.id, title: '', preview: w.enabled },
							{ id: 'player-sleep', title: '', preview: true }
						]
					: [{ id: w.id, title: '', preview: w.enabled }]
		);
}
