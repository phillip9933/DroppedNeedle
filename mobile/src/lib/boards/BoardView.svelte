<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { ArrowLeft, ChevronRight, PanelsTopLeft } from '@lucide/svelte';
	import type { Session } from '../connection';
	import type { Album, OnPlay } from '../catalog/catalog';
	import type { DiscoverArtistRef } from '../catalog/discovery';
	import type { Playlist } from '../catalog/playlists';
	import LibraryWidget from '../catalog/LibraryWidget.svelte';
	import DiscoveryWidget from '../catalog/DiscoveryWidget.svelte';
	import PreviewViewport from './PreviewViewport.svelte';
	import {
		accountId,
		boardNames,
		loadLayout,
		sectionTitle,
		type Board,
		type Section
	} from './layout';

	let {
		board,
		session,
		active,
		onopen,
		onartist,
		onlocal,
		onplaylist,
		onplay
	}: {
		board: Board;
		session: Session;
		active: boolean;
		onopen: (album: Album) => void;
		onartist: (a: DiscoverArtistRef) => void;
		onlocal: (a: { id: string; name: string }) => void;
		onplaylist: (p: Playlist) => void;
		onplay: OnPlay;
	} = $props();
	let owner = $state(''),
		sections = $state<Section[]>([]),
		error = $state('');
	let expanded = $state<Section | null>(null);
	let root: HTMLElement;
	let offset = 0;
	let live = false;
	async function load() {
		error = '';
		try {
			const id = await accountId(session);
			if (!live) return;
			sections = loadLayout(session.serverUrl, id, board);
			owner = id;
		} catch {
			if (live) error = 'Could not load your layout. Check your connection and try again.';
		}
	}
	onMount(() => {
		live = true;
		void load();
		function changed(event: Event) {
			const d = (event as CustomEvent<{ server: string; user: string; board: string }>).detail;
			if (d.server !== session.serverUrl || d.user !== owner || d.board !== board) return;
			sections = loadLayout(session.serverUrl, owner, board);
			if (expanded) expanded = sections.find((s) => s.id === expanded?.id) ?? null;
		}
		window.addEventListener('dn-layout-change', changed);
		return () => {
			window.removeEventListener('dn-layout-change', changed);
			live = false;
		};
	});
	function scroll(y: number) {
		void tick().then(() => {
			const main = root?.closest('main');
			main?.scrollTo(0, y);
			main?.focus({ preventScroll: true });
		});
	}
	function enter(item: Section) {
		offset = root.closest('main')?.scrollTop ?? 0;
		expanded = item;
		scroll(0);
	}
	export function goBack() {
		if (!expanded) return false;
		expanded = null;
		scroll(offset);
		return true;
	}
</script>

{#snippet widget(item: Section, full: boolean)}
	{#if item.id.startsWith('library-')}
		<LibraryWidget
			id={item.id}
			{session}
			{onopen}
			onartist={onlocal}
			{onplaylist}
			{onplay}
			active={active && (full || !expanded)}
			expanded={full}
			onexpand={() => enter(item)}
		/>
	{:else}
		<DiscoveryWidget
			id={item.id}
			{session}
			{onopen}
			{onartist}
			{onplay}
			active={active && (full || !expanded)}
			expanded={full}
			onexpand={() => enter(item)}
		/>
	{/if}
{/snippet}

<div bind:this={root} data-board={board}>
	{#if expanded}
		<div class="detailbar">
			<button class="text-button" onclick={goBack}
				><ArrowLeft size={17} /> Back to {boardNames[board]}</button
			>
		</div>
		<h1>{sectionTitle(expanded)}</h1>
		{@render widget(expanded, true)}
	{/if}
	<div hidden={!!expanded}>
		<header class="head"><h1>{boardNames[board]}</h1></header>
		{#if error}<p role="alert">{error}</p>
			<button class="text-button" onclick={load}>Try again</button>
		{:else if !owner}<p role="status">Loading layout…</p>
		{:else if !sections.length}<div class="empty">
				<PanelsTopLeft size={28} />
				<p>Choose sections for {boardNames[board]} in Settings.</p>
			</div>
		{:else}
			{#each sections as item (item.id)}
				<section
					class:shortcut={!item.preview}
					class="shelf"
					data-widget={item.id}
					aria-label={sectionTitle(item)}
				>
					<h2>
						<button aria-label={'Browse ' + sectionTitle(item)} onclick={() => enter(item)}
							><span>{sectionTitle(item)}</span><ChevronRight size={20} /></button
						>
					</h2>
					{#if item.preview}<PreviewViewport>{@render widget(item, false)}</PreviewViewport>{/if}
				</section>
			{/each}
		{/if}
	</div>
</div>

<style>
	.head,
	.detailbar,
	.shelf h2 button {
		display: flex;
		align-items: center;
	}
	.head,
	.detailbar {
		justify-content: space-between;
		gap: var(--gap);
	}
	.head {
		margin-bottom: 1.1rem;
	}
	.head h1 {
		margin: 0;
	}
	.shelf {
		min-width: 0;
		margin-bottom: 1.3rem;
	}
	.shelf h2 {
		margin: 0 0 0.4rem;
	}
	.shelf h2 button {
		justify-content: space-between;
		gap: var(--gap);
		width: 100%;
		min-height: 44px;
		font: inherit;
		text-align: left;
		overflow-wrap: anywhere;
	}
	.shelf h2 :global(svg) {
		color: var(--muted);
	}
	.shortcut {
		margin: 0;
		border-top: 1px solid var(--line);
	}
	.shortcut h2 {
		margin: 0;
	}
	.shortcut h2 button {
		min-height: 54px;
	}
	.shortcut + .shelf:not(.shortcut) {
		margin-top: 1.2rem;
	}
	.detailbar {
		margin-bottom: var(--gap);
	}
	.empty {
		padding: 1.4rem var(--gap);
		background: var(--surface);
		border-radius: var(--radius);
	}
	.empty :global(svg) {
		color: var(--muted);
	}
</style>
