<script lang="ts">
	import { ArrowLeft } from '@lucide/svelte';
	import type { Session } from '../connection';
	import {
		artistCover,
		artistReleases,
		follow,
		followStatus,
		type DiscoverArtistRef
	} from './discovery';
	import { errorMessage, type Album, type OnPlay } from './catalog';
	import LibraryRadio from './LibraryRadio.svelte';
	import ArtistChart from './ArtistChart.svelte';
	import Cover from './Cover.svelte';
	import { loadNearEnd } from './browseViewport';
	import SelectionHost from './SelectionHost.svelte';
	import Albums from './Albums.svelte';

	let {
		session,
		artist,
		onopen,
		onplay,
		onback,
		library = false,
		active = true
	}: {
		session: Session;
		artist: DiscoverArtistRef;
		onopen: (a: Album) => void;
		onplay: OnPlay;
		onback: () => void;
		library?: boolean;
		active?: boolean;
	} = $props();
	let view = $state<'releases' | 'albums' | 'songs'>('releases');
	let refresh = $state(0),
		followRefresh = $state(0),
		albums = $state<Album[]>([]),
		releaseError = $state('');
	let next = $state<number | null>(),
		cursor = $state<string | null>(),
		warming = $state(false),
		busy = $state(true),
		adding = $state(false);
	let status = $state<Awaited<ReturnType<typeof followStatus>> | null>(null),
		followError = $state(''),
		saving = $state(false);
	let generation = 0;
	$effect(() => {
		const account = session,
			target = artist;
		void refresh;
		let current = true;
		generation++;
		albums = [];
		next = cursor = undefined;
		warming = false;
		busy = true;
		adding = false;
		releaseError = '';
		void artistReleases(account, target, 0)
			.then(
				(page) => {
					if (!current) return;
					albums = page.albums;
					next = page.next;
					cursor = page.cursor;
					warming = page.warming;
				},
				(cause) => {
					if (current) releaseError = errorMessage(cause);
				}
			)
			.finally(() => {
				if (current) busy = false;
			});
		return () => {
			current = false;
			generation++;
		};
	});
	async function more() {
		if (adding || busy) return;
		const owner = generation;
		adding = true;
		releaseError = '';
		try {
			const page = await artistReleases(session, artist, next ?? 0, cursor ?? undefined);
			if (owner !== generation) return;
			const ids = new Set(albums.map((a) => a.localId || a.group));
			albums = [...albums, ...page.albums.filter((a) => !ids.has(a.localId || a.group))];
			next = page.next;
			cursor = page.cursor;
			warming = page.warming;
		} catch (cause) {
			if (owner === generation) releaseError = errorMessage(cause);
		} finally {
			if (owner === generation) adding = false;
		}
	}
	$effect(() => {
		const account = session,
			target = artist;
		void followRefresh;
		let current = true;
		status = null;
		followError = '';
		saving = false;
		if (!target.localOnly)
			void followStatus(account, target.id).then(
				(v) => {
					if (current) status = v;
				},
				(cause) => {
					if (current) followError = errorMessage(cause);
				}
			);
		return () => {
			current = false;
		};
	});
	async function toggle() {
		if (!status || saving) return;
		const account = session,
			target = artist;
		saving = true;
		followError = '';
		try {
			const changed = await follow(account, target.id, !status.followed);
			if (account === session && target.id === artist.id) status = changed;
		} catch (cause) {
			if (account === session && target.id === artist.id) followError = errorMessage(cause);
		} finally {
			if (account === session && target.id === artist.id) saving = false;
		}
	}
</script>

<button class="secondary" onclick={onback}><ArrowLeft size={16} /> Back</button>
<section data-part="artist-detail">
	<header>
		<div class="photo"><Cover {session} path={artistCover(artist)} seed={artist.id} /></div>
		<div>
			<h1>{artist.name}</h1>
			{#if !artist.localOnly}<LibraryRadio
					{session}
					seedType="artist"
					seedId={artist.id}
					{onplay}
				/>{/if}
			{#if status}<button
					class="secondary"
					disabled={saving}
					aria-pressed={status.followed}
					onclick={toggle}>{status.followed ? 'Unfollow artist' : 'Follow artist'}</button
				>{/if}
		</div>
	</header>
	{#if followError}<p role="alert">{followError}</p>
		{#if !status}<button class="secondary" onclick={() => followRefresh++}
				>Reload follow status</button
			>{/if}{/if}
	{#if !artist.localOnly}<select aria-label="Artist view" bind:value={view}
			><option value="releases">Releases</option><option value="albums">Top albums</option><option
				value="songs">Top songs</option
			></select
		>{/if}
	<SelectionHost {session} {onplay} {active} enabled={library} scope={artist.id + view}>
		{#if view !== 'releases' && !artist.localOnly}<ArtistChart
				{session}
				{artist}
				{view}
				{onopen}
				{onplay}
			/>{:else if busy}<p role="status">Loading releases…</p>
		{:else}
			{#if albums.length}<Albums
					{session}
					{albums}
					{onopen}
				/>{:else if !releaseError && !warming}<p>No releases found.</p>{/if}
			{#if releaseError}<p role="alert">{releaseError}</p>
				{#if !albums.length}<button class="secondary" onclick={() => refresh++}>Try again</button
					>{/if}{/if}
			{#if next != null || cursor}<button
					class="secondary"
					data-selection-more={(library && !releaseError) || undefined}
					use:loadNearEnd={{ active, enabled: library && !adding && !releaseError, load: more }}
					disabled={adding}
					onclick={more}>{adding ? 'Loading…' : 'More releases'}</button
				>{/if}
			{#if warming}<p role="status">DroppedNeedle is loading the artist’s catalog.</p>
				<button class="secondary" onclick={() => refresh++}>Refresh releases</button>{/if}
		{/if}
	</SelectionHost>
</section>

<style>
	header {
		display: flex;
		align-items: center;
		gap: var(--gap);
		margin-block: 1.2rem;
	}
	.photo {
		width: clamp(4.5rem, 24vw, 8rem);
		flex: none;
		border-radius: 50%;
		overflow: hidden;
	}
	header h1 {
		overflow-wrap: anywhere;
		margin: 0 0 0.6rem;
	}
</style>
