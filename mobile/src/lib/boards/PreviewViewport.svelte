<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { boardDisplay, measurePreview, type Preview } from './display';
	import type { Section } from './layout';
	let {
		section,
		children,
		expanded = false
	}: { section: Section; expanded?: boolean; children: Snippet<[Preview]> } = $props();
	let width = $state(0);
	function measured(next: number | undefined) {
		if (next && next > 0) width = next;
	}
	const preview = $derived(
		measurePreview(boardDisplay(section.id, section.display), width, expanded)
	);
	let host: HTMLElement;
	let visible = $state(false);
	onMount(() => {
		if (expanded || typeof IntersectionObserver === 'undefined') {
			visible = true;
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					visible = true;
					observer.disconnect();
				}
			},
			{ root: host.closest('main'), rootMargin: '160px 0px' }
		);
		observer.observe(host);
		return () => observer.disconnect();
	});
</script>

<div
	bind:this={host}
	bind:clientWidth={null, measured}
	class:pending={!visible}
	data-preview={preview.layout}
	data-collection={expanded ? 'expanded' : 'inline'}
	data-density={preview.density}
	data-column-size={preview.columnSize}
	style:--preview-columns={preview.visibleColumns}
	style:--preview-rows={preview.rows}
>
	{#if visible && width > 0}{@render children(preview)}{/if}
</div>

<style>
	[data-preview] {
		--preview-gap: 10px;
		--preview-padding: 8px;
		--preview-height: 54px;
		--preview-art: 44px;
	}
	[data-density='compact'] {
		--preview-gap: 6px;
		--preview-padding: 3px;
		--preview-height: 44px;
		--preview-art: 38px;
	}
	[data-density='spacious'] {
		--preview-gap: 16px;
		--preview-padding: 12px;
		--preview-height: 68px;
		--preview-art: 54px;
	}
	[data-column-size='small'] {
		--preview-column-max: 136px;
		--preview-art-scale: 0.82;
	}
	[data-column-size='medium'] {
		--preview-column-max: 192px;
		--preview-art-scale: 1;
	}
	[data-column-size='large'] {
		--preview-column-max: 268px;
		--preview-art-scale: 1.25;
	}
	[data-preview='list'] :global(.preview-items) {
		grid-template-columns: repeat(var(--preview-columns), minmax(0, 1fr));
	}
	[data-preview='grid'] :global(.preview-items) {
		grid-template-columns: repeat(var(--preview-columns), minmax(0, var(--preview-column-max)));
	}
	[data-preview] :global(.preview-items) {
		display: grid;
		gap: var(--preview-gap);
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.pending {
		min-height: min(65vh, calc(var(--preview-height) * var(--preview-rows)));
	}
	.pending[data-preview='grid'] {
		min-height: min(65vh, calc(9rem * var(--preview-rows)));
	}
</style>
