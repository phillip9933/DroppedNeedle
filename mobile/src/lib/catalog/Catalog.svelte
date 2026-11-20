<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { librarySelectionBack } from './librarySelection.svelte';
	import type { Session } from '../connection';
	import type { Album, CatalogTab, OnPlay } from './catalog';
	import BoardView from '../boards/BoardView.svelte';
	import LibraryHub from './LibraryHub.svelte';
	import DiscoverArtist from './DiscoverArtist.svelte';
	import LocalArtistDetail, { type LocalArtist } from './LocalArtistDetail.svelte';
	import type { DiscoverArtistRef } from './discovery';
	import PlaylistDetail from './PlaylistDetail.svelte';
	import type { Playlist } from './playlists';
	import GenreDetail from './GenreDetail.svelte';
	import Search from './Search.svelte';
	import Requests from './Requests.svelte';
	import AlbumDetail from './AlbumDetail.svelte';

	let {
		session,
		active,
		tab,
		onplay,
		onnavigate,
		onoffline
	}: {
		session: Session;
		active: boolean;
		tab: CatalogTab;
		onplay: OnPlay;
		onoffline?: () => void;
		onnavigate: (tab: CatalogTab) => void;
	} = $props();
	const dismissSelection = librarySelectionBack();
	let boardView = $state<{ goBack: () => boolean }>();
	let hub = $state<LibraryHub>();
	let searchView = $state<Search>();
	export function getHeader() {
		return tab === 'library' && !inside ? hub?.getHeader() : undefined;
	}
	export function backToBoard() {
		return tab === 'library' ? (hub?.goBack() ?? false) : (boardView?.goBack() ?? false);
	}
	let playlist = $state<Playlist | null>(null),
		album = $state<Album | null>(null);
	let localArtist = $state<LocalArtist | null>(null);
	let artist = $state<DiscoverArtistRef | null>(null);
	let term = $state(''),
		genre = $state('');
	let root: HTMLElement;
	const offsets: number[] = [];
	const inside = $derived(!!(album || playlist || artist || localArtist || genre));
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
	function openGenre(name: string) {
		enter();
		genre = name;
	}
	function openPlaylist(item: Playlist) {
		enter();
		playlist = item;
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
		else if (localArtist) localArtist = null;
		else genre = '';
		move(offsets.pop() ?? 0);
	}
	function systemBack(event: Event) {
		if (!active || event.defaultPrevented || document.querySelector('dialog[open]')) return;
		if (dismissSelection()) event.preventDefault();
		else if (inside) {
			event.preventDefault();
			back();
		} else if ((tab === 'library' && hub?.goBack()) || (tab === 'search' && searchView?.goBack()))
			event.preventDefault();
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
			<LibraryHub
				bind:this={hub}
				{session}
				active={active && !inside}
				{onoffline}
				onopen={open}
				onartist={openArtist}
				onlocal={openLocal}
				onplaylist={openPlaylist}
				ongenre={openGenre}
				{onplay}
			/>
		{:else if tab === 'home' || tab === 'discover'}
			<BoardView
				bind:this={boardView}
				board={tab}
				{onoffline}
				{session}
				active={active && !inside}
				onopen={open}
				onartist={openArtist}
				onlocal={openLocal}
				onplaylist={openPlaylist}
				ongenre={openGenre}
				{onplay}
			/>
		{:else if tab === 'search'}{#key session}<Search
					bind:this={searchView}
					active={active && !inside}
					{session}
					onopen={open}
					onartist={(a) => {
						if (a.mbid) openArtist({ id: a.mbid, name: a.name });
						else if (a.localId) openLocal({ id: a.localId, name: a.name });
					}}
					{onplay}
					onplaylist={openPlaylist}
					ongenre={openGenre}
					bind:term
				/>{/key}
		{:else}<Requests {session} onopen={open} />{/if}
	</div>
	{#if genre}<div hidden={!!(album || artist || localArtist)}>
			<button class="text-button" onclick={back}
				>Back to {tab === 'search' ? 'search' : 'sections'}</button
			>
			{#key genre}<GenreDetail
					{session}
					name={genre}
					onopen={open}
					onartist={(who) =>
						who.localOnly ? openLocal({ id: who.id, name: who.name }) : openArtist(who)}
					{onplay}
				/>{/key}
		</div>{/if}
	{#if localArtist}<div hidden={!!album || !!artist}>
			<LocalArtistDetail
				{session}
				artist={localArtist}
				active={active && !album && !artist}
				onopen={open}
				onartist={openLocal}
				ondiscover={openArtist}
				{onplay}
				onback={back}
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
	{:else if playlist}<PlaylistDetail
			{session}
			{playlist}
			{onplay}
			onback={back}
			backLabel={tab === 'search' ? 'Back to search' : undefined}
		/>{/if}
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
		display: flex;
		flex-wrap: wrap;
		width: fit-content;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
	}
</style>
