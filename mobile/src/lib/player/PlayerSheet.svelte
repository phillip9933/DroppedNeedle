<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { X } from '@lucide/svelte';
	import { pullSheet } from '../controls/pullSheet';
	let {
		title,
		onclose,
		fullScreen = false,
		children
	}: {
		title: string;
		onclose: () => void;
		fullScreen?: boolean;
		children: Snippet;
	} = $props();
	let dialog: HTMLDialogElement;
	let closeButton: HTMLButtonElement;
	let outside = false;
	$effect(() => {
		void title;
		if (dialog?.open && !dialog.contains(document.activeElement))
			closeButton.focus({ preventScroll: true });
	});
	function topmost() {
		return Array.from(document.querySelectorAll('dialog[open]')).at(-1) === dialog;
	}
	function dismiss(event: Event) {
		if (!topmost()) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		onclose();
	}
	function backdrop(event: PointerEvent) {
		if (event.target !== dialog) return false;
		const r = dialog.getBoundingClientRect();
		return (
			event.clientY < r.top ||
			event.clientY > r.bottom ||
			event.clientX < r.left ||
			event.clientX > r.right
		);
	}
	onMount(() => {
		const opener = document.activeElement;
		dialog.showModal();
		closeButton.focus({ preventScroll: true });
		window.addEventListener('dn-back', dismiss, true);
		return () => {
			window.removeEventListener('dn-back', dismiss, true);
			dialog.close();
			if (
				opener instanceof HTMLElement &&
				opener.isConnected &&
				!document.querySelector('dialog[open]')
			)
				opener.focus({ preventScroll: true });
		};
	});
</script>

<dialog
	bind:this={dialog}
	class:full={fullScreen}
	aria-label={title}
	data-part="player-sheet"
	use:pullSheet={{ dismiss: onclose }}
	oncancel={dismiss}
	onpointerdown={(e) => (outside = backdrop(e))}
	onpointerup={(e) => {
		if (outside && backdrop(e)) onclose();
		outside = false;
	}}
	onpointercancel={() => (outside = false)}
>
	<div class="sheet-heading" data-sheet-handle>
		<div class="grip" data-sheet-grip><span></span></div>
		<header>
			<h2>{title}</h2>
			<button
				class="icon-button"
				aria-label={'Close ' + title}
				bind:this={closeButton}
				onclick={onclose}><X size={20} /></button
			>
		</header>
	</div>
	<div class="sheet-content">{@render children()}</div>
</dialog>

<style>
	dialog {
		box-sizing: border-box;
		position: fixed;
		translate: 0 var(--sheet-pull, 0px);
		inset: auto 0 0;
		width: min(100%, 36rem);
		max-width: none;
		margin: 0 auto;
		max-height: calc(100dvh - max(1rem, env(safe-area-inset-top)));
		padding: 0 0 max(0.75rem, env(safe-area-inset-bottom));
		overflow: hidden;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--line);
		border-block-end: 0;
		border-radius: max(var(--radius), 1.2rem) max(var(--radius), 1.2rem) 0 0;
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
		animation: sheet-in 160ms ease-out;
	}
	dialog.full {
		height: calc(100dvh - env(safe-area-inset-top));
		max-height: calc(100dvh - env(safe-area-inset-top));
	}
	dialog::backdrop {
		background: color-mix(in srgb, var(--bg) 62%, transparent);
	}
	.sheet-heading {
		touch-action: none;
		flex: none;
	}
	.grip {
		display: grid;
		place-items: center;
		height: 24px;
		flex: none;
		touch-action: none;
		cursor: grab;
	}
	.grip span {
		width: 36px;
		height: 4px;
		border-radius: 4px;
		background: var(--muted);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gap);
		padding: 0 0.75rem 0.3rem 1.2rem;
	}
	h2 {
		font-size: 1.15rem;
		margin: 0;
	}
	.sheet-content {
		overflow: auto;
		min-height: 0;
		overscroll-behavior: contain;
		padding: 0.3rem 1.2rem 0.75rem;
	}
	.full .sheet-content {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	@keyframes sheet-in {
		from {
			transform: translateY(28%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog[open] {
			animation: none;
		}
	}
</style>
