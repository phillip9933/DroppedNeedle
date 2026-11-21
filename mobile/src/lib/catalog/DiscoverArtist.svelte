<script lang="ts">
	import { uiText, tr } from '../i18n';

	import InlineChoice from '../controls/InlineChoice.svelte';

	import { UserRoundPlus, UserRoundCheck } from '@lucide/svelte';
	import ArtistHeader from './ArtistHeader.svelte';
	import type { Session } from '../connection';
	import {
		artistReleases,
		follow,
		followStatus,
		type DiscoverArtistRef,
		type ReleaseType
	} from './discovery';
	import { errorMessage, type Album, type OnPlay } from './catalog';
	import ArtistChart from './ArtistChart.svelte';
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
	let releaseType = $state<ReleaseType>('all');
	let pageRequest: AbortController | undefined;
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
			target = artist,
			type = releaseType;
		const request = new AbortController();
		void refresh;
		let current = true;
		generation++;
		albums = [];
		next = cursor = undefined;
		warming = false;
		busy = true;
		adding = false;
		releaseError = '';
		void artistReleases(account, target, 0, undefined, type, request.signal)
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
			request.abort();
			pageRequest?.abort();
			generation++;
		};
	});
	async function more() {
		if (adding || busy) return;
		const owner = generation;
		pageRequest = new AbortController();
		adding = true;
		releaseError = '';
		try {
			const page = await artistReleases(
				session,
				artist,
				next ?? 0,
				cursor ?? undefined,
				releaseType,
				pageRequest.signal
			);
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

<section data-part="artist-detail">
	<ArtistHeader
		{session}
		name={artist.name}
		localId={artist.localOnly ? artist.id : undefined}
		mbid={artist.localOnly ? undefined : artist.id}
		backLabel="Back"
		{onback}
		{onplay}
		radioFirst
	>
		{#snippet actions()}
			{#if status}<button
					class="icon-button"
					disabled={saving}
					aria-pressed={status.followed}
					aria-label={uiText(status.followed ? 'Unfollow artist' : 'Follow artist')}
					title={uiText(status.followed ? 'Unfollow artist' : 'Follow artist')}
					onclick={toggle}
					>{#if status.followed}<UserRoundCheck size={19} />{:else}<UserRoundPlus
							size={19}
						/>{/if}</button
				>{/if}
		{/snippet}
	</ArtistHeader>
	{#if followError}<p role="alert">{followError}</p>
		{#if !status}<button class="secondary" onclick={() => followRefresh++}
				>{uiText('Reload follow status')}</button
			>{/if}{/if}
	<div class="artist-filters">
		{#if !artist.localOnly}<InlineChoice selected={view} label={uiText('Artist view')}
				><select bind:value={view}
					><option value="releases">{uiText('Releases')}</option><option value="albums"
						>{uiText('Top albums')}</option
					><option value="songs">{uiText('Top songs')}</option></select
				></InlineChoice
			>{/if}
		{#if !artist.localOnly && view === 'releases'}
			<InlineChoice selected={releaseType} label={tr('Release type', 'リリースの種類')}
				><select bind:value={releaseType}>
					<option value="all">{tr('All releases', 'すべてのリリース')}</option>
					<option value="albums">{tr('Albums', 'アルバム')}</option>
					<option value="eps">{tr('EPs', 'EP')}</option>
					<option value="singles">{tr('Singles', 'シングル')}</option>
				</select></InlineChoice
			>
		{/if}
	</div>
	<SelectionHost
		{session}
		{onplay}
		{active}
		enabled={library}
		scope={artist.id + view + releaseType}
	>
		{#if view !== 'releases' && !artist.localOnly}<ArtistChart
				{session}
				{artist}
				{view}
				{onopen}
				{onplay}
			/>{:else if busy}<p role="status">{uiText('Loading releases…')}</p>
		{:else}
			{#if albums.length}<Albums
					{session}
					{albums}
					{onopen}
				/>{:else if !releaseError && !warming}<p>{uiText('No releases found.')}</p>{/if}
			{#if releaseError}<p role="alert">{releaseError}</p>
				{#if !albums.length}<button class="secondary" onclick={() => refresh++}
						>{uiText('Try again')}</button
					>{/if}{/if}
			{#if next != null || cursor}<button
					class="secondary"
					data-selection-more={(library && !releaseError) || undefined}
					use:loadNearEnd={{ active, enabled: library && !adding && !releaseError, load: more }}
					disabled={adding}
					onclick={more}>{adding ? uiText('Loading…') : uiText('More releases')}</button
				>{/if}
			{#if warming}<p role="status">{uiText('DroppedNeedle is loading the artist’s catalog.')}</p>
				<button class="secondary" onclick={() => refresh++}>{uiText('Refresh releases')}</button
				>{/if}
		{/if}
	</SelectionHost>
</section>

<style>
	.artist-filters {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.artist-filters {
		margin-bottom: 0.4rem;
	}
</style>
