<script lang="ts">
	import { Disc3 } from '@lucide/svelte';
	import type { Session } from '../connection';
	import { observeCover } from './coverRequests';

	let { session, path, seed }: { session: Session; path?: string; seed: string } = $props();
	let element: HTMLSpanElement;
	let source = $state('');
	let hue = $derived(
		[...seed].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 360
	);

	$effect(() => {
		const src = path,
			account = session;
		let unsubscribe: (() => void) | undefined;
		source = '';
		if (!src) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((e) => e.isIntersecting)) return;
				observer.disconnect();
				unsubscribe = observeCover(account, src, (data) => (source = data));
			},
			{ rootMargin: '100px' }
		);
		observer.observe(element);
		return () => {
			unsubscribe?.();
			observer.disconnect();
		};
	});
</script>

<span
	class="cover"
	data-part="cover"
	bind:this={element}
	style:--cover-hue={hue}
	aria-hidden="true"
>
	{#if source}<img src={source} alt="" onerror={() => (source = '')} />{:else}<Disc3
			size="42%"
			strokeWidth={1.1}
		/>{/if}
</span>

<style>
	.cover {
		display: grid;
		place-items: center;
		width: 100%;
		aspect-ratio: 1;
		overflow: hidden;
		border-radius: var(--radius);
		background: linear-gradient(
			145deg,
			oklch(50% 0.1 var(--cover-hue)),
			oklch(28% 0.07 var(--cover-hue))
		);
		color: color-mix(in srgb, white 50%, transparent);
	}
	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
