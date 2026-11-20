import { getContext, setContext, untrack, onMount } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { PlayerTrack } from '../player';

export type LibraryChoice = {
	id: string;
	title: string;
	tracks: (signal: AbortSignal, forQueue: boolean) => Promise<PlayerTrack[]> | PlayerTrack[];
};
export function trackChoice(track: PlayerTrack, id = 'track:' + track.id): LibraryChoice {
	return { id, title: track.title, tracks: () => [track] };
}

const key = Symbol('library selection');
const backKey = Symbol('library selection back');
type BackHandler = () => boolean;
export function librarySelectionBack() {
	const handlers = new SvelteSet<BackHandler>();
	setContext(backKey, handlers);
	return () => [...handlers].some((dismiss) => dismiss());
}
export function onLibrarySelectionBack(dismiss: BackHandler) {
	const handlers = getContext<Set<BackHandler> | undefined>(backKey);
	onMount(() => {
		handlers?.add(dismiss);
		return () => handlers?.delete(dismiss);
	});
}

export class LibrarySelection {
	selecting = $state(false);
	busy = $state(false);
	message = $state('');
	readonly selected = new SvelteMap<string, LibraryChoice>();
	readonly buttons = new SvelteMap<HTMLElement, LibraryChoice>();

	constructor(
		readonly enabled: () => boolean,
		readonly loaded: () => LibraryChoice[] | undefined = () => undefined,
		readonly modeled: () => boolean = () => false
	) {
		setContext(key, this);
	}

	listed() {
		const model = this.loaded();
		if (model) return model;
		return [...this.buttons]
			.filter(([node]) => node.getClientRects().length)
			.sort(([left], [right]) =>
				left === right
					? 0
					: left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING
						? -1
						: 1
			)
			.map(([, item]) => item);
	}
	toggle(item: LibraryChoice) {
		if (this.busy || !this.enabled()) return;
		this.message = '';
		this.selecting = true;
		if (this.selected.has(item.id)) this.selected.delete(item.id);
		else this.selected.set(item.id, item);
	}
	close() {
		this.selected.clear();
		this.selecting = false;
	}
}

export function useLibrarySelection() {
	const group = getContext<LibrarySelection | undefined>(key);
	return function selectable(node: HTMLButtonElement, initial?: LibraryChoice) {
		if (!group) return;
		let choice = $state.raw(initial),
			timer: ReturnType<typeof setTimeout> | undefined;
		let swallow = false,
			x = 0,
			y = 0;
		function stop() {
			clearTimeout(timer);
		}
		function start(e: PointerEvent) {
			stop();
			swallow = false;
			if (!group!.enabled() || !choice || group!.selecting || e.button !== 0 || !e.isPrimary)
				return;
			x = e.clientX;
			y = e.clientY;
			timer = setTimeout(() => {
				if (choice) {
					group!.toggle(choice);
					swallow = true;
				}
			}, 500);
		}
		function move(e: PointerEvent) {
			if (Math.hypot(e.clientX - x, e.clientY - y) > 10) stop();
		}
		function click(e: Event) {
			if (!choice || (!group!.selecting && !swallow)) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			if (!swallow) group!.toggle(choice);
			swallow = false;
		}
		function menu(e: Event) {
			if (choice) e.preventDefault();
		}
		$effect(() => {
			const item = choice;
			if (!item) return;
			const listeners = new AbortController(),
				opts = { signal: listeners.signal };
			node.addEventListener('pointerdown', start, opts);
			node.addEventListener('pointermove', move, opts);
			for (const event of ['pointerup', 'pointercancel', 'pointerleave'])
				node.addEventListener(event, stop, opts);
			node.addEventListener('click', click, { ...opts, capture: true });
			node.addEventListener('contextmenu', menu, opts);
			group.buttons.set(node, item);
			return () => {
				stop();
				listeners.abort();
				group.buttons.delete(node);
				if (!group.modeled() && untrack(() => group.selected.has(item.id)))
					queueMicrotask(() => {
						if (![...group.buttons.values()].some((v) => v.id === item.id))
							group.selected.delete(item.id);
					});
			};
		});
		$effect(() => {
			const item = choice;
			if (!item || !group.selecting) return;
			const previous = node.getAttribute('aria-label');
			node.setAttribute('aria-label', 'Select ' + item.title);
			node.setAttribute('aria-pressed', String(group.selected.has(item.id)));
			node.dataset.selecting = '';
			return () => {
				delete node.dataset.selecting;
				node.removeAttribute('aria-pressed');
				if (previous === null) node.removeAttribute('aria-label');
				else node.setAttribute('aria-label', previous);
			};
		});
		return {
			update(value?: LibraryChoice) {
				choice = value;
			}
		};
	};
}
