import { get, writable } from 'svelte/store';
import { tick } from 'svelte';
import type { Session } from '../connection';
import {
	House,
	LibraryBig,
	Compass,
	Search,
	ListChecks,
	Download,
	Settings2
} from '@lucide/svelte';

export const destinations = [
	{ id: 'home', label: 'Home', icon: House },
	{ id: 'library', label: 'Library', icon: LibraryBig },
	{ id: 'search', label: 'Search', icon: Search },
	{ id: 'discover', label: 'Discover', icon: Compass },
	{ id: 'requests', label: 'Requests', icon: ListChecks },
	{ id: 'offline', label: 'Offline music', icon: Download },
	{ id: 'settings', label: 'Settings', icon: Settings2 }
] as const;
export type Destination = (typeof destinations)[number]['id'];
export type BrowseDestination = Exclude<Destination, 'settings'>;
export type StartScreen = 'automatic' | 'home' | 'library' | 'player';
function accountKey(session: Session, name: 'start-screen' | 'mini-player') {
	return 'dn.mobile.' + name + '.v1.' + JSON.stringify([session.serverUrl, session.userId]);
}
export function readStartScreen(session: Session): StartScreen {
	try {
		const saved = session.userId && localStorage.getItem(accountKey(session, 'start-screen'));
		return saved === 'home' || saved === 'library' || saved === 'player' ? saved : 'automatic';
	} catch {
		return 'automatic';
	}
}
export function saveStartScreen(session: Session, screen: StartScreen) {
	if (!session.userId) return;
	const key = accountKey(session, 'start-screen');
	if (screen === 'automatic') localStorage.removeItem(key);
	else localStorage.setItem(key, screen);
}
export const miniButtons = {
	none: 'None',
	previous: 'Previous track',
	next: 'Next track',
	queue: 'Queue'
} as const;
export const miniText = {
	artist: 'Artist',
	album: 'Album',
	'artist-album': 'Artist and album',
	hidden: 'Hidden'
} as const;
export type MiniButton = keyof typeof miniButtons;
export type MiniPlayerPreferences = {
	artwork: boolean;
	secondary: keyof typeof miniText;
	progress: boolean;
	before: MiniButton;
	after: MiniButton;
};
export const defaultMiniPlayer: MiniPlayerPreferences = {
	artwork: true,
	secondary: 'artist',
	progress: false,
	before: 'none',
	after: 'next'
};
export function readMiniPlayer(session: Session | null): MiniPlayerPreferences {
	if (!session?.userId) return defaultMiniPlayer;
	try {
		const value = JSON.parse(
			localStorage.getItem(accountKey(session, 'mini-player')) || 'null'
		) as Partial<MiniPlayerPreferences> | null;
		if (!value) return defaultMiniPlayer;
		const before =
			typeof value.before === 'string' && Object.hasOwn(miniButtons, value.before)
				? value.before
				: defaultMiniPlayer.before;
		const after =
			typeof value.after === 'string' && Object.hasOwn(miniButtons, value.after)
				? value.after
				: defaultMiniPlayer.after;
		return {
			artwork: value.artwork !== false,
			secondary:
				typeof value.secondary === 'string' && Object.hasOwn(miniText, value.secondary)
					? value.secondary
					: defaultMiniPlayer.secondary,
			progress: value.progress === true,
			before,
			after: before === after ? 'none' : after
		};
	} catch {
		return defaultMiniPlayer;
	}
}
export function saveMiniPlayer(session: Session, value: MiniPlayerPreferences) {
	if (session.userId)
		localStorage.setItem(accountKey(session, 'mini-player'), JSON.stringify(value));
}
export const maxTabs = 5;
export type InterfacePreferences = {
	surface: 'solid' | 'glass' | 'blur';
	blur: number;
	bar: 'docked' | 'floating';
	tabs: Destination[];
	headerSettings: boolean;
	swipeTracks: boolean;
	motion: 'off' | 'quick' | 'gentle';
};
const key = 'dn.mobile.interface.v2';
const legacyKey = 'dn.mobile.interface.v1';
export const defaultInterface: InterfacePreferences = {
	surface: 'solid',
	blur: 14,
	bar: 'docked',
	tabs: ['home', 'library', 'search', 'discover', 'requests'],
	headerSettings: true,
	swipeTracks: true,
	motion: 'quick'
};
function normalize(value: Partial<InterfacePreferences> | null): InterfacePreferences {
	const valid = (id: unknown): id is Destination => destinations.some((d) => d.id === id);
	return {
		surface: value?.surface === 'glass' || value?.surface === 'blur' ? value.surface : 'solid',
		blur:
			typeof value?.blur === 'number' && Number.isInteger(value.blur)
				? Math.min(24, Math.max(0, value.blur))
				: defaultInterface.blur,
		bar: value?.bar === 'floating' ? 'floating' : 'docked',
		tabs: Array.isArray(value?.tabs)
			? [...new Set(value.tabs.filter(valid))].slice(0, maxTabs)
			: [...defaultInterface.tabs],
		headerSettings: value?.headerSettings !== false,
		swipeTracks: value?.swipeTracks !== false,
		motion: value?.motion === 'off' || value?.motion === 'gentle' ? value.motion : 'quick'
	};
}
function restore() {
	try {
		const current = localStorage.getItem(key);
		if (current !== null) return normalize(JSON.parse(current));
		const previous = JSON.parse(localStorage.getItem(legacyKey) || 'null');
		// The earlier Glass style used the listener's adjustable backdrop blur.
		return normalize({ ...previous, surface: previous?.surface === 'glass' ? 'blur' : 'solid' });
	} catch {
		return normalize(null);
	}
}
export const interfacePreferences = writable(restore());
export function setInterface(changes: Partial<InterfacePreferences>) {
	const next = normalize({ ...get(interfacePreferences), ...changes });
	localStorage.setItem(key, JSON.stringify(next));
	interfacePreferences.set(next);
}
let animation: Animation | undefined;
let departure: Animation | undefined;
let visit = 0;

