import { get, writable } from 'svelte/store';
import { tick } from 'svelte';
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
export const maxTabs = 5;
export type InterfacePreferences = {
	surface: 'web' | 'glass' | 'simple';
	blur: number;
	bar: 'docked' | 'floating';
	tabs: Destination[];
	headerSettings: boolean;
	motion: 'off' | 'quick' | 'gentle';
};
const key = 'dn.mobile.interface.v1';
export const defaultInterface: InterfacePreferences = {
	surface: 'web',
	blur: 14,
	bar: 'docked',
	tabs: ['home', 'library', 'search', 'discover', 'requests'],
	headerSettings: true,
	motion: 'quick'
};
function normalize(value: Partial<InterfacePreferences> | null): InterfacePreferences {
	const valid = (id: unknown): id is Destination => destinations.some((d) => d.id === id);
	return {
		surface: value?.surface === 'glass' || value?.surface === 'simple' ? value.surface : 'web',
		blur:
			typeof value?.blur === 'number' && Number.isInteger(value.blur)
				? Math.min(24, Math.max(0, value.blur))
				: defaultInterface.blur,
		bar: value?.bar === 'floating' ? 'floating' : 'docked',
		tabs: Array.isArray(value?.tabs)
			? [...new Set(value.tabs.filter(valid))].slice(0, maxTabs)
			: [...defaultInterface.tabs],
		headerSettings: value?.headerSettings !== false,
		motion: value?.motion === 'off' || value?.motion === 'gentle' ? value.motion : 'quick'
	};
}
function restore() {
	try {
		return normalize(JSON.parse(localStorage.getItem(key) || 'null'));
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
		root.style.setProperty('--glass-blur', p.blur + 'px');
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
