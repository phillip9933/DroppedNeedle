<script lang="ts">
	import type { Session } from '../connection';
	import { errorMessage, type Album, type OnPlay } from './catalog';
	import type { ChartRange, DiscoverArtistRef } from './discovery';
	import {
		isChart,
		playableSong,
		previewShelf,
		readWidget,
		type ShelfSong,
		type WidgetResult
	} from './discoveryWidgets';
	import DiscoverDeck from './DiscoverDeck.svelte';
	import DiscoverShelf from './DiscoverShelf.svelte';
	import DiscoverGenres from './DiscoverGenres.svelte';
	import LibraryRadio from './LibraryRadio.svelte';
	import TrackRow from './TrackRow.svelte';
	let {
		id,
		session,
		onopen,
		onartist,
		onplay,
		expanded = false,
		active = true
	}: {
		id: string;
		session: Session;
		onopen: (a: Album) => void;
		onartist: (a: DiscoverArtistRef) => void;
		onplay: OnPlay;
		active?: boolean;
		expanded?: boolean;
		onexpand: () => void;
	} = $props();
	let range = $state<ChartRange>('this_month'),
		offsets = $state<number[]>([0]),
		selectedPlaylist = $state(''),
		retry = $state(0);
	let data = $state<WidgetResult | null>(null),
		error = $state(''),
		busy = $state(true),
		songStatus = $state(''),
		pendingSong = $state<ShelfSong | null>(null);
	let tap = 0;
	let lastLoad = '',
		lastSession: Session | undefined;
	const rows = $derived(
		expanded ? (data?.shelves ?? []) : (data?.shelves ?? []).slice(0, 1).map(previewShelf)
	);
	const concerts = $derived((data?.concerts ?? []).slice(0, expanded ? undefined : 2));
	const options = $derived(data?.playlists ?? []);
	const hasRows = $derived(
		rows.some(
			(s) =>
				s.albums.length ||
				s.artists.length ||
				s.unlinked.length ||
				s.songs.length ||
				s.genres.length ||
				s.note ||
				s.radio
		) || concerts.length
	);
	const genreWidget = $derived(id === 'discover-genre_list' || id === 'discover-unexplored_genres');
	function pickPlaylist(value: string) {
		selectedPlaylist = value;
	}
	$effect(() => {
		const key = id,
			account = session,
			period = range,
			offset = offsets.at(-1) ?? 0,
			choice = selectedPlaylist;
		void retry;
		if (!active) return;
		let current = true,
			timer: ReturnType<typeof setTimeout>,
			checks = 0;
		const nextLoad = JSON.stringify([key, period, offset, choice]);
		if (lastLoad !== nextLoad || lastSession !== account) {
			busy = true;
			data = null;
		}
		lastLoad = nextLoad;
		lastSession = account;
		error = '';
		songStatus = '';
		pendingSong = null;
		async function load() {
			try {
				const result = await readWidget(account, key, period, offset, choice);
				if (!current) return;
				data = result;
				if (result.refreshing && checks++ < 6)
					timer = setTimeout(() => {
						if (!document.hidden && current) void load();
					}, 15000);
			} catch (cause) {
				if (current) error = errorMessage(cause);
			} finally {
				if (current) busy = false;
			}
		}
		void load();
		return () => {
			current = false;
			tap++;
			clearTimeout(timer);
		};
	});
	async function playSong(row: ShelfSong) {
		if (pendingSong) return;
		const token = ++tap;
		pendingSong = row;
		songStatus = '';
		try {
			const track = await playableSong(session, row);
			if (token !== tap) return;
			if (track) await onplay([track], 0);
			else songStatus = `${row.title} is unavailable in your library.`;
		} catch (cause) {
			if (token === tap) songStatus = errorMessage(cause);
		} finally {
			if (token === tap) pendingSong = null;
		}
	}
	const empty: Record<string, string> = {
		'discover-following': 'Artists you follow will appear here.',
		'discover-concerts': 'No upcoming concerts for your followed artists.',
		'discover-releases': 'No releases from followed artists in the last 90 days.'
	};
</script>

