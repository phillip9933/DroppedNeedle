<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import type { Album, CatalogTab, OnPlay } from './catalog';
	import Library from './Library.svelte';
	import Playlists from './Playlists.svelte';
	import PlaylistDetail from './PlaylistDetail.svelte';
	import type { Playlist } from './playlists';
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
	let section = $state<'albums' | 'playlists'>('albums');
	let playlist = $state<Playlist | null>(null);
	let album = $state<Album | null>(null),
		term = $state('');
	function open(item: Album) {
		album = item;
		window.scrollTo(0, 0);
	}
	function back() {
		album = null;
		playlist = null;
	}
	function systemBack(event: Event) {
		if (album || playlist) {
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
	{:else if playlist}
		<PlaylistDetail {session} {playlist} {onplay} onback={back} />
	{:else if tab === 'library'}
		<h1>Library</h1>
		<div class="sections" role="group" aria-label="Library views">
			<button aria-pressed={section === 'albums'} onclick={() => (section = 'albums')}
				>Albums</button
			>
			<button aria-pressed={section === 'playlists'} onclick={() => (section = 'playlists')}
				>Playlists</button
			>
		</div>
		{#if section === 'albums'}<Library {session} onopen={open} />
		{:else}<Playlists {session} onopen={(item) => (playlist = item)} />{/if}
	{:else if tab === 'search'}<Search {session} onopen={open} {onplay} bind:term />
	{:else}<Requests {session} onopen={open} />{/if}
</section>

<style>
	.sections {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.2rem;
		margin-bottom: var(--gap);
		background: var(--surface);
		border-radius: var(--radius);
	}
	.sections button {
		min-height: 44px;
		padding: 0.4rem 0.95rem;
		color: var(--muted);
		border-radius: var(--radius);
	}
	.sections button[aria-pressed='true'] {
		background: var(--raised);
		color: var(--text);
		font-weight: 650;
	}
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
