<script lang="ts">
	import { uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import WebDetail from './WebDetail.svelte';
	import { onMount } from 'svelte';
	import { ArrowLeft, Play } from '@lucide/svelte';
	import type { Session } from '../connection';
	import type { PlayerTrack } from '../player';
	import {
		albumTracks,
		editions,
		editionLabel,
		editionTracks,
		errorMessage,
		requestAlbum,
		type Album,
		type Edition,
		type OnPlay
	} from './catalog';
	import LibraryRadio from './LibraryRadio.svelte';
	import HomePinButton from './HomePinButton.svelte';
	import { albumPin } from './homePins';
	import RequestSong from './RequestSong.svelte';
	import TrackActions from './TrackActions.svelte';
	import Favorite from './Favorite.svelte';
	import Cover from './Cover.svelte';
	import SelectionHost from './SelectionHost.svelte';
	import TrackList from './TrackList.svelte';
	import { trackChoice } from './librarySelection.svelte';
	import { detailInventory } from './detailInventory.svelte';
	import DetailAvailability from './DetailAvailability.svelte';
	import { matchesAvailability, type Availability } from '../offline/library';
	import { offlineSupported } from '../offline/media';
	let {
		album,
		session,
		onplay,
		onback,
		onrequests,
		foreground = true,
		backLabel = 'Back'
	}: {
		album: Album;
		session: Session;
		onplay: OnPlay;
		onback: () => void;
		onrequests: () => void;
		backLabel?: string;
		foreground?: boolean;
	} = $props();
	let tracks = $state<PlayerTrack[]>([]),
		choices = $state<Edition[]>([]),
		selected = $state('');
	let busy = $state(true),
		loadingEditions = $state(false),
		sending = $state(false);
	let error = $state(''),
		editionsError = $state(''),
		requestError = $state(''),
		receipt = $state('');
	let showEditions = $state(false);
	let listed = $state<Awaited<ReturnType<typeof editionTracks>> | null>(null),
		listError = $state(''),
		listBusy = $state(false);
	let active = true;
	const device = detailInventory(
		() => session,
		() => foreground && !!tracks.length
	);
	let availability = $state<Availability>('all');
	const rows = $derived(
		tracks
			.map((track, index) => ({ track, position: index + 1 }))
			.filter(
				({ track }) =>
					availability === 'all' ||
					(device.inventory && matchesAvailability(device.inventory, track.id, availability))
			)
	);
	const shown = $derived(rows.map((r) => r.track));
	const choicesInView = $derived(shown.map((track) => trackChoice(track)));
	const eligible = $derived(new Set(choicesInView.map((c) => c.id)));
	const countOnDevice = $derived(
		tracks.reduce((n, t) => n + Number(!!device.inventory?.byId.has(t.id)), 0)
	);
	export function getPlaybackAvailability() {
		return availability === 'all' ? undefined : availability;
	}
	async function loadChoices() {
		if (!album.group) return;
		loadingEditions = true;
		editionsError = '';
		try {
			const answer = await editions(session, album.group);
			if (!active) return;
			choices = answer.items;
			selected =
				answer.items.find((e) => e.release_mbid === (album.release ?? answer.selected_release_mbid))
					?.release_mbid ?? '';
		} catch (e) {
			if (active) editionsError = errorMessage(e);
		} finally {
			if (active) loadingEditions = false;
		}
	}
	async function load() {
		busy = true;
		error = '';
		try {
			const found = await albumTracks(session, album);
			if (!active) return;
			tracks = found;
			if (!tracks.length && !album.requested && !album.imported) await loadChoices();
		} catch (e) {
			if (active) error = errorMessage(e);
		} finally {
			if (active) busy = false;
		}
	}
	async function submit() {
		if (sending || receipt || busy) return;
		sending = true;
		requestError = '';
		try {
			const reply = await requestAlbum(session, album, selected || null);
			if (active) receipt = reply.message || 'Request received.';
		} catch (e) {
			if (active) requestError = errorMessage(e);
		} finally {
			if (active) sending = false;
		}
	}
	onMount(() => {
		void load();
		return () => {
			active = false;
		};
	});
	$effect(() => {
		const id = selected,
			group = album.group,
			account = session;
		listed = null;
		listError = '';
		listBusy = false;
		if (!id || !group) return;
		listBusy = true;
		let current = true;
		void editionTracks(account, group, id)
			.then(
				(rows) => {
					if (current) listed = rows;
				},
				(e) => {
					if (current) listError = errorMessage(e);
				}
			)
			.finally(() => {
				if (current) listBusy = false;
			});
		return () => {
			current = false;
		};
	});
</script>

<button class="secondary" onclick={onback}><ArrowLeft size={16} /> {uiText(backLabel)}</button>
<div class="detail" data-part="album-detail">
	<div class="art"><Cover {session} path={album.art} seed={album.group || album.title} /></div>
	<div>
		<h1>{album.title}</h1>
		<HomePinButton {session} pin={albumPin(album)} />
		<p>
			{album.artist}{#if album.year}
				· {album.year}{/if}
		</p>
	</div>
</div>
{#if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={load}>{uiText('Try again')}</button>
{:else if busy}<p role="status">{uiText('Loading album…')}</p>
{:else if tracks.length}
	<button class="primary" disabled={!shown.length} onclick={() => onplay(shown, 0)}
		><Play size={18} /> {uiText('Play album')}</button
	>
	{#if shown.length}<TrackActions
			{session}
			tracks={shown}
			deviceAvailable={!!device.inventory?.byId.has(shown[0].id)}
			label={uiText('Album actions')}
		/>{/if}
	{#if album.localId && album.favorite !== undefined}<Favorite
			{session}
			kind="album"
			id={album.localId}
			value={album.favorite}
		/>{/if}
	{#if offlineSupported && session.userId}<DetailAvailability
			source={device}
			available={countOnDevice}
			total={tracks.length}
			value={availability}
			onchange={(v) => (availability = v)}
		/>{/if}
	<SelectionHost
		{session}
		{onplay}
		active={foreground}
		scope={availability}
		choices={() => choicesInView}
		contains={(id) => eligible.has(id)}
	>
		<TrackList
			{session}
			tracks={shown}
			positions={rows.map((r) => r.position)}
			{device}
			{onplay}
			albumSheet
		/>
	</SelectionHost>
	{#if !shown.length && device.inventory}<p>{uiText('No tracks match this availability.')}</p>{/if}
	{#if album.group}<button
			class="text-button"
			aria-expanded={showEditions}
			onclick={() => {
				showEditions = !showEditions;
				if (showEditions && !choices.length) void loadChoices();
			}}>{uiText('Browse editions')}</button
		>{/if}
{:else if album.imported}
	<p>{uiText('This requested copy has no playable files in the library.')}</p>
	<button class="secondary" onclick={load}>{uiText('Refresh album')}</button>
{:else if receipt || album.requested}
	<p role="status">{receipt || uiText('This album has been requested.')}</p>
	<button class="primary" onclick={onrequests}>{uiText('View requests')}</button>
{:else if !album.group}<p>{uiText('This album has no playable tracks.')}</p>{/if}
{#if album.group && ((showEditions && tracks.length > 0) || (!busy && !error && !tracks.length && !album.imported && !album.requested && !receipt))}
	{#if editionsError}<p role="alert">{uiText('Editions could not be loaded.')} {editionsError}</p>
		<button class="secondary" disabled={loadingEditions || sending} onclick={loadChoices}
			>{uiText('Reload editions')}</button
		>{/if}
	<label
		>{uiText('Edition')}
		<InlineChoice {selected}
			><select bind:value={selected} disabled={sending || loadingEditions}>
				<option value="">{uiText('Server preference')}</option>
				{#each choices as edition (edition.release_mbid)}<option value={edition.release_mbid}
						>{editionLabel(edition)}</option
					>{/each}
			</select></InlineChoice
		>
	</label>
	{#if !tracks.length}<button class="primary" disabled={sending || loadingEditions} onclick={submit}
			>{sending ? uiText('Requesting…') : uiText('Request album')}</button
		>{/if}
	{#if requestError}<p role="alert">{requestError}</p>{/if}
	{#if listBusy}<p role="status">{uiText('Loading track list…')}</p>
	{:else if listError}<p role="alert">{listError}</p>
	{:else if listed?.tracks.length}<h2>{uiText('Tracks')}</h2>
		<ol>
			{#each listed.tracks as t (t)}<li>
					<span>{t.disc_number > 1 ? t.disc_number + '.' : ''}{t.position}</span>
					{t.title}
					{#if !tracks.length && t.recording_id}<RequestSong
							{session}
							song={{
								recording_mbid: t.recording_id,
								track_title: t.title,
								artist_name: album.artist,
								album_title: album.title,
								release_group_mbid: album.group,
								release_mbid: selected,
								duration_seconds: t.length == null ? null : Math.round(t.length / 1000)
							}}
						/>{/if}
				</li>{/each}
		</ol>{/if}
{/if}

{#if album.group && !busy && !error}<LibraryRadio
		{session}
		seedType="album"
		seedId={album.group}
		seedTitle={album.title}
		{onplay}
	/>{/if}

{#if album.localId}<WebDetail
		{session}
		route={'/library/albums/' + encodeURIComponent(album.localId)}
		label={uiText('Open album in web app')}
	/>{:else if album.group}<WebDetail
		{session}
		route={'/album/' + encodeURIComponent(album.group)}
		label={uiText('Open album in web app')}
	/>{/if}

<style>
	.detail {
		display: flex;
		align-items: center;
		gap: var(--gap);
		margin: 1.2rem 0;
	}
	.detail .art {
		width: clamp(5rem, 27vw, 10rem);
		flex: none;
	}
	.detail h1 {
		font-size: clamp(1.4rem, 5vw, 2.3rem);
		line-height: 1.1;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.detail p {
		margin: 0.5rem 0 0;
		color: var(--muted);
	}
	label {
		display: grid;
		gap: 0.45rem;
		margin-block: 1rem;
	}
	select {
		width: 100%;
		min-width: 0;
		padding: 0.7rem;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		font: inherit;
	}
	ol {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		padding: 0.65rem 0.1rem;
		border-bottom: 1px solid var(--line);
	}
	li span {
		display: inline-block;
		min-width: 1.7rem;
		color: var(--muted);
	}
</style>