<div class="widget" data-part="discovery-feature" data-feature={id}>
	{#if expanded && isChart(id)}<label
			>Chart period<select bind:value={range} onchange={() => (offsets = [0])}
				><option value="this_week">This week</option><option value="this_month">This month</option
				><option value="this_year">This year</option><option value="all_time">All time</option
				></select
			></label
		>{/if}
	{#if busy}<p role="status">Loading…</p>{:else if error}<p role="alert">{error}</p>
		<button class="text-button" onclick={() => retry++}>Try again</button>
	{:else if data}
		{#if data.notice}<p>{data.notice}</p>{/if}
		{#if data.playlists}
			{#if options.length}
				{#if expanded}<label
						>Choose a playlist<select
							value={selectedPlaylist}
							onchange={(e) => pickPlaylist(e.currentTarget.value)}
							><option value="">Select a playlist</option>{#each options as p (p.id)}<option
									value={p.id}>{p.name}</option
								>{/each}</select
						></label
					>
				{:else}{#each options.slice(0, 3) as p (p.id)}<div class="simple">{p.name}</div>{/each}{/if}
			{:else}<p>Create a playlist in your library to get suggestions for it.</p>{/if}
		{/if}
		{#if expanded && data.cards}<DiscoverDeck
				{session}
				cards={data.cards}
				queue={id === 'discover-discover_queue'}
				{onopen}
				onrefresh={() => retry++}
			/>{:else if genreWidget && expanded && !data.notice}<DiscoverGenres
				{session}
				{onopen}
				{onartist}
				{onplay}
				{active}
				names={rows.flatMap((s) => s.genres)}
			/>
		{:else}
			{#each rows as shelf (shelf)}
				<DiscoverShelf
					{session}
					shelf={{ ...shelf, title: rows.length > 1 ? shelf.title : '' }}
					{onopen}
					{onartist}
				/>
				{#if shelf.note}<p>{shelf.note}</p>{/if}
				{#if shelf.radio && expanded}<LibraryRadio
						{session}
						seedType={shelf.radio.kind}
						seedId={shelf.radio.id}
						{onplay}
					/>{/if}
				{#each shelf.songs as song, j (song)}<TrackRow
						title={song.title}
						artist={song.artist}
						position={j + 1}
						onplay={() => playSong(song)}
					/>{/each}
				{#if shelf.genres.length}<div class="chips">
						{#each shelf.genres as genre (genre)}<span>{genre}</span>{/each}
					</div>{/if}
			{/each}
		{/if}
		{#each concerts as concert (concert)}<article>
				<time datetime={concert.local_date}>{concert.local_date}</time><strong
					>{concert.event_name}</strong
				><span
					>{[concert.venue_name, concert.city || concert.matched_city, concert.country_code]
						.filter(Boolean)
						.join(' · ')}</span
				>{#if concert.status !== 'scheduled'}<span
						>{concert.status === 'cancelled' ? 'Cancelled' : 'Rescheduled'}</span
					>{/if}<button
					class="text-button"
					onclick={() => onartist({ id: concert.artist_mbid, name: concert.artist_name })}
					>{concert.artist_name}</button
				>
			</article>{/each}
		{#if !data.notice && !hasRows && !(expanded && data.cards) && !data.playlists && !(genreWidget && expanded)}<p
			>
				{empty[id] ?? 'No items for this section yet.'}
			</p>{/if}
		{#if expanded && isChart(id) && (offsets.length > 1 || data.next != null)}<div class="pages">
				<button
					class="secondary"
					disabled={offsets.length === 1}
					onclick={() => (offsets = offsets.slice(0, -1))}>Previous</button
				><span>Page {offsets.length}</span><button
					class="secondary"
					disabled={data.next == null}
					onclick={() => {
						if (data?.next != null) offsets = [...offsets, data.next];
					}}>Next</button
				>
			</div>{/if}
		{#if pendingSong}<p role="status">
				Finding {pendingSong.title} in your library…
			</p>{:else if songStatus}<p role="status">{songStatus}</p>{/if}
	{/if}
</div>

<style>
	.widget {
		min-width: 0;
	}
	.widget p {
		color: var(--muted);
	}
	label {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.7rem;
		margin-block: 0.55rem;
	}
	.chips span {
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.chips,
	.pages {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.45rem;
	}
	.pages {
		justify-content: space-between;
	}
	article {
		display: grid;
		justify-items: start;
		gap: 0.15rem;
		padding-block: 0.45rem;
		border-bottom: 1px solid var(--line);
	}
	article time,
	article span {
		color: var(--muted);
		font-size: 0.88rem;
	}
	.simple {
		padding-block: 0.5rem;
		border-bottom: 1px solid var(--line);
	}
	select {
		max-width: 100%;
		min-height: 44px;
	}
</style>
