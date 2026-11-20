<script lang="ts">
	import type { Session } from '../connection';
	import {
		discover,
		type DiscoverView,
		type DiscoverArtistRef,
		type ChartRange,
		type DiscoveryPage
	} from './discovery';
	import { errorMessage, type Album } from './catalog';
	import Albums from './Albums.svelte';
	import Cover from './Cover.svelte';

	let {
		session,
		onopen,
		onartist,
		active = true
	}: {
		session: Session;
		onopen: (a: Album) => void;
		onartist: (a: DiscoverArtistRef) => void;
		active?: boolean;
	} = $props();
	let view = $state<DiscoverView>('recommendations'),
		range = $state<ChartRange>('this_month');
	let offsets = $state<number[]>([0]),
		refresh = $state(0),
		busy = $state(false),
		error = $state('');
	let result = $state<DiscoveryPage | null>(null);
	let lastPage = '';
	let lastSession: Session | undefined;
	const chart = $derived(view === 'popular' || view === 'trending' || view === 'top');
	const empty: Record<DiscoverView, string> = {
		recommendations:
			'No recommendations yet. Play music in your library to build your listening history.',
		popular: 'No popular albums for this period.',
		trending: 'No trending artists for this period.',
		top: 'No listening history for this period.',
		following: 'Artists you follow will appear here.',
		releases: 'No releases from followed artists in the last 90 days.',
		concerts: 'No upcoming concerts for your followed artists.'
	};
	const hasRows = $derived(
		result?.shelves.some((s) => s.albums.length || s.artists.length || s.unlinked.length) ||
			result?.concerts?.length
	);
	$effect(() => {
		const account = session,
			selected = view,
			windowRange = range,
			page = offsets.at(-1) ?? 0;
		void refresh;
		if (!active) return;
		let current = true,
			timer: ReturnType<typeof setTimeout>,
			reads = 0;
		const pageKey = [selected, windowRange, page].join('/');
		const newPage = lastSession !== account || lastPage !== pageKey;
		busy = newPage;
		error = '';
		if (newPage) result = null;
		async function load() {
			try {
				const answer = await discover(account, selected, windowRange, page);
				if (!current) return;
				lastSession = account;
				lastPage = pageKey;
				result = answer;
				if (answer.refreshing && reads++ < 6)
					timer = setTimeout(() => {
						if (!document.hidden && current) void load();
					}, 10000);
			} catch (cause) {
				if (current) error = errorMessage(cause);
			} finally {
				if (current) busy = false;
			}
		}
		void load();
		return () => {
			current = false;
			clearTimeout(timer);
		};
	});
</script>

<section data-part="discover">
	<h1>Discover</h1>
	<div class="filters">
		<select bind:value={view} aria-label="Discover view" onchange={() => (offsets = [0])}>
			<option value="recommendations">For you</option>
			<optgroup label="Charts"
				><option value="popular">Popular albums</option><option value="trending"
					>Trending artists</option
				><option value="top">Your top albums</option></optgroup
			>
			<optgroup label="Following"
				><option value="following">Followed artists</option><option value="releases"
					>New releases</option
				><option value="concerts">Upcoming concerts</option></optgroup
			>
		</select>
		{#if chart}<select
				bind:value={range}
				aria-label="Chart period"
				onchange={() => (offsets = [0])}
			>
				<option value="this_week">This week</option><option value="this_month">This month</option
				><option value="this_year">This year</option><option value="all_time">All time</option>
			</select>{/if}
	</div>
	{#if error}<p role="alert">{error}</p>
		<button class="secondary" onclick={() => refresh++}>Try again</button>
	{:else if busy}<p role="status">Loading…</p>
	{:else if result}
		{#if result.refreshing}<p role="status">DroppedNeedle is updating recommendations.</p>{/if}
		{#if result.notice}<p role="status">
				{result.notice}
			</p>{:else if !hasRows && !result.refreshing}<p>{empty[view]}</p>{/if}
		{#each result.shelves as shelf}
			{#if shelf.title}<h2>{shelf.title}</h2>{/if}
			{#if shelf.albums.length}<Albums {session} albums={shelf.albums} {onopen} />{/if}
			{#each shelf.artists as artist}
				{@const target = artist.target}
				{#if target}<button class="artist" onclick={() => onartist(target)}
						><span class="avatar"><Cover {session} path={artist.art} seed={target.id} /></span
						><strong>{artist.name}</strong></button
					>
				{:else}<p>{artist.name}</p>{/if}
			{/each}
			{#each shelf.unlinked as text}<p>{text}</p>{/each}
		{/each}
		{#each result.concerts ?? [] as concert}
			<article data-part="concert">
				<time datetime={concert.local_date}>{concert.local_date}</time>
				<strong>{concert.event_name}</strong><span
					>{[concert.venue_name, concert.city || concert.matched_city, concert.country_code]
						.filter(Boolean)
						.join(' · ')}</span
				>
				{#if concert.status !== 'scheduled'}<span
						>{concert.status === 'cancelled' ? 'Cancelled' : 'Rescheduled'}</span
					>{/if}
				<button
					class="text-button"
					onclick={() => onartist({ id: concert.artist_mbid, name: concert.artist_name })}
					>{concert.artist_name}</button
				>
			</article>
		{/each}
	{/if}
	{#if offsets.length > 1 || result?.next != null}
		<div class="pages">
			<button
				class="secondary"
				disabled={busy || offsets.length < 2}
				onclick={() => (offsets = offsets.slice(0, -1))}>Previous</button
			>
			<span>Page {offsets.length}</span><button
				class="secondary"
				disabled={busy || result?.next == null}
				onclick={() => {
					if (result?.next != null) offsets = [...offsets, result.next];
				}}>Next</button
			>
		</div>
	{/if}
</section>

<style>
	.filters,
	.pages {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin-block: var(--gap);
	}
	select {
		min-height: 44px;
		max-width: 100%;
		font: inherit;
		padding: 0.45rem 0.7rem;
		border-radius: var(--radius);
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--text);
	}
	.artist {
		display: flex;
		align-items: center;
		text-align: start;
		width: 100%;
		gap: var(--gap);
		padding: 0.45rem 0;
		min-height: 48px;
		border-bottom: 1px solid var(--line);
		color: var(--text);
	}
	.avatar {
		flex: 0 0 2.7rem;
		border-radius: 50%;
		overflow: hidden;
	}
	.pages {
		justify-content: space-between;
	}
	article {
		display: grid;
		justify-items: start;
		gap: 0.2rem;
		border-bottom: 1px solid var(--line);
		padding: 0.8rem 0;
	}
	article span,
	article time {
		font-size: 0.9rem;
		color: var(--muted);
	}
</style>
