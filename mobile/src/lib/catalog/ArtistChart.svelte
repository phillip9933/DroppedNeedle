<script lang="ts">
	import { uiText } from '../i18n';
	import type { Session } from '../connection';
	import { errorMessage, type Album, type OnPlay } from './catalog';
	import { artistChart, type DiscoverArtistRef } from './discovery';
	import Albums from './Albums.svelte';
	import { trackChoice } from './librarySelection.svelte';
	import TrackRow from './TrackRow.svelte';
	let {
		session,
		artist,
		view,
		onplay,
		onopen
	}: {
		session: Session;
		artist: DiscoverArtistRef;
		view: 'albums' | 'songs';
		onplay: OnPlay;
		onopen: (a: Album) => void;
	} = $props();
	let retry = $state(0),
		result = $state<Awaited<ReturnType<typeof artistChart>> | null>(null),
		error = $state('');
	$effect(() => {
		const account = session,
			target = artist,
			kind = view;
		void retry;
		let current = true;
		result = null;
		error = '';
		void artistChart(account, target, kind).then(
			(data) => {
				if (current) result = data;
			},
			(cause) => {
				if (current) error = errorMessage(cause);
			}
		);
		return () => {
			current = false;
		};
	});
</script>

<section data-part="artist-chart">
	{#if error}<p role="alert">{error}</p>
		<button class="secondary" onclick={() => retry++}>{uiText('Try again')}</button
		>{:else if !result}<p role="status">
			{uiText('Loading chart…')}
		</p>
	{:else if result.list && (result.list.albums.length || result.list.unlinked.length)}<Albums
			{session}
			albums={result.list.albums}
			{onopen}
		/>{#each result.list.unlinked as label, i (`${i}/${label}`)}<p>{label}</p>{/each}
	{:else if result.songs?.length}{@const tracks =
			result.queue}{#each result.songs as entry, i (entry)}{@const index = entry.index}<TrackRow
				choice={index != null && tracks?.[index]
					? trackChoice(tracks[index], 'chart:' + i)
					: undefined}
				title={entry.song.title}
				artist={entry.song.artist_name}
				position={i + 1}
				onplay={index != null && tracks ? () => onplay(tracks, index) : undefined}
			/>{/each}
	{:else}<p>{result.notice || `No top ${view} found for this artist.`}</p>{/if}
</section>
