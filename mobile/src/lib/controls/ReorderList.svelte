<script lang="ts">
	import { uiText } from '../i18n';
	import { onDestroy, tick, type Snippet } from 'svelte';
	import { ArrowDown, ArrowUp, GripVertical } from '@lucide/svelte';
	import PlaylistDialog from '../catalog/PlaylistDialog.svelte';

	let {
		count,
		offset = 0,
		order,
		move,
		children
	}: {
		count: number;
		offset?: number;
		order: () => string;
		move: (from: number, to: number, expected: string) => Promise<boolean>;
		children: Snippet<[Snippet<[number, string, boolean]>]>;
	} = $props();
	const help = $props.id();
	type Entry = { index: number; title: string; order: string };
	let list: HTMLDivElement;
	let picker = $state<Entry | null>(null);
	let position = $state<number | undefined>();
	let message = $state(''),
		showMessage = $state(false);
	let cancelDrag: (() => void) | undefined;
	let suppressPointerClick = false;
	onDestroy(() => cancelDrag?.());

	function entry(index: number, title: string): Entry {
		showMessage = false;
		return { index, title, order: order() };
	}
	async function commit(item: Entry, to: number, focus: boolean) {
		const originalFocus = document.activeElement;
		const source = list.querySelector(
			'[data-reorder-row="' + item.index + '"] [data-reorder-grip]'
		);
		picker = null;
		if (item.order !== order()) {
			message = 'The list changed. Choose the track again.';
			showMessage = true;
			return;
		}
		if (!Number.isInteger(to) || to < 0 || to >= count || item.index === to) return;
		if (!(await move(item.index, to, item.order))) return;
		showMessage = false;
		message = 'Moved ' + item.title + ' to position ' + (offset + to + 1) + '.';
		if (focus) {
			await tick();
			if (
				!list?.getClientRects().length ||
				![document.body, originalFocus, source].includes(document.activeElement)
			)
				return;
			const handle = list?.querySelector<HTMLButtonElement>(
				'[data-reorder-row="' + to + '"] [data-reorder-grip]'
			);
			if (!handle) showMessage = true;
			(handle ?? list?.querySelector<HTMLElement>('[role="status"]'))?.focus({
				preventScroll: !handle
			});
		}
	}
	function start(event: PointerEvent, index: number, title: string) {
		if (!event.isPrimary || event.button !== 0) return;
		cancelDrag?.();
		suppressPointerClick = false;
		const handle = event.currentTarget as HTMLButtonElement;
		const source = handle.closest<HTMLElement>('[data-reorder-row]');
		if (!source || handle.disabled) return;
		const item = entry(index, title),
			id = event.pointerId;
		const scroll = list.closest<HTMLElement>('[data-gesture-scroll], main');
		let x = event.clientX,
			y = event.clientY,
			moved = false,
			frame = 0;
		let destination: HTMLElement | null = null;
		const listeners = new AbortController(),
			signal = listeners.signal;
		function target() {
			const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-reorder-row]');
			return row && list.contains(row) ? row : null;
		}
		function paint() {
			const next = target();
			if (next === destination) return;
			if (destination) delete destination.dataset.reorderDrop;
			destination = next;
			if (next && next !== source)
				next.dataset.reorderDrop = Number(next.dataset.reorderRow) < index ? 'before' : 'after';
		}
		function scrollFrame() {
			if (!scroll) return;
			const bounds = scroll.getBoundingClientRect();
			if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
				const delta = y < bounds.top + 42 ? -10 : y > bounds.bottom - 42 ? 10 : 0;
				if (delta) {
					scroll.scrollTop += delta;
					paint();
				}
			}
			frame = requestAnimationFrame(scrollFrame);
		}
		function finish(allowClick = false) {
			listeners.abort();
			cancelAnimationFrame(frame);
			if (destination) delete destination.dataset.reorderDrop;
			if (source) delete source.dataset.reorderDragging;
			if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
			cancelDrag = undefined;
			suppressPointerClick = !allowClick;
		}
		function dismiss(e: Event) {
			e.preventDefault();
			e.stopImmediatePropagation();
			finish();
		}
		handle.setPointerCapture(id);
		cancelDrag = () => finish();
		handle.addEventListener(
			'pointermove',
			(e) => {
				if (e.pointerId !== id) return;
				x = e.clientX;
				y = e.clientY;
				if (!moved) {
					if (Math.hypot(x - event.clientX, y - event.clientY) < 5) return;
					moved = true;
					if (source) source.dataset.reorderDragging = '';
					frame = requestAnimationFrame(scrollFrame);
				}
				paint();
			},
			{ signal }
		);
		handle.addEventListener(
			'pointerup',
			(e) => {
				if (e.pointerId !== id) return;
				x = e.clientX;
				y = e.clientY;
				const row = moved && handle.isConnected && !handle.disabled ? target() : null;
				finish(!moved);
				if (row) void commit(item, Number(row.dataset.reorderRow), false);
			},
			{ signal }
		);
		handle.addEventListener('pointercancel', () => finish(), { signal });
		document.addEventListener(
			'lostpointercapture',
			(e) => {
				if (e.pointerId === id) finish();
			},
			{ capture: true, signal }
		);
		document.addEventListener(
			'visibilitychange',
			() => {
				if (document.hidden) finish();
			},
			{ signal }
		);
		window.addEventListener('blur', () => finish(), { signal });
		window.addEventListener('dn-back', dismiss, { capture: true, signal });
		window.addEventListener(
			'keydown',
			(e) => {
				if (e.key === 'Escape') dismiss(e);
			},
			{ capture: true, signal }
		);
	}