function duration() {
	const motion = get(interfacePreferences).motion;
	if (document.hidden || motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches)
		return 0;
	return motion === 'gentle' ? 280 : 160;
}

export function applyInterface() {
	const unsubscribe = interfacePreferences.subscribe((p) => {
		const root = document.documentElement;
		root.dataset.material = p.surface;
		root.dataset.navigation = p.bar;
		root.dataset.motion = p.motion;
		root.style.setProperty('--material-blur', p.blur + 'px');
	});
	// Fade the outgoing screen on press. A tap commits the route immediately,
	// including when two navigation actions arrive in the same frame.
	function press(event: Event) {
		if (!(event.target instanceof Element) || !event.target.closest('[data-screen-link]')) return;
		if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
		const main = document.querySelector('main'),
			ms = duration();
		if (!main?.animate || !ms) return;
		animation?.cancel();
		departure?.cancel();
		departure = main.animate([{ opacity: 1 }, { opacity: 0.45 }], {
			duration: ms * 0.45,
			easing: 'ease-in',
			fill: 'forwards'
		});
	}
	function release() {
		const current = departure;
		// pointerup fires before click. Also restore a press dragged off its target.
		requestAnimationFrame(() => {
			if (current === departure) {
				departure?.cancel();
				departure = undefined;
			}
		});
	}
	window.addEventListener('pointerdown', press);
	window.addEventListener('keydown', press);
	window.addEventListener('pointerup', release);
	window.addEventListener('pointercancel', release);
	window.addEventListener('keyup', release);
	return () => {
		unsubscribe();
		window.removeEventListener('pointerdown', press);
		window.removeEventListener('keydown', press);
		window.removeEventListener('pointerup', release);
		window.removeEventListener('pointercancel', release);
		window.removeEventListener('keyup', release);
	};
}

export function changeScreen(update: () => void) {
	const id = ++visit;
	departure?.cancel();
	departure = undefined;
	animation?.cancel();
	update();
	const ms = duration();
	if (!ms) return;
	void tick().then(() => {
		if (id !== visit) return;
		animation = document
			.querySelector('main')
			?.animate?.([{ opacity: 0.35 }, { opacity: 1 }], { duration: ms * 0.7, easing: 'ease-out' });
	});
}
