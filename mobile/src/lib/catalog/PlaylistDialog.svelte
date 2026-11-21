<script lang="ts">
	import { ChevronLeft } from '@lucide/svelte';
	import { uiText } from '../i18n';
	import { onMount, type Snippet } from 'svelte';
	let {
		title,
		onclose,
		busy = false,
		page = false,
		children
	}: {
		title: string;
		onclose: () => void;
		busy?: boolean;
		page?: boolean;
		children: Snippet;
	} = $props();
	let dialog: HTMLDialogElement;
	function dismiss(event: Event) {
		event.preventDefault();
		event.stopImmediatePropagation();
		if (!busy) onclose();
	}
	onMount(() => {
		dialog.showModal();
		function key(event: KeyboardEvent) {
			if (event.key === 'Escape') dismiss(event);
		}
		window.addEventListener('dn-back', dismiss, true);
		window.addEventListener('keydown', key, true);
		return () => {
			window.removeEventListener('dn-back', dismiss, true);
			window.removeEventListener('keydown', key, true);
			dialog.close();
		};
	});
</script>

<dialog
	class:page
	bind:this={dialog}
	aria-label={title}
	oncancel={dismiss}
	data-part="playlist-dialog"
>
	<header>
		{#if page}<button
				type="button"
				class="icon-button"
				aria-label={uiText('Back')}
				disabled={busy}
				onclick={onclose}><ChevronLeft size={23} /></button
			>{/if}
		<h2>{title}</h2>
	</header>
	{@render children()}
</dialog>

<style>
	dialog {
		width: min(calc(100% - 2rem), 26rem);
		max-height: 80dvh;
		padding: 1.25rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		color: var(--text);
		background: var(--surface);
	}
	dialog.page {
		inset: 0;
		box-sizing: border-box;
		margin: 0;
		width: 100%;
		height: 100dvh;
		max-width: none;
		max-height: none;
		border: 0;
		border-radius: 0;
		overflow-y: auto;
		background: var(--bg);
		padding: env(safe-area-inset-top)
			max(var(--gap), calc((100% - 36rem) / 2), env(safe-area-inset-right))
			calc(var(--gap) + env(safe-area-inset-bottom))
			max(var(--gap), calc((100% - 36rem) / 2), env(safe-area-inset-left));
	}
	.page header {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding-block: 0.35rem;
	}
	.page h2 {
		margin: 0;
	}
	dialog::backdrop {
		background: color-mix(in srgb, var(--bg) 76%, transparent);
	}
	h2 {
		margin: 0 0 1rem;
	}
	dialog :global(.actions) {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 1rem;
	}
	dialog :global(label) {
		display: grid;
		gap: 0.3rem;
		margin-block: 0.65rem;
	}
	dialog :global(select),
	dialog :global(input) {
		width: 100%;
		min-width: 0;
	}
</style>
