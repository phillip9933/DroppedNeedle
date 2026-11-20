import { getContext, setContext, untrack, onMount } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { selectionDrag } from './selectionDrag';
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
	readonly drag = selectionDrag();
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
	beginRange(anchor: LibraryChoice) {
		if (this.busy || !this.enabled()) return;
		let choices = this.listed();
		const index = (id: string) => choices.findIndex((item) => item.id === id);
		const origin = index(anchor.id);
		if (origin < 0) return;
		const prior = new SvelteSet(this.selected.keys());
		const adding = !prior.has(anchor.id);
		let last = origin;
		this.toggle(anchor);
		return (target: HTMLElement) => {
			const choice = this.buttons.get(target);
			if (!choice || !this.selecting || !this.enabled()) return;
			let end = index(choice.id);
			if (end < 0) {
				choices = this.listed(); // A cursor page may have arrived during auto-scroll.
				end = index(choice.id);
			}
			if (end < 0 || end === last) return;
			const low = Math.min(origin, end),
				high = Math.max(origin, end);
			for (let i = Math.min(last, end); i <= Math.max(last, end); i++) {
				const item = choices[i];
				if (i >= low && i <= high ? adding : prior.has(item.id)) this.selected.set(item.id, item);
				else this.selected.delete(item.id);
			}
			last = end;
		};
	}
	close() {
		this.drag.stop();
		this.selected.clear();
		this.selecting = false;
	}
}

export function useLibrarySelection() {
	const group = getContext<LibrarySelection | undefined>(key);
	return function selectable(node: HTMLButtonElement, initial?: LibraryChoice) {
		if (!group) return;
		let choice = $state.raw(initial);
		function start(event: PointerEvent | TouchEvent) {
			if (!choice || !group!.enabled() || group!.busy) return;
			const anchor = choice;
			group!.drag.start(node, event, () => group!.beginRange(anchor));
		}
		function click(e: Event) {
			if (!choice || !group!.enabled() || !group!.selecting) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			group!.toggle(choice);
		}
		function menu(e: Event) {
			if (choice && group!.enabled()) e.preventDefault();
		}
		$effect(() => {
			const item = choice;
			if (!item || !group.enabled()) return;
			const listeners = new AbortController(),
				opts = { signal: listeners.signal };
			node.addEventListener('pointerdown', start, opts);
			node.addEventListener('touchstart', start, { ...opts, passive: true });
			node.dataset.selectable = '';
			node.addEventListener('click', click, { ...opts, capture: true });
			node.addEventListener('contextmenu', menu, opts);
			group.buttons.set(node, item);
			return () => {
				delete node.dataset.selectable;
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
