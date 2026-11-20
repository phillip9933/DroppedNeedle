<script lang="ts" module>
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	type ArtistView = components['schemas']['ArtistView'];
	export type LocalArtist = Pick<ArtistView, 'id' | 'name'> &
		Partial<Pick<ArtistView, 'favorite' | 'artist_mbid' | 'album_count'>>;
</script>

<script lang="ts">
	import WebDetail from './WebDetail.svelte';
	import { getJson, type Session } from '../connection';
	import { errorMessage, path, type Album, type OnPlay } from './catalog';
	import type { DiscoverArtistRef } from './discovery';
	import Favorite from './Favorite.svelte';
	import SelectionHost from './SelectionHost.svelte';
	import Library from './Library.svelte';
	let {
		session,
		artist,
		active,
		onopen,
		onartist,
		ondiscover,
		onplay,
		onback,
		backLabel = 'Back to artists'
	}: {
		session: Session;
		artist: LocalArtist;
		active: boolean;
		onopen: (a: Album) => void;
		onartist: (a: LocalArtist) => void;
		ondiscover: (a: DiscoverArtistRef) => void;
		onplay: OnPlay;
		onback: () => void;
		backLabel?: string;
	} = $props();
	let view = $state<'albums' | 'songs' | 'appearances'>('albums'),
		summary = $state<ArtistView | null>(null),
		error = $state(''),
		retry = $state(0);
	const current = $derived(summary ?? artist);
	$effect(() => {
		const account = session,
			chosen = artist;
		void retry;
		let valid = true;
		summary = null;
		error = '';
		// Library lists already supply the summary. Search can open an artist using only a local ID and name.
		if (chosen.favorite === undefined && chosen.album_count === undefined)
			void getJson<ArtistView>(
				account,
				path('/api/v3/library/artists/{id}', { id: chosen.id })
			).then(
				(row) => {
					if (valid) summary = row;
				},
				(cause) => {
					if (valid) error = errorMessage(cause);
				}
			);
		return () => {
			valid = false;
		};
	});
</script>

<button class="text-button" onclick={onback}>{backLabel}</button>
<section data-part="local-artist-detail">
	<h1>{current.name}</h1>
	<div class="actions">
		{#if current.favorite !== undefined}<Favorite
				{session}
				kind="artist"
				id={current.id}
				value={current.favorite}
			/>{/if}
		{#if current.artist_mbid}<button
				class="secondary"
				onclick={() => {
					if (current.artist_mbid) ondiscover({ id: current.artist_mbid, name: current.name });
				}}>Artist profile</button
			>{/if}
		<WebDetail
			{session}
			route={'/library/artists/' + encodeURIComponent(artist.id)}
			label="Open artist in web app"
		/>
	</div>
	{#if error}<p role="alert">{error}</p>
		<button class="text-button" onclick={() => retry++}>Reload artist profile</button>{/if}
	<label
		>Artist library view<select bind:value={view}
			><option value="albums">Albums</option><option value="songs">Songs</option><option
				value="appearances">Appears on</option
			></select
		></label
	>
	{#key view}<SelectionHost {session} {onplay} {active}
			><Library
				{active}
				{session}
				{artist}
				kind={view === 'songs' ? 'songs' : 'albums'}
				artistAppearances={view === 'appearances'}
				{onopen}
				{onartist}
				{onplay}
			/></SelectionHost
		>{/key}
</section>

<style>
	.actions,
	label {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
	}
	label {
		margin-block: var(--gap);
	}
	h1 {
		overflow-wrap: anywhere;
	}
</style>
