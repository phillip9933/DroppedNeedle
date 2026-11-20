<script lang="ts">
	import {
		ListMusic,
		Tags,
		EllipsisVertical,
		Download,
		CloudDownload,
		HardDrive
	} from '@lucide/svelte';
	import type { Session } from '../connection';
	import type { OfflineInventory } from '../offline/library';
	import type { BrowseItem, Category } from './libraryBrowse';
	import { browseChoice } from './libraryBrowse';
	import { tick } from 'svelte';
	import { browseViewport, initialWindow } from './browseViewport';
	import { useLibrarySelection } from './librarySelection.svelte';
	import Cover from './Cover.svelte';
	import { originIndex, itemOrigins } from './libraryOrigins';
	import { originLabels } from '../offline/library';
	import TrackActions from './TrackActions.svelte';
	let {
		session,
		items,
		category,
		layout,
		columns,
		compact = false,
		active = true,
		inventory,
		total,
		localOnly = false,
		open,
		menu
	}: {
		session: Session;
		items: BrowseItem[];
		category: Category;
		layout: 'list' | 'grid';
		columns: number;
		compact?: boolean;
		active?: boolean;
		inventory?: OfflineInventory;
		total?: number;
		localOnly?: boolean;
		open: (item: BrowseItem) => void;
		menu?: (item: BrowseItem) => void;
	} = $props();
	const selectable = useLibrarySelection();
	const storage = $derived(originIndex(session, inventory));
	const originIcons = { downloaded: Download, automatic: CloudDownload, cached: HardDrive };
	const status = $derived(
		storage.size ? new Map(items.map((i) => [i.id, itemOrigins(i, storage)])) : undefined
	);
	const present = $derived([...new Set([...(status?.values() ?? [])].flat())]);
	let element: HTMLDivElement,
		metrics = $state.raw(initialWindow),
		pinned = $state(-1);
	const cols = $derived(layout === 'grid' ? columns : 1);
	const virtual = $derived(items.length > 64 && metrics.pitch > 0);
	const mounted = $derived.by(() => {
		const start = virtual ? metrics.start : 0,
			end = virtual ? metrics.end : items.length;
		const rows = items.slice(start, end).map((item, i) => ({ item, index: start + i }));
		if (virtual && items[pinned] && (pinned < start || pinned >= end)) {
			const extra = { item: items[pinned], index: pinned };
			if (pinned < start) rows.unshift(extra);
			else rows.push(extra);
		}
		return rows;
	});
	function focusNavigation(node: HTMLElement) {
		const events = new AbortController(),
			opts = { signal: events.signal };
		node.addEventListener('focusin', rememberFocus, opts);
		node.addEventListener(
			'focusout',
			(e) => {
				if (!node.contains(e.relatedTarget as Node)) pinned = -1;
			},
			opts
		);
		node.addEventListener('keydown', keyboard, opts);
		return {
			destroy() {
				events.abort();
			}
		};
	}

	export async function focusItem(id: string) {
		const index = items.findIndex((i) => i.id === id);
		if (index < 0) return;
		pinned = index;
		await tick();
		element
			?.querySelector<HTMLButtonElement>('[data-browse-index="' + index + '"] .item')
			?.focus({ preventScroll: true });
	}
	function rememberFocus(e: FocusEvent) {
		const entry = (e.target as HTMLElement).closest<HTMLElement>('[data-browse-index]');
		pinned = entry ? Number(entry.dataset.browseIndex) : -1;
	}
	async function keyboard(e: KeyboardEvent) {
		if (!virtual || e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
		const target = e.target as HTMLElement,
			entry = target.closest<HTMLElement>('[data-browse-index]');
		if (!entry) return;
		const controls = entry.querySelectorAll<HTMLElement>('button:not([disabled])');
		if (target !== (e.shiftKey ? controls[0] : controls[controls.length - 1])) return;
		const next = Number(entry.dataset.browseIndex) + (e.shiftKey ? -1 : 1);
		if (
			next < 0 ||
			next >= items.length ||
			element.querySelector('[data-browse-index="' + next + '"]')
		)
			return;
		e.preventDefault();
		pinned = next;
		await tick();
		const nextControls = element.querySelectorAll<HTMLElement>(
			'[data-browse-index="' + next + '"] button:not([disabled])'
		);
		nextControls[e.shiftKey ? nextControls.length - 1 : 0]?.focus();
	}
</script>

{#if present.length}<div class="legend" aria-label="Offline availability" role="group">
		{#each present as value (value)}{@const Glyph = originIcons[value]}<span
				><Glyph size={13} />{originLabels[value]}</span
			>{/each}
	</div>{/if}
<div
	bind:this={element}
	use:browseViewport={{
		count: items.length,
		columns: cols,
		compact,
		active,
		layout,
		onwindow: (w) => (metrics = w)
	}}
	class:windowed={virtual}
	style:height={virtual
		? Math.max(0, Math.ceil(items.length / cols) * metrics.pitch - metrics.gap) + 'px'
		: undefined}
	style:--cell-width={metrics.width + 'px'}
	use:focusNavigation
	role="list"
	aria-label={category + ' results'}
	data-part="category-items"
	data-loaded={items.length}
	data-layout={layout}
	data-columns={layout === 'grid' ? columns : 1}
	class:grid={layout === 'grid'}
	class:compact
	class="entries"
	style:--cols={columns}
>
	{#each mounted as { item, index } (item.id)}
		{@const origins = status?.get(item.id) ?? []}
		<div
			class="entry"
			data-browse-index={index}
			role="listitem"
			aria-posinset={index + 1}
			aria-setsize={total ?? items.length}
			style:--entry-top={Math.floor(index / cols) * metrics.pitch + 'px'}
			style:--entry-left={(index % cols) * (metrics.width + metrics.columnGap) + 'px'}
			class:artist={category === 'Artists'}
			class:playlist={category === 'Playlists'}
			class:genre={category === 'Genres'}
		>
			<button
				class="item"
				aria-label={item.track ? 'Play ' + item.title : item.title}
				onclick={() => open(item)}
				use:selectable={browseChoice(session, item)}
			>
				<span
					class="art"
					class:round={category === 'Artists'}
					class:collage={(item.covers?.length ?? 0) > 1}
				>
					{#if category === 'Genres'}<Tags size={23} />
					{:else if item.covers?.length}{#each item.covers.length === 1 ? item.covers : Array.from({ length: 4 }, (_, i) => item.covers![i % item.covers!.length]) as art, i (i)}
							<Cover {session} cacheOnly={localOnly} path={art} seed={art} />
						{/each}
					{:else if category === 'Playlists'}<ListMusic strokeWidth={1.3} size="48%" />
					{:else}<Cover {session} cacheOnly={localOnly} path={item.art} seed={item.id} />{/if}
				</span>
				<span class="meta"
					><strong>{item.title}</strong
					>{#if item.subtitle && !(category === 'Artists' && layout === 'grid')}<small
							>{item.subtitle}</small
						>{/if}</span
				>
				{#if origins.length}<span
						class="offline"
						role="img"
						title={origins.map((o) => originLabels[o]).join(', ')}
						aria-label={origins.map((o) => originLabels[o]).join(', ')}
						>{#each origins as origin (origin)}{@const Glyph = originIcons[origin]}<Glyph
								size={14}
							/>{/each}</span
					>{/if}
			</button>
			{#if item.track}
				<span class="more"
					><TrackActions
						{session}
						{localOnly}
						vertical
						tracks={[item.track]}
						label={'More options for ' + item.title}
						favorite={item.track.favorite}
					/></span
				>
			{:else if menu && (category === 'Genres' || category === 'Playlists' || layout === 'list')}
				<button
					class="more icon"
					aria-label={'More options for ' + item.title}
					onclick={() => menu?.(item)}><EllipsisVertical size={18} /></button
				>
			{/if}
		</div>
	{/each}
</div>

<style>
	.entries.windowed {
		display: block;
		position: relative;
		overflow-anchor: none;
	}
	.entries.windowed .entry {
		position: absolute;
		inset-inline-start: var(--entry-left);
		inset-block-start: var(--entry-top);
		width: var(--cell-width);
	}
	.grid .entry:not(.artist):not(.genre) .meta {
		min-height: calc(1.3em + 1.118rem + 0.56rem);
	}

	.entries {
		display: grid;
		gap: 1px;
		min-width: 0;
	}
	.entries.grid {
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		gap: 0.68rem 0.35rem;
	}
	.entry {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.22rem;
		min-width: 0;
	}
	.item {
		padding: 0.2rem 0;
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
		min-height: 48px;
		flex: 1;
		text-align: start;
	}
	.art {
		width: 3.05rem;
		height: 3.05rem;
		display: grid;
		place-items: center;
		flex: none;
		overflow: hidden;
		border-radius: var(--radius);
		color: var(--muted);
	}
	.art > :global(.cover) {
		width: 100%;
		height: 100%;
		border-radius: 0;
	}
	.art.round {
		border-radius: 50%;
	}
	.collage {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		gap: 1px;
	}
	.playlist .art {
		background: var(--surface);
	}
	.meta {
		display: grid;
		min-width: 0;
		text-align: start;
	}
	.meta strong,
	.meta small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		line-height: 1.3;
	}
	.meta small {
		color: var(--muted);
		font-size: 0.86rem;
		font-weight: 400;
	}
	.more {
		flex: none;
		display: grid;
		place-items: center;
	}
	.icon {
		min-width: 44px;
		min-height: 44px;
	}
	.grid .entry,
	.grid .item {
		display: block;
	}
	.grid .item {
		padding: 0;
	}
	.grid .art {
		width: 100%;
		height: auto;
		aspect-ratio: 1;
	}
	.grid .meta {
		padding: 0.28rem 0.2rem;
	}
	.grid .artist .meta {
		text-align: center;
	}
	.grid .more {
		position: absolute;
		inset-inline-end: 0.15rem;
		bottom: 2.6rem;
		border-radius: 50%;
		color: var(--text);
		background: var(--surface);
	}
	.grid .offline {
		position: absolute;
		top: 0.25rem;
		left: 0.25rem;
		border-radius: 100%;
		background: var(--surface);
		padding: 0.15rem;
	}
	.offline {
		display: inline-flex;
		align-items: center;
		gap: 0.16rem;
		color: var(--accent);
	}
	.legend,
	.legend span {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.legend {
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0 0 0.45rem;
		color: var(--muted);
		font-size: 0.73rem;
	}
	.legend :global(svg) {
		color: var(--accent);
	}
	.genre .art {
		width: 2.65rem;
	}
	.grid .genre .art {
		width: 100%;
	}
	.compact:not(.grid) .art {
		width: 2.45rem;
		height: 2.45rem;
	}
</style>
