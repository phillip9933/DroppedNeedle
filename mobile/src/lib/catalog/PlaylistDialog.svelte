<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	let {
		title,
		onclose,
		busy = false,
		children
	}: {
		title: string;
		onclose: () => void;
		busy?: boolean;
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

<dialog bind:this={dialog} aria-label={title} oncancel={dismiss} data-part="playlist-dialog">
	<h2>{title}</h2>
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
