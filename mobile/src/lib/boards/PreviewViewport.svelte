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
	let checkViewport: (() => void) | undefined;
	function measured(next: number | undefined) {
		if (next && next > 0) {
			width = next;
			checkViewport?.();
		}
	}
	const preview = $derived(
		measurePreview(boardDisplay(section.id, section.display, section.filter?.kind), width, expanded)
	);
	let host: HTMLElement;
	let visible = $state(false);
	onMount(() => {
		const root = host.closest('main');
		const listeners = new AbortController();
		let observer: IntersectionObserver | undefined;
		function stop() {
			checkViewport = undefined;
			listeners.abort();
			observer?.disconnect();
		}
		function show() {
			width = host.clientWidth || width;
			visible = true;
			stop();
		}
		function check() {
			const box = host.getBoundingClientRect(),
				frame = root?.getBoundingClientRect();
			const top = Math.max(0, frame?.top ?? 0),
				left = Math.max(0, frame?.left ?? 0);
			const bottom = Math.min(window.innerHeight, frame?.bottom ?? window.innerHeight);
			const right = Math.min(window.innerWidth, frame?.right ?? window.innerWidth);
			if (
				box.height &&
				box.width &&
				Math.min(box.bottom, bottom) > Math.max(box.top, top) &&
				Math.min(box.right, right) > Math.max(box.left, left)
			)
				show();
		}
		if (expanded) {
			show();
			return;
		}
		// A dozing WebView can lay out a visible shelf before it delivers an intersection.
		checkViewport = check;
		check();
		if (visible) return;
		const options = { signal: listeners.signal };
		document.addEventListener(
			'visibilitychange',
			() => {
				if (!document.hidden) check();
			},
			options
		);
		window.addEventListener('pageshow', check, options);
		window.addEventListener('focus', check, options);
		if (typeof IntersectionObserver !== 'undefined') {
			observer = new IntersectionObserver(
				(entries) => {
					if (entries.some((e) => e.isIntersecting)) show();
				},
				{ root, rootMargin: '160px 0px' }
			);
			observer.observe(host);
		} else {
			(root ?? window).addEventListener('scroll', check, { ...options, passive: true });
		}
		return stop;
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
