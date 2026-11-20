<script lang="ts">
	import { tick } from 'svelte';
	import {
		ChevronLeft,
		ChevronRight,
		ListMusic,
		UsersRound,
		Disc3,
		Music2,
		Tags,
		PanelsTopLeft,
		Download
	} from '@lucide/svelte';
	import type { Session } from '../connection';
	import type { Album, OnPlay } from './catalog';
	import type { Playlist } from './playlists';
	import type { DiscoverArtistRef } from './discovery';
	import type { PlayerTrack } from '../player';
	import BoardView from '../boards/BoardView.svelte';
	import { categories, type Category, type BrowseItem } from './libraryBrowse';
	import LibraryBrowser from './LibraryBrowser.svelte';
	import LibraryGroup from './LibraryGroup.svelte';
	let {
		session,
		active,
		onopen,
		onartist,
		onlocal,
		onplaylist,
		ongenre,
		onplay,
		onoffline
	}: {
		session: Session;
		active: boolean;
		onopen: (a: Album) => void;
		onartist: (a: DiscoverArtistRef) => void;
		onlocal: (a: { id: string; name: string }) => void;
		onplaylist: (p: Playlist) => void;
		ongenre: (s: string) => void;
		onplay: OnPlay;
		onoffline?: () => void;
	} = $props();
	const icons = {
		Playlists: ListMusic,
		Artists: UsersRound,
		Albums: Disc3,
		Tracks: Music2,
		Genres: Tags
	};
	let browser = $state<LibraryBrowser>();
	export function getPlaybackAvailability() {
		return current === 'sections'
			? board?.getPlaybackAvailability()
			: browser?.getPlaybackAvailability();
	}
	export function getHeader() {
		return detail ? undefined : browser?.getHeader();
	}
	let current = $state<Category | 'sections' | ''>(''),
		board = $state<BoardView>(),
		root: HTMLElement;
	let detail = $state<{ item: BrowseItem; tracks: PlayerTrack[]; offline: boolean } | null>(null);
	let savedScroll = 0,
		detailScroll = 0;
	function scroll(y: number) {
		void tick().then(() => root.closest('main')?.scrollTo(0, y));
	}
	function enter(c: typeof current) {
		savedScroll = root.closest('main')?.scrollTop ?? 0;
		current = c;
		scroll(0);
	}
	export function goBack() {
		if (!current) return false;
		if (detail) {
			detail = null;
			scroll(detailScroll);
			return true;
		}
		if (current === 'sections' && board?.goBack()) return true;
		current = '';
		scroll(savedScroll);
		return true;
	}
	function localDetail(item: BrowseItem, tracks: PlayerTrack[], offline: boolean) {
		detailScroll = root.closest('main')?.scrollTop ?? 0;
		detail = { item, tracks, offline };
		scroll(0);
	}
</script>

<div bind:this={root}>
	{#if current === 'sections'}
		<BoardView
			onrootback={goBack}
			bind:this={board}
			board="library"
			{session}
			{active}
			{onopen}
			{onartist}
			{onlocal}
			{onplaylist}
			{ongenre}
			{onplay}
			{onoffline}
		/>
	{:else if current}
		<div hidden={!!detail}>
			{#key current}<LibraryBrowser
					bind:this={browser}
					{session}
					category={current}
					active={active && !detail}
					{onopen}
					{onlocal}
					{onplaylist}
					{onplay}
					ondetail={localDetail}
					onback={goBack}
				/>{/key}
		</div>
		{#if detail}
			<button class="back" aria-label={'Back to ' + current} onclick={goBack}
				><ChevronLeft size={18} />{current}</button
			>
			<LibraryGroup
				{session}
				{active}
				{onplay}
				item={detail.item}
				tracks={detail.tracks}
				offline={detail.offline}
			/>
		{/if}
	{:else}
		<h1>Library</h1>
		<nav class="index" aria-label="Library categories">
			{#each categories as cat (cat)}
				{@const Icon = icons[cat]}
				<button aria-label={'Browse ' + cat} onclick={() => enter(cat)}
					><span class="mark"><Icon size={23} strokeWidth={1.8} /></span><strong>{cat}</strong
					><ChevronRight size={18} /></button
				>
			{/each}
		</nav>
		<div class="secondary-links">
			<button onclick={() => enter('sections')}
				><PanelsTopLeft size={20} />Library sections<ChevronRight size={16} /></button
			>
			{#if onoffline}<button aria-label="Open offline music" onclick={onoffline}
					><Download size={20} />Offline music<ChevronRight size={16} /></button
				>{/if}
		</div>
	{/if}
</div>

<style>
	.index,
	.secondary-links {
		display: grid;
	}
	.index button,
	.secondary-links button,
	.back {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		min-height: 48px;
		text-align: start;
	}
	.index button {
		min-height: 4.2rem;
		width: 100%;
		border-bottom: 1px solid var(--line);
		padding: 0.35rem 0.2rem;
	}
	.index strong {
		flex: 1;
		font-size: 1.08rem;
		font-weight: 620;
	}
	.mark {
		width: 2.65rem;
		height: 2.65rem;
		display: grid;
		place-items: center;
		background: var(--raised);
		color: var(--accent);
		border-radius: var(--radius);
	}
	.index button > :global(svg),
	.secondary-links button > :global(svg:last-child) {
		color: var(--muted);
	}
	.secondary-links {
		margin-top: 1.25rem;
	}
	.secondary-links button {
		width: 100%;
		font-weight: 550;
	}
	.secondary-links button > :global(svg:last-child) {
		margin-inline-start: auto;
	}
	.back {
		color: var(--muted);
	}
</style>
