<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
	let host: HTMLElement;
	let visible = $state(false);
	onMount(() => {
		if (typeof IntersectionObserver === 'undefined') {
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

<div bind:this={host} class:pending={!visible}>
	{#if visible}{@render children()}{/if}
</div>

<style>
	.pending {
		min-height: 5rem;
	}
</style>
