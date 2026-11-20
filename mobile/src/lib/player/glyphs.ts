import {
	Play,
	CirclePlay,
	SquarePlay,
	SkipBack,
	SkipForward,
	Rewind,
	FastForward,
	Shuffle,
	Repeat,
	Heart,
	Star,
	Disc3,
	Music2,
	ListMusic,
	Plus,
	SlidersHorizontal,
	Cast,
	ChevronDown,
	UserRound,
	Album,
	Type,
	Volume2
} from '@lucide/svelte';
import { isPlayerIcon, type PlayerIcon } from './layout';
const choices: Record<Exclude<PlayerIcon, 'default' | 'none'>, typeof Play> = {
	play: Play,
	'circle-play': CirclePlay,
	'square-play': SquarePlay,
	'skip-back': SkipBack,
	'skip-forward': SkipForward,
	rewind: Rewind,
	'fast-forward': FastForward,
	shuffle: Shuffle,
	repeat: Repeat,
	heart: Heart,
	star: Star,
	disc: Disc3,
	music: Music2,
	list: ListMusic,
	plus: Plus,
	settings: SlidersHorizontal,
	cast: Cast,
	'chevron-down': ChevronDown,
	'user-round': UserRound,
	album: Album,
	type: Type,
	volume: Volume2
};
export function explicitPlayerGlyph(value?: string) {
	return isPlayerIcon(value) && value !== 'default' && value !== 'none' ? choices[value] : null;
}
