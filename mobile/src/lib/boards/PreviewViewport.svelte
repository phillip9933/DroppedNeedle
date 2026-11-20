<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { boardDisplay, boardPreview, type Preview } from './display';
	import type { Section } from './layout';
	let {
		section,
		children,
		expanded = false
	}: { section: Section; expanded?: boolean; children: Snippet<[Preview]> } = $props();
	const preview = $derived(
		boardPreview(boardDisplay(section.id, section.display, section.filter?.kind), expanded)
	);
	let host: HTMLElement;
	let visible = $state(false);
	onMount(() => {
		const root = host.closest('main');
		const listeners = new AbortController();
		let observer: IntersectionObserver | undefined;
		let resize: ResizeObserver | undefined;
		function stop() {
			listeners.abort();
			observer?.disconnect();
			resize?.disconnect();
		}
		function show() {
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
		if (expanded && host.clientWidth > 0) {
			show();
			return;
		}
		// A dozing WebView can lay out a visible shelf before it delivers an intersection.
		check();
		if (visible) return;
		resize = new ResizeObserver(check);
		resize.observe(host);
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
	class:pending={!visible}
	data-preview={preview.layout}
	data-collection={expanded ? 'expanded' : 'inline'}
	data-density={preview.density}
	style:--preview-columns={preview.visibleColumns}
	style:--column-intervals={Math.max(1, preview.visibleColumns - 1)}
	style:--preview-rows={preview.rows}
>
	{#if visible}{@render children(preview)}{/if}
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
	[data-preview] :global(.preview-items) {
		display: grid;
		grid-template-columns: repeat(var(--preview-columns), minmax(0, 1fr));
		row-gap: var(--preview-gap);
		column-gap: clamp(
			0px,
			calc((100% - 44px * var(--preview-columns)) / var(--column-intervals)),
			var(--preview-gap)
		);
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.pending {
		min-height: min(65vh, calc(var(--preview-height) * var(--preview-rows)));
	}
	.pending[data-preview='grid'] {
		min-height: min(65vh, calc((100vw / var(--preview-columns) + 2rem) * var(--preview-rows)));
	}
</style>
