<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { ArrowLeft } from '@lucide/svelte';
	const offsets = new SvelteMap<string, number>();
	let {
		title,
		context = '',
		backLabel = 'Back',
		busy = false,
		onback,
		children
	}: {
		title: string;
		context?: string;
		backLabel?: string;
		busy?: boolean;
		onback: () => void;
		children: Snippet;
	} = $props();
	let dialog: HTMLDialogElement, body: HTMLElement, heading: HTMLHeadingElement;
	onMount(() => {
		dialog.showModal();
		function dismiss(e: Event) {
			e.preventDefault();
			e.stopImmediatePropagation();
			if (!busy) onback();
		}
		function key(e: KeyboardEvent) {
			if (e.key === 'Escape') dismiss(e);
		}
		window.addEventListener('dn-back', dismiss, true);
		window.addEventListener('keydown', key, true);
		return () => {
			window.removeEventListener('dn-back', dismiss, true);
			window.removeEventListener('keydown', key, true);
			dialog.close();
		};
	});
	$effect(() => {
		const current = title;
		void tick().then(() => {
			body?.scrollTo(0, offsets.get(current) ?? 0);
			heading?.focus({ preventScroll: true });
		});
		return () => {
			if (body) offsets.set(current, body.scrollTop);
		};
	});
</script>

<dialog
	bind:this={dialog}
	aria-label={title}
	oncancel={(e) => {
		e.preventDefault();
		if (!busy) onback();
	}}
>
	<header>
		<button class="icon-button" aria-label={backLabel} disabled={busy} onclick={onback}
			><ArrowLeft size={21} /></button
		>
		<div>
			<h2 tabindex="-1" bind:this={heading}>{title}</h2>
			{#if context}<small>{context}</small>{/if}
		</div>
	</header>
	<div class="body" bind:this={body}>{@render children()}</div>
</dialog>

<style>
	dialog {
		width: min(100%, 36rem);
		height: min(100%, 52rem);
		max-width: 100%;
		max-height: 100dvh;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		color: var(--text);
		background: var(--bg);
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
	}
	dialog::backdrop {
		background: color-mix(in srgb, var(--bg) 78%, transparent);
	}
	header {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.65rem var(--gap);
		border-bottom: 1px solid var(--line);
		background: var(--surface);
	}
	h2 {
		margin: 0;
		font-size: 1.2rem;
		overflow-wrap: anywhere;
	}
	small {
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.body {
		padding: var(--gap);
		overflow: auto;
		overscroll-behavior: contain;
	}
	@media (max-width: 36rem) {
		dialog {
			width: 100%;
			height: 100dvh;
			border: 0;
			border-radius: 0;
		}
		header {
			padding-top: max(0.65rem, env(safe-area-inset-top));
		}
		.body {
			padding-bottom: max(var(--gap), env(safe-area-inset-bottom));
		}
	}
</style>