</script>

{#snippet grip(index: number, title: string, disabled: boolean)}
	<button
		type="button"
		class="grip"
		data-reorder-grip
		data-layout-drag
		disabled={disabled || count < 2}
		aria-label={'Reorder ' + title + ', position ' + (offset + index + 1)}
		aria-describedby={help}
		aria-haspopup="dialog"
		aria-keyshortcuts="ArrowUp ArrowDown"
		title={uiText('Drag to reorder or tap to choose a position')}
		onpointerdown={(e) => start(e, index, title)}
		onkeydown={(e) => {
			if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
			e.preventDefault();
			if (!e.repeat) void commit(entry(index, title), index + (e.key === 'ArrowUp' ? -1 : 1), true);
		}}
		onclick={(e) => {
			if (e.detail && suppressPointerClick) {
				suppressPointerClick = false;
				return;
			}
			picker = entry(index, title);
			position = offset + index + 1;
		}}><GripVertical size={20} aria-hidden="true" /></button
	>
{/snippet}

<div bind:this={list}>
	<span id={help} hidden
		>{uiText('Drag to reorder, use the arrow keys, or activate to choose a position.')}</span
	>
	<p class:sr-only={!showMessage} class:notice={showMessage} role="status" tabindex="-1">
		{message}
	</p>
	{@render children(grip)}
</div>
{#if picker}
	<PlaylistDialog title={'Move ' + picker.title} onclose={() => (picker = null)}>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				if (picker && position !== undefined) void commit(picker, position - offset - 1, true);
			}}
		>
			<label
				>{uiText('Track position (')}{offset + 1}–{offset + count})
				<input
					type="number"
					inputmode="numeric"
					min={offset + 1}
					max={offset + count}
					step="1"
					required
					bind:value={position}
				/>
			</label>
			<div class="actions">
				<button
					type="button"
					class="secondary"
					disabled={picker.index === 0}
					aria-label={'Move ' + picker.title + ' up'}
					onclick={() => picker && commit(picker, picker.index - 1, true)}
					><ArrowUp size={16} /> {uiText('Up')}</button
				>
				<button
					type="button"
					class="secondary"
					disabled={picker.index + 1 === count}
					aria-label={'Move ' + picker.title + ' down'}
					onclick={() => picker && commit(picker, picker.index + 1, true)}
					><ArrowDown size={16} /> {uiText('Down')}</button
				>
			</div>
			<div class="actions">
				<button type="button" class="text-button" onclick={() => (picker = null)}
					>{uiText('Cancel')}</button
				>
				<button
					type="submit"
					class="primary"
					disabled={!Number.isInteger(position) ||
						position! <= offset ||
						position! > offset + count ||
						position === offset + picker.index + 1}>{uiText('Move track')}</button
				>
			</div>
		</form>
	</PlaylistDialog>
{/if}

<style>
	.notice {
		position: sticky;
		top: 0;
		z-index: 1;
		margin: 0;
		padding: 0.6rem;
		background: var(--surface);
		color: var(--text);
		border-bottom: 1px solid var(--line);
	}
	.grip {
		display: inline-grid;
		place-items: center;
		min-width: 44px;
		min-height: 44px;
		padding: 0;
		color: var(--muted);
		touch-action: none;
		user-select: none;
		cursor: grab;
	}
	div :global([data-reorder-dragging]) {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}
	div :global([data-reorder-dragging] [data-reorder-grip]) {
		cursor: grabbing;
		color: var(--accent);
	}
	div :global([data-reorder-drop='before']) {
		box-shadow: inset 0 3px var(--accent);
	}
	div :global([data-reorder-drop='after']) {
		box-shadow: inset 0 -3px var(--accent);
	}
</style>
