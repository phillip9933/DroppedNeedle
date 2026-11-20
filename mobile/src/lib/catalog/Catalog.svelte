<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import type { Album, CatalogTab, OnPlay } from './catalog';
	import Library from './Library.svelte';
	import Search from './Search.svelte';
	import Requests from './Requests.svelte';
	import AlbumDetail from './AlbumDetail.svelte';

	let {
		session,
		tab,
		onplay,
		onnavigate
	}: { session: Session; tab: CatalogTab; onplay: OnPlay; onnavigate: (tab: CatalogTab) => void } =
		$props();
	let album = $state<Album | null>(null),
		term = $state('');
	function open(item: Album) {
		album = item;
		window.scrollTo(0, 0);
	}
	function back() {
		album = null;
	}
	function systemBack(event: Event) {
		if (album) {
			event.preventDefault();
			back();
		}
	}
	onMount(() => {
		window.addEventListener('dn-back', systemBack);
		return () => window.removeEventListener('dn-back', systemBack);
	});
	function showRequests() {
		back();
		onnavigate('requests');
	}
</script>

<section class="catalog" data-part="catalog">
	{#if album}
		{#key album}<AlbumDetail
				{album}
				{session}
				{onplay}
				onback={back}
				onrequests={showRequests}
			/>{/key}
	{:else if tab === 'library'}<Library {session} onopen={open} />
	{:else if tab === 'search'}<Search {session} onopen={open} {onplay} bind:term />
	{:else}<Requests {session} onopen={open} />{/if}
</section>

<style>
	.catalog {
		min-width: 0;
	}
	.catalog :global(h1) {
		margin-block: 0.35rem 1.2rem;
	}
	.catalog :global(h2) {
		margin: 1.4rem 0 0.75rem;
		font-size: 1.1rem;
		font-weight: 650;
	}
	.catalog :global(p) {
		line-height: 1.5;
		color: var(--muted);
	}
	.catalog :global([role='alert']) {
		color: var(--text);
	}
	.catalog :global(input[type='search']) {
		display: block;
		width: 100%;
		max-width: 100%;
	}
	.catalog :global(.secondary),
	.catalog :global(.primary) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
	}
</style>
