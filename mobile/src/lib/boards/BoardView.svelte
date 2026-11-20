<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { ArrowLeft, ChevronRight, PanelsTopLeft, Plus, SlidersHorizontal } from '@lucide/svelte';
	import type { Session } from '../connection';
	import type { Album, OnPlay } from '../catalog/catalog';
	import type { DiscoverArtistRef } from '../catalog/discovery';
	import type { Playlist } from '../catalog/playlists';
	import LibraryWidget from '../catalog/LibraryWidget.svelte';
	import DiscoveryWidget from '../catalog/DiscoveryWidget.svelte';
	import PreviewViewport from './PreviewViewport.svelte';
	import LayoutEditor from './LayoutEditor.svelte';
	import {
		accountId,
		boardNames,
		loadLayout,
		saveLayout,
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
		error = $state(''),
		editing = $state(false);
	let expanded = $state<Section | null>(null),
		pinned = $state(false),
		pinError = $state('');
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
		return () => {
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
	function enter(s?: Section) {
		offset = root.closest('main')?.scrollTop ?? 0;
		pinError = '';
		if (s) {
			expanded = s;
			if (board !== 'home') {
				try {
					pinned = loadLayout(session.serverUrl, owner, 'home').some((row) => row.id === s.id);
				} catch {
					pinned = false;
				}
			}
		} else editing = true;
		scroll(0);
	}
	export function goBack() {
		if (!editing && !expanded) return false;
		editing = false;
		expanded = null;
		scroll(offset);
		return true;
	}
	function save(next: Section[]) {
		saveLayout(session.serverUrl, owner, board, next);
		sections = next.map((s) => ({ ...s, title: s.title.trim() }));
		goBack();
	}
	function pin() {
		if (!expanded || pinned) return;
		try {
			const home = loadLayout(session.serverUrl, owner, 'home');
			if (!home.some((row) => row.id === expanded?.id))
				saveLayout(session.serverUrl, owner, 'home', [...home, { ...expanded }]);
			pinned = true;
		} catch {
			pinError = 'Could not save this section to Home.';
		}
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
			active={active && (full || (!expanded && !editing))}
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
			active={active && (full || (!expanded && !editing))}
			expanded={full}
			onexpand={() => enter(item)}
		/>
	{/if}
{/snippet}

<div bind:this={root} data-board={board}>
	{#if editing}
		<LayoutEditor {board} {sections} onsave={save} onback={goBack} />
	{:else if expanded}
		<div class="detailbar">
			<button class="text-button" onclick={goBack}
				><ArrowLeft size={17} /> Back to {boardNames[board]}</button
			>
			{#if board !== 'home'}<button class="text-button" disabled={pinned} onclick={pin}
					>{#if !pinned}<Plus size={16} />{/if}{pinned ? 'On Home' : 'Add to Home'}</button
				>{/if}
		</div>
		{#if pinError}<p role="alert">{pinError}</p>{/if}
		<h1>{sectionTitle(expanded)}</h1>
		{@render widget(expanded, true)}
	{/if}
	<div hidden={editing || !!expanded}>
		<header class="head">
			<h1>{boardNames[board]}</h1>
			<button
				class="edit"
				aria-label={'Edit ' + boardNames[board] + ' layout'}
				disabled={!owner}
				onclick={() => enter()}><SlidersHorizontal size={16} />Edit</button
			>
		</header>
		{#if error}<p role="alert">{error}</p>
			<button class="text-button" onclick={load}>Try again</button>
		{:else if !owner}<p role="status">Loading layout…</p>
		{:else if !sections.length}<div class="empty">
				<PanelsTopLeft size={28} />
				<p>Choose the sections you want on {boardNames[board]}.</p>
				<button class="secondary" onclick={() => enter()}>Add sections</button>
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
	.edit,
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
	.edit {
		gap: 0.4rem;
		padding: 0.25rem 0.8rem;
		min-height: 44px;
		background: var(--surface);
		border-radius: var(--radius);
		font-weight: 600;
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
