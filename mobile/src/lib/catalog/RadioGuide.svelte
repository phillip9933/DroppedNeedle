<script lang="ts">
	import { ChevronDown, Radio } from '@lucide/svelte';
	import type { Preview } from '../boards/display';
	import type { Session } from '../connection';
	import { tr, uiText } from '../i18n';
	import type { Album, OnPlay } from './catalog';
	import type { DiscoverArtistRef } from './discovery';
	import type { FeatureShelf, ShelfSong } from './discoveryWidgets';
	import DiscoveryPreview from './DiscoveryPreview.svelte';
	import LibraryRadio from './LibraryRadio.svelte';

	let {
		shelves,
		display,
		session,
		onopen,
		onartist,
		onplay,
		onplaysong,
		ongenre
	}: {
		shelves: FeatureShelf[];
		display: Preview;
		session: Session;
		onopen: (album: Album) => void;
		onartist: (artist: DiscoverArtistRef) => void;
		onplay: OnPlay;
		onplaysong: (song: ShelfSong) => void;
		ongenre?: (name: string) => void;
	} = $props();
	const instance = $props.id();
	let selected = $state('');
	const stations = $derived(shelves.slice(0, display.limit));
	const columns = $derived(display.visibleColumns);
	const rowCount = $derived(Math.ceil(stations.length / columns));
	const key = (s: FeatureShelf) => JSON.stringify([s.radio?.kind, s.radio?.id, s.title]);
	const groups = [
		['albums', 'Albums'],
		['songs', 'Tracks'],
		['artists', 'Artists'],
		['genres', 'Genres'],
		['unlinked', 'Other recommendations']
	] as const;
	function content(station: FeatureShelf, field: (typeof groups)[number][0]): FeatureShelf {
		return {
			title: '',
			albums: [],
			songs: [],
			artists: [],
			genres: [],
			unlinked: [],
			[field]: station[field]
		};
	}
	const full = $derived({ ...display, limit: Infinity });
</script>

{#each Array.from({ length: rowCount }, (_, i) => i) as row (row)}
	{@const stationsInRow = stations.slice(row * columns, (row + 1) * columns)}
	{@const current = stationsInRow.find((s) => key(s) === selected)}
	<div class="preview-items station-row">
		{#each stationsInRow as station (key(station))}
			<button
				class="station"
				class:chosen={selected === key(station)}
				aria-expanded={selected === key(station)}
				aria-controls={current === station ? instance + '-contents' : undefined}
				onclick={() => (selected = selected === key(station) ? '' : key(station))}
			>
				<Radio size={20} aria-hidden="true" /><strong
					>{station.title.replace(/^Radio:\s*/i, '') || uiText('Radio stations')}</strong
				><ChevronDown size={16} aria-hidden="true" />
			</button>
		{/each}
	</div>
	{#if current}
		<section class="station-body" id={instance + '-contents'} aria-label={current.title}>
			{#if current.radio}<div class="actions">
					<LibraryRadio
						{session}
						seedType={current.radio.kind}
						seedId={current.radio.id}
						seedTitle={current.title}
						{onplay}
					/>
				</div>{/if}
			{#if current.note}<p>{current.note}</p>{/if}
			{#each groups as [field, heading] (field)}
				{#if current[field].length}
					<h3>
						{heading === 'Other recommendations'
							? tr('Other recommendations', 'その他のおすすめ')
							: uiText(heading)}
					</h3>
					<DiscoveryPreview
						{session}
						display={full}
						data={{ shelves: [content(current, field)] }}
						{onopen}
						{onartist}
						{onplay}
						{onplaysong}
						{ongenre}
					/>
				{/if}
			{/each}
		</section>
	{/if}
{/each}

<style>
	.station-row {
		container-type: inline-size;
	}
	.station-row + .station-row {
		margin-top: var(--preview-gap);
	}
	.station {
		container-type: inline-size;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		min-height: 44px;
		padding: var(--preview-padding);
		border-radius: var(--radius);
		background: var(--surface);
		text-align: start;
	}
	.station strong {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
	}
	.station :global(svg) {
		flex: none;
		color: var(--muted);
	}
	.station.chosen :global(svg) {
		color: var(--accent);
	}
	.station.chosen :global(svg:last-child) {
		transform: rotate(180deg);
	}
	.station-body {
		margin-block: 0.35rem var(--gap);
		padding-inline-start: var(--preview-padding);
		border-inline-start: 2px solid var(--line);
	}
	.station-body h3 {
		margin: 0.55rem 0 0.2rem;
		font-size: 0.95rem;
		color: var(--muted);
	}
	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	@container (max-width: 100px) {
		.station > :global(svg) {
			display: none;
		}
	}
</style>
