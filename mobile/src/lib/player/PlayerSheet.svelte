<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { ArrowLeft, X } from '@lucide/svelte';
	import { pullSheet } from '../controls/pullSheet';
	let {
		title,
		onclose,
		context = '',
		backLabel,
		closeLabel,
		scrollKey,
		busy = false,
		fullScreen = false,
		children
	}: {
		title: string;
		onclose: () => void;
		context?: string;
		backLabel?: string;
		closeLabel?: string;
		scrollKey?: string;
		busy?: boolean;
		fullScreen?: boolean;
		children: Snippet;
	} = $props();
	let dialog: HTMLDialogElement;
	let closeButton: HTMLButtonElement, heading: HTMLHeadingElement, content: HTMLElement;
	let scrolled = $state(false);
	let pull: ReturnType<typeof pullSheet> | undefined;
	let backdropPointer: number | undefined;
	const offsets = new SvelteMap<string, number>();
	// Returning from a review step restores the previous list position.
	$effect.pre(() => {
		const page = scrollKey;
		if (page === undefined) return;
		void tick().then(() => {
			content?.scrollTo(0, offsets.get(page) ?? 0);
			heading?.focus({ preventScroll: true });
		});
		return () => {
			if (content) offsets.set(page, content.scrollTop);
		};
	});
	$effect(() => {
		void title;
		if (dialog?.open && !dialog.contains(document.activeElement))
			closeButton.focus({ preventScroll: true });
	});
	$effect(() => {
		if (busy) pull?.reset();
	});
	function topmost() {
		return Array.from(document.querySelectorAll('dialog[open]')).at(-1) === dialog;
	}
	function dismiss(event: Event) {
		if (!topmost()) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		pull?.close();
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
		(scrollKey !== undefined ? heading : closeButton).focus({ preventScroll: true });
		pull = pullSheet(dialog, { enabled: () => !busy && topmost(), dismiss: () => onclose() });
		window.addEventListener('dn-back', dismiss, true);
		return () => {
			window.removeEventListener('dn-back', dismiss, true);
			pull?.destroy();
			pull = undefined;
			dialog.close();
			const remaining = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
			if (
				opener instanceof HTMLElement &&
				opener.isConnected &&
				(!remaining || remaining.contains(opener))
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
	oncancel={dismiss}
	onpointerdown={(e) => {
		if (e.isPrimary) backdropPointer = e.button === 0 && backdrop(e) ? e.pointerId : undefined;
	}}
	onpointerup={(e) => {
		if (e.pointerId === backdropPointer && backdrop(e)) pull?.close();
		if (e.isPrimary) backdropPointer = undefined;
	}}
	onpointercancel={(e) => {
		if (e.isPrimary) backdropPointer = undefined;
	}}
>
	<div class="sheet-heading" data-sheet-handle>
		<div class="grip" data-sheet-grip><span></span></div>
		<header class:drilldown={!!backLabel} class:review={scrollKey !== undefined}>
			<div class="title">
				<h2 bind:this={heading} tabindex="-1">{title}</h2>
				{#if context}<small>{context}</small>{/if}
			</div>
			<button
				class="icon-button"
				aria-label={backLabel ?? closeLabel ?? 'Close ' + title}
				bind:this={closeButton}
				disabled={busy}
				onclick={() => pull?.close()}
				>{#if backLabel}<ArrowLeft size={20} />{:else}<X size={20} />{/if}</button
			>
		</header>
	</div>
	<div
		class="sheet-content"
		class:scrolled
		class:body={scrollKey !== undefined}
		bind:this={content}
		onscroll={() => (scrolled = content.scrollTop > 1)}
	>
		{@render children()}
	</div>
</dialog>

<style>
	dialog {
		box-sizing: border-box;
		position: fixed;
		--sheet-progress: 0;
		--sheet-duration: 0ms;
		--sheet-easing: cubic-bezier(0.2, 0.75, 0.25, 1);
		transform: translateY(calc(var(--sheet-progress) * 100%));
		transition: transform var(--sheet-duration) var(--sheet-easing);
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
		will-change: transform;
	}
	dialog.full {
		height: calc(100dvh - env(safe-area-inset-top));
		max-height: calc(100dvh - env(safe-area-inset-top));
	}
	dialog::backdrop {
		background: color-mix(in srgb, var(--bg) 62%, transparent);
		opacity: calc(1 - var(--sheet-progress, 0));
		transition: opacity var(--sheet-duration, 0ms) var(--sheet-easing, ease-out);
	}
	.sheet-heading {
		touch-action: none;
		flex: none;
		user-select: none;
		cursor: grab;
	}
	.sheet-heading:active {
		cursor: grabbing;
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
	header.drilldown {
		justify-content: flex-start;
	}
	header.review,
	.sheet-content.body {
		padding-inline: min(1.2rem, 5vw);
	}
	header.review {
		gap: min(var(--gap), 4vw);
	}
	.drilldown button {
		order: -1;
	}
	.title {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	small {
		display: block;
		color: var(--muted);
		line-height: 1.35;
	}
	h2 {
		font-size: 1.15rem;
		margin: 0;
	}
	.sheet-content {
		overflow: auto;
		min-height: 0;
		overscroll-behavior: contain;
		touch-action: pan-x pan-down pinch-zoom;
		padding: 0.3rem 1.2rem 0.75rem;
	}
	.sheet-content.scrolled {
		touch-action: pan-x pan-y pinch-zoom;
	}
	.full .sheet-content {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
</style>
