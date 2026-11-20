<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Session } from '../connection';
	import type { Album, CatalogTab, OnPlay } from './catalog';
	import Discover from './Discover.svelte';
	import DiscoverArtist from './DiscoverArtist.svelte';
	import Favorite from './Favorite.svelte';
	import type { DiscoverArtistRef } from './discovery';
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
	let section = $state<'albums' | 'artists' | 'songs' | 'playlists'>('albums');
	let playlist = $state<Playlist | null>(null),
		album = $state<Album | null>(null);
	let localArtist = $state<{
		id: string;
		name: string;
		favorite?: boolean;
		artist_mbid?: string | null;
	} | null>(null);
	let artist = $state<DiscoverArtistRef | null>(null);
	let term = $state('');
	let root: HTMLElement;
	const offsets: number[] = [];
	const sections = ['albums', 'artists', 'songs', 'playlists'] as const;
	const inside = $derived(!!(album || playlist || artist || localArtist));
	function move(offset: number) {
		void tick().then(() => {
			const main = root.closest('main');
			main?.scrollTo(0, offset);
			main?.focus({ preventScroll: true });
		});
	}
	function enter() {
		offsets.push(root.closest('main')?.scrollTop ?? 0);
		move(0);
	}
	function open(item: Album) {
		enter();
		album = item;
	}
	function openArtist(item: DiscoverArtistRef) {
		enter();
		artist = item;
	}
	function openLocal(item: { id: string; name: string }) {
		enter();
		localArtist = item;
	}
	function back() {
		if (album) album = null;
		else if (playlist) playlist = null;
		else if (artist) artist = null;
		else localArtist = null;
		move(offsets.pop() ?? 0);
	}
	function systemBack(event: Event) {
		if (inside) {
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

<section bind:this={root} class="catalog" data-part="catalog">
	<div hidden={inside}>
		{#if tab === 'library'}
			<h1>Library</h1>
			<div class="sections" role="group" aria-label="Library views">
				{#each sections as view (view)}
					<button aria-pressed={section === view} onclick={() => (section = view)}
						>{view[0].toUpperCase() + view.slice(1)}</button
					>
				{/each}
			</div>
			{#if section === 'playlists'}<Playlists
					{session}
					onopen={(p) => {
						enter();
						playlist = p;
					}}
				/>
			{:else}{#key section}<Library
						kind={section}
						{session}
						onopen={open}
						onartist={openLocal}
						{onplay}
					/>{/key}{/if}
		{:else if tab === 'search'}<Search
				{session}
				onopen={open}
				onartist={(a) => {
					if (a.mbid) openArtist({ id: a.mbid, name: a.name });
					else if (a.localId) openLocal({ id: a.localId, name: a.name });
				}}
				{onplay}
				bind:term
			/>
		{:else if tab === 'discover'}<Discover
				{onplay}
				{session}
				onopen={open}
				onartist={openArtist}
				active={!inside}
			/>
		{:else}<Requests {session} onopen={open} />{/if}
	</div>
	{#if localArtist}<div hidden={!!album || !!artist}>
			<button class="text-button" onclick={back}>Back to artists</button>
			<h1>{localArtist.name}</h1>
			{#if localArtist.favorite !== undefined}<Favorite
					{session}
					kind="artist"
					id={localArtist.id}
					value={localArtist.favorite}
				/>{/if}
			{#if localArtist.artist_mbid}<button
					class="secondary"
					onclick={() =>
						localArtist?.artist_mbid &&
						openArtist({ id: localArtist.artist_mbid, name: localArtist.name })}
					>Artist profile</button
				>{/if}
			<Library
				kind="albums"
				{session}
				artist={localArtist}
				onopen={open}
				onartist={openLocal}
				{onplay}
			/>
		</div>{/if}
	{#if artist}<div hidden={!!album}>
			<DiscoverArtist {session} {onplay} {artist} onopen={open} onback={back} />
		</div>{/if}
	{#if album}{#key album}<AlbumDetail
				{album}
				{session}
				{onplay}
				onback={back}
				onrequests={showRequests}
			/>{/key}
	{:else if playlist}<PlaylistDetail {session} {playlist} {onplay} onback={back} />{/if}
</section>

<style>
	.sections {
		display: flex;
		flex-wrap: wrap;
		width: fit-content;
		gap: 0.25rem;
		padding: 0.2rem;
		margin-bottom: var(--gap);
		background: var(--surface);
		border-radius: var(--radius);
	}
	.sections button {
		min-height: 44px;
		padding: 0.4rem clamp(0.45rem, 2vw, 0.95rem);
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
		display: flex;
		flex-wrap: wrap;
		width: fit-content;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
	}
</style>
