<script lang="ts" module>
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	type ArtistView = components['schemas']['ArtistView'];
	export type LocalArtist = Pick<ArtistView, 'id' | 'name'> &
		Partial<Pick<ArtistView, 'favorite' | 'artist_mbid' | 'album_count'>>;
</script>

<script lang="ts">
	import { uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import WebDetail from './WebDetail.svelte';
	import { getJson, type Session } from '../connection';
	import { errorMessage, path, type Album, type OnPlay } from './catalog';
	import type { DiscoverArtistRef } from './discovery';
	import Favorite from './Favorite.svelte';
	import HomePinButton from './HomePinButton.svelte';
	import { artistPin } from './homePins';
	import SelectionHost from './SelectionHost.svelte';
	import Library from './Library.svelte';
	import OwnedArtistAlbums from './OwnedArtistAlbums.svelte';
	import { tr } from '../i18n';
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
	let releaseType = $state<'all' | 'album' | 'ep' | 'single' | 'other' | 'unknown'>('all');
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

<button class="text-button" onclick={onback}>{uiText(backLabel)}</button>
<section data-part="local-artist-detail">
	<h1>{current.name}</h1>
	<div class="actions">
		<HomePinButton {session} pin={artistPin(current.name, current.id, current.artist_mbid)} />
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
				}}>{uiText('Artist profile')}</button
			>{/if}
		<WebDetail
			{session}
			route={'/library/artists/' + encodeURIComponent(artist.id)}
			label={uiText('Open artist in web app')}
		/>
	</div>
	{#if error}<p role="alert">{error}</p>
		<button class="text-button" onclick={() => retry++}>{uiText('Reload artist profile')}</button
		>{/if}
	<label
		>{uiText('Artist library view')}<InlineChoice selected={view}
			><select bind:value={view}
				><option value="albums">{uiText('Albums')}</option><option value="songs"
					>{uiText('Songs')}</option
				><option value="appearances">{uiText('Appears on')}</option></select
			></InlineChoice
		></label
	>
	{#if view === 'albums'}<InlineChoice
			selected={releaseType}
			label={tr('Release type', 'リリースの種類')}
			><select bind:value={releaseType}>
				<option value="all">{tr('All releases', 'すべてのリリース')}</option>
				<option value="album">{tr('Albums', 'アルバム')}</option>
				<option value="ep">{tr('EPs', 'EP')}</option>
				<option value="single">{tr('Singles', 'シングル')}</option>
				<option value="other">{tr('Other releases', 'その他のリリース')}</option>
				<option value="unknown">{tr('Unknown', '不明')}</option>
			</select></InlineChoice
		>{/if}
	{#key view}<SelectionHost {session} {onplay} {active} scope={view + releaseType}
			>{#if view === 'albums' && releaseType !== 'all'}<OwnedArtistAlbums
					{session}
					artistId={artist.id}
					artistMbid={current.artist_mbid}
					kind={releaseType}
					{active}
					{onopen}
				/>{:else}<Library
					{active}
					{session}
					{artist}
					kind={view === 'songs' ? 'songs' : 'albums'}
					artistAppearances={view === 'appearances'}
					{onopen}
					{onartist}
					{onplay}
				/>{/if}</SelectionHost
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
