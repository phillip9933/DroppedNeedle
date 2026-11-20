<script module lang="ts">
	export type DrawerControl = { readonly open: boolean; show: () => void };
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { X } from '@lucide/svelte';
	import { destinations, interfacePreferences, type Destination } from './appearance/interface';
	import Outputs from './player/Outputs.svelte';
	import { drawerSwipe } from './drawerSwipe';
	let {
		current,
		showAll,
		offline,
		shell,
		trigger,
		onnavigate,
		open = $bindable(false)
	}: {
		current?: Destination;
		showAll: boolean;
		offline: boolean;
		shell: HTMLElement;
		trigger: () => HTMLButtonElement | undefined;
		onnavigate: (id: Destination) => void;
		open?: boolean;
	} = $props();
	const entries = $derived(
		destinations.filter(
			(d) =>
				(d.id !== 'offline' || offline) &&
				(showAll ||
					d.id === 'settings' ||
					d.id === 'offline' ||
					!$interfacePreferences.tabs.includes(d.id))
		)
	);
	let dialog = $state<HTMLDialogElement>(),
		closeButton = $state<HTMLButtonElement>();
	let outside = false;
	export async function show() {
		if (open || document.querySelector('dialog[open]')) return;
		open = true;
		await tick();
		if (!open || !dialog?.isConnected) return;
		dialog.showModal();
		closeButton?.focus({ preventScroll: true });
	}
	function close(restore = true) {
		if (!open) return;
		dialog?.close();
		open = false;
		if (restore) trigger()?.focus({ preventScroll: true });
	}
	export function back() {
		if (!open) return false;
		const nested = dialog?.querySelector<HTMLDialogElement>('dialog[open]');
		if (nested) nested.dispatchEvent(new Event('cancel', { cancelable: true }));
		else close();
		return true;
	}
	function select(id: Destination) {
		close(false);
		onnavigate(id);
	}
	function onBackdrop(e: PointerEvent) {
		if (!dialog || e.target !== dialog) return false;
		const r = dialog.getBoundingClientRect();
		return e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom;
	}
	onMount(() => {
		const teardown = drawerSwipe(
			shell,
			() => dialog,
			() => {
				void show();
			},
			() => close()
		);
		function dismiss(event: Event) {
			if (back()) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		}
		window.addEventListener('dn-back', dismiss, true);
		return () => {
			teardown();
			window.removeEventListener('dn-back', dismiss, true);
			dialog?.close();
		};
	});
</script>

{#if open}
	<dialog
		id="navigation-drawer"
		aria-label="Navigation menu"
		bind:this={dialog}
		oncancel={(e) => {
			if (e.target !== dialog) return;
			e.preventDefault();
			back();
		}}
		onpointerdown={(e) => (outside = onBackdrop(e))}
		onpointerup={(e) => {
			if (outside && onBackdrop(e)) close();
			outside = false;
		}}
		onpointercancel={() => (outside = false)}
	>
		<header>
			<h2>Menu</h2>
			<button
				class="icon-button"
				aria-label="Close navigation menu"
				bind:this={closeButton}
				onclick={() => close()}><X size={21} /></button
			>
		</header>
		<nav aria-label="Menu destinations">
			{#each entries as item (item.id)}
				<button
					class="drawer-entry"
					data-screen-link
					aria-current={item.id === current ? 'page' : undefined}
					onclick={() => select(item.id)}><item.icon size={20} /><span>{item.label}</span></button
				>
			{/each}
			<Outputs drawer />
		</nav>
	</dialog>
{/if}

<style>
	dialog {
		position: fixed;
		inset: 0 auto 0 0;
		margin: 0;
		width: min(21rem, calc(100vw - 3.25rem));
		max-width: 100%;
		height: 100dvh;
		max-height: 100dvh;
		padding: max(0.75rem, env(safe-area-inset-top)) 0.75rem
			max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
		border: 0;
		border-right: 1px solid var(--dn-edge);
		color: var(--text);
		background: var(--surface);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	dialog[open] {
		animation: enter 0.18s ease-out;
	}
	@keyframes enter {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog[open] {
			animation: none;
		}
	}
	:global(html[data-motion='off']) dialog[open] {
		animation: none;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.52);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin: 0 0.35rem 0.65rem;
	}
	h2 {
		margin: 0;
		color: var(--heading);
	}
	nav {
		display: grid;
		gap: 0.18rem;
	}
	nav :global(.drawer-entry) {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		width: 100%;
		min-height: 48px;
		padding: 0.6rem 0.85rem;
		gap: 0.85rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		text-align: start;
		font-weight: 600;
	}
	nav :global(.drawer-entry:focus-visible),
	nav :global(.drawer-entry:hover) {
		background: var(--raised);
	}
	nav :global(.drawer-entry[aria-current='page']) {
		color: var(--dn-action-content);
		background: var(--dn-action);
	}
</style>
