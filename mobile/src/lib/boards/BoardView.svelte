<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { ArrowLeft, ChevronRight, PanelsTopLeft, Download, ListFilterPlus } from '@lucide/svelte';
	import type { Session } from '../connection';
	import type { Album, OnPlay } from '../catalog/catalog';
	import type { DiscoverArtistRef } from '../catalog/discovery';
	import type { Playlist } from '../catalog/playlists';
	import FilterSectionDialog from './FilterSectionDialog.svelte';
	import { type LibraryFilter, type FilterSection } from './filteredSections';
	import SelectionHost from '../catalog/SelectionHost.svelte';
	import LibraryWidget from '../catalog/LibraryWidget.svelte';
	import DiscoveryWidget from '../catalog/DiscoveryWidget.svelte';
	import type { Preview } from './display';
	import PreviewViewport from './PreviewViewport.svelte';
	import {
		accountId,
		boardNames,
		loadLayout,
		sectionTitle,
		saveLayout,
		type Board,
		type Section
	} from './layout';

	let {
		board,
		session,
		active,
		onopen,
		onartist,
		ongenre,
		onlocal,
		onplaylist,
		onplay,
		onrootback,
		onoffline
	}: {
		board: Board;
		session: Session;
		active: boolean;
		onopen: (album: Album) => void;
		ongenre?: (name: string) => void;
		onartist: (a: DiscoverArtistRef) => void;
		onlocal: (a: { id: string; name: string }) => void;
		onplaylist: (p: Playlist) => void;
		onplay: OnPlay;
		onoffline?: () => void;
		onrootback?: () => void;
	} = $props();
	let owner = $state(''),
		sections = $state<Section[]>([]),
		error = $state('');
	let newFilter = $state<Partial<LibraryFilter> | null>(null);
	function createFilter(value: FilterSection) {
		const current = loadLayout(session.serverUrl, owner, board);
		saveLayout(
			session.serverUrl,
			owner,
			board,
			[...current, { id: value.id, preview: true, title: '', filter: value }],
			{ before: [], after: [value] }
		);
		newFilter = null;
		expanded = null;
		scroll(0);
	}
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
			const d = (
				event as CustomEvent<{
					server: string;
					user: string;
					board: string;
					filtersChanged?: boolean;
				}>
			).detail;
			if (
				d.server !== session.serverUrl ||
				d.user !== owner ||
				(d.board !== board && !d.filtersChanged)
			)
				return;
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

{#snippet widget(item: Section, full: boolean, display: Preview)}
	{#if item.id.startsWith('library-')}
		<LibraryWidget
			filter={item.filter}
			onsavefilters={board !== 'discover' ? (config) => (newFilter = config) : undefined}
			id={item.id}
			{session}
			{onopen}
			onartist={onlocal}
			{onplaylist}
			{onplay}
			active={active && (full || !expanded)}
			expanded={full}
			{display}
			onexpand={() => enter(item)}
		/>
	{:else}
		<DiscoveryWidget
			{ongenre}
			id={item.id}
			{session}
			{onopen}
			{onartist}
			{onplay}
			active={active && (full || !expanded)}
			expanded={full}
			{display}
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
		<SelectionHost
			{session}
			{onplay}
			{active}
			enabled={board !== 'discover'}
			scope={expanded.id}
			heading={sectionTitle(expanded)}
		>
			{@const selected = expanded}
			<PreviewViewport section={selected} expanded>
				{#snippet children(display)}{@render widget(selected, true, display)}{/snippet}
			</PreviewViewport>
		</SelectionHost>
	{/if}
	<div hidden={!!expanded}>
		{#if onrootback}<button class="text-button" onclick={onrootback}
				><ArrowLeft size={17} />Back to Library</button
			>{/if}
		<SelectionHost
			{session}
			{onplay}
			active={active && !expanded}
			enabled={board !== 'discover'}
			heading={boardNames[board]}
		>
			{#snippet tools()}
				{#if board === 'library'}
					{#if owner}<button class="board-action secondary" onclick={() => (newFilter = {})}
							><ListFilterPlus size={17} />New filtered section</button
						>{/if}
					{#if onoffline}<button class="board-action secondary" onclick={onoffline}
							><Download size={17} />Offline music</button
						>{/if}
				{/if}
			{/snippet}
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
						{#if item.preview}<PreviewViewport section={item}
								>{#snippet children(display)}{@render widget(
										item,
										false,
										display
									)}{/snippet}</PreviewViewport
							>{/if}
					</section>
				{/each}
			{/if}
		</SelectionHost>
	</div>
</div>

{#if newFilter}<FilterSectionDialog
		initial={newFilter}
		onclose={() => (newFilter = null)}
		onsave={createFilter}
	/>{/if}

<style>
	.board-action {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		gap: 0.45rem;
		padding: 0.35rem 0.7rem;
	}

	.detailbar,
	.shelf h2 button {
		display: flex;
		align-items: center;
	}
	.detailbar {
		justify-content: space-between;
		gap: var(--gap);
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
