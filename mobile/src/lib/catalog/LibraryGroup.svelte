<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Play, Shuffle } from '@lucide/svelte';
	import type { Session } from '../connection';
	import type { PlayerTrack } from '../player';
	import { errorMessage, type OnPlay } from './catalog';
	import { offlineSupported } from '../offline/media';
	import { availableTracks, matchesAvailability, type Availability } from '../offline/library';
	import { detailInventory, type DetailInventory } from './detailInventory.svelte';
	import DetailAvailability from './DetailAvailability.svelte';
	import { albumTrackCount } from './albumTrackCounts';
	import { offlinePlaylists } from './playlistOffline';
	import { smartPlaylistTracks } from './smartPlaylists';
	import { deviceTrackOrder, matchesDeviceTrack } from './trackFilters';
	import {
		browseChoice,
		localAlbumKey,
		type BrowseItem,
		type DeviceCollection,
		trackOccurrences
	} from './libraryBrowse';
	import { loadNearEnd } from './browseViewport';
	import { tappedPlayback, type PageEnd } from './browsePlayback';
	import { untrack } from 'svelte';
	import { shuffled } from './browseActions';
	import { queueSizeCheck } from './libraryQueue';
	import { genreTracksPage, tracksInGenre } from './libraryGenres';
	import { prepareLibraryPlayback } from '../player/libraryWindow';
	import SelectionHost from './SelectionHost.svelte';
	import BrowseEntries from './BrowseEntries.svelte';

	let {
		session,
		item,
		tracks,
		offline,
		source,
		collection,
		initialAvailability = 'all',
		onplay,
		active
	}: {
		session: Session;
		item: BrowseItem;
		tracks: PlayerTrack[];
		offline: boolean;
		source?: DetailInventory;
		collection?: DeviceCollection;
		initialAvailability?: Availability;
		onplay: OnPlay;
		active: boolean;
	} = $props();
	let limit = $state(48),
		error = $state(''),
		busy = $state(false);
	let results = $state<BrowseEntries>(),
		returnItem = '',
		inBackground = false,
		shownDocument = $state(!document.hidden);
	const pages: PageEnd[] = [];
	const remoteGenre = $derived(item.genre !== undefined && !item.localTracks);
	let serverTracks = $state.raw<PlayerTrack[]>([]),
		cursor = $state<string | null>(null),
		knownTotal = $state<number>(),
		reading = $state(false),
		pageError = $state(''),
		pageRead: AbortController | undefined,
		queueRead = $state<AbortController>();
	const ownSource = detailInventory(
		() => session,
		() => !source && active
	);
	const device = $derived(source ?? ownSource);
	const inventory = $derived(device.inventory);
	const isAlbum = $derived(item.id.startsWith('Albums:'));
	const isPlaylist = $derived(item.id.startsWith('playlist:') || !!item.smart);
	const showAvailability = $derived(
		offlineSupported && !!session.userId && (isAlbum || isPlaylist)
	);
	const deviceOnly = $derived(!!collection || offline || !!item.localTracks);
	let availability = $state<Availability>(untrack(() => initialAvailability));
	const filter = $derived(availability === 'all' && deviceOnly ? 'offline' : availability);
	export function getPlaybackAvailability() {
		return filter === 'all' ? undefined : filter;
	}
	let smartTracks = $state.raw<PlayerTrack[]>(),
		smartError = $state(''),
		smartRevision = $state(0);
	$effect(() => {
		const data = inventory,
			rule = item.smart,
			owner = session;
		void smartRevision;
		if (!collection || !rule || !data || !active) return;
		const job = new AbortController();
		smartError = '';
		void smartPlaylistTracks(owner, rule, job.signal, availableTracks(data)).then(
			(result) => {
				if (!job.signal.aborted) smartTracks = result;
			},
			(cause) => {
				if (!job.signal.aborted) smartError = errorMessage(cause);
			}
		);
		return () => job.abort();
	});
	const savedAlbum = $derived(
		isAlbum && inventory && deviceOnly
			? availableTracks(inventory).filter((t) => 'Albums:' + localAlbumKey(t) === item.id)
			: undefined
	);
	const candidates = $derived.by(() => {
		if (!deviceOnly) return tracks;
		if (!inventory) return [];
		if (collection?.category === 'Albums') {
			const filters = { ...collection.filters, q: '' };
			return (savedAlbum ?? [])
				.filter((t) => matchesDeviceTrack(t, filters))
				.sort(deviceTrackOrder({ sort: 'album', order: 'asc' }));
		}
		if (collection?.category === 'Playlists') {
			if (item.smart) return smartTracks ?? [];
			return offlinePlaylists(session, availableTracks(inventory), item.id)[0]?.localTracks ?? [];
		}
		return tracks.flatMap((t) => inventory?.byId.get(t.id)?.track ?? []);
	});
	const countOnDevice = $derived(
		savedAlbum?.length ?? candidates.reduce((n, t) => n + Number(!!inventory?.byId.has(t.id)), 0)
	);
	const knownPlayable = $derived(
		!deviceOnly
			? candidates.length
			: (item.knownPlayable ??
					(isAlbum
						? albumTrackCount(session, candidates[0]?.albumId ?? tracks[0]?.albumId)
						: undefined))
	);
	const filteredTracks = $derived(
		!showAvailability || filter === 'all'
			? candidates
			: candidates.filter((t) => inventory && matchesAvailability(inventory, t.id, filter))
	);
	const shown = $derived(remoteGenre ? serverTracks : filteredTracks.slice(0, limit));
	const total = $derived(
		remoteGenre ? (knownTotal ?? item.count ?? serverTracks.length) : filteredTracks.length
	);
	const seenCursors = new SvelteSet<string>();
	async function readPage(more = false) {
		if (reading || item.genre === undefined) return;
		const job = new AbortController();
		pageRead = job;
		reading = true;
		pageError = '';
		try {
			const p = await genreTracksPage(session, item.genre, more ? cursor : null, job.signal);
			job.signal.throwIfAborted();
			if (p.next && seenCursors.has(p.next))
				throw Error('The library changed while loading. Try again.');
			if (p.next) seenCursors.add(p.next);
			const ids = new Set(serverTracks.map((t) => t.id));
			serverTracks = more ? [...serverTracks, ...p.tracks.filter((t) => !ids.has(t.id))] : p.tracks;
			knownTotal = p.total;
			cursor = p.next;
			pages.push({ end: serverTracks.length, after: cursor });
		} catch (cause) {
			if (!job.signal.aborted) pageError = errorMessage(cause);
		} finally {
			if (!job.signal.aborted) reading = false;
		}
	}
	async function all(shuffle: boolean) {
		if (busy) return;
		const job = new AbortController();
		queueRead = job;
		busy = true;
		error = '';
		const cancel = () => job.abort();
		window.addEventListener('dn-playback-intent', cancel);
		try {
			if (remoteGenre && item.genre) {
				const batch = await prepareLibraryPlayback(
					session,
					{ genre: item.genre, sort: shuffle ? 'random' : 'album', order: 'asc' },
					job.signal
				);
				job.signal.throwIfAborted();
				window.removeEventListener('dn-playback-intent', cancel);
				await onplay(batch.tracks, 0, batch.continuation);
				return;
			}
			const selection = remoteGenre
				? await tracksInGenre(session, item.genre!, job.signal, true)
				: filteredTracks;
			job.signal.throwIfAborted();
			window.removeEventListener('dn-playback-intent', cancel);
			const check = queueSizeCheck(session.serverUrl);
			selection.forEach(check);
			await onplay(shuffle ? shuffled(selection) : selection, 0);
		} catch (cause) {
			if (!job.signal.aborted) error = errorMessage(cause);
		} finally {
			window.removeEventListener('dn-playback-intent', cancel);
			if (queueRead === job) {
				queueRead = undefined;
				busy = false;
			}
		}
	}
	onDestroy(() => {
		pageRead?.abort();
		queueRead?.abort();
	});
	// Offline playlists can contain the same recording twice. Each occurrence has its own action.
	const rows = $derived(trackOccurrences(shown));
	const eligible = $derived(new Set(rows.map((r) => r.id)));
	onMount(() => {
		const visibility = () => (shownDocument = !document.hidden);
		document.addEventListener('visibilitychange', visibility);
		return () => document.removeEventListener('visibilitychange', visibility);
	});
	$effect(() => {
		const foreground = active && shownDocument;
		untrack(() => {
			if (!foreground) {
				inBackground = true;
				pageRead?.abort();
				queueRead?.abort();
				reading = false;
				return;
			}
			if (remoteGenre && !serverTracks.length && !pages.length && !pageError && !reading)
				void readPage();
			if (inBackground && returnItem) {
				const id = returnItem;
				returnItem = '';
				requestAnimationFrame(() => {
					if (active && shownDocument) void results?.focusItem(id);
				});
			}
			inBackground = false;
		});
	});
	async function play(row: BrowseItem) {
		if (busy) return;
		busy = true;
		error = '';
		returnItem = row.id;
		try {
			const source = remoteGenre ? shown : filteredTracks,
				index = rows.findIndex((i) => i.id === row.id);
			const batch = tappedPlayback(
				session.serverUrl,
				source,
				index,
				pages,
				total,
				remoteGenre && item.genre ? { genre: item.genre, sort: 'album', order: 'asc' } : undefined
			);
			await onplay(batch.tracks, batch.index, batch.continuation);
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			busy = false;
		}
	}
</script>

<SelectionHost
	choices={() => rows.map((i) => browseChoice(session, i))}
	contains={(id) => eligible.has(id)}
	{session}
	{onplay}
	{active}
	localOnly={offline}
	heading={item.title}
	scope={JSON.stringify([item.id, filter])}
>
	{#if item.smart}<small>Smart playlist · on this device</small>{/if}
	{#if showAvailability}<DetailAvailability
			source={device}
			available={countOnDevice}
			total={knownPlayable}
			{deviceOnly}
			value={filter}
			onchange={(v) => {
				availability = v;
				limit = 48;
			}}
		/>
	{:else}<p>{total.toLocaleString()} {total === 1 ? 'track' : 'tracks'}</p>{/if}
	{#if shown.length}
		<div class="group-actions">
			<button class="primary" disabled={busy} onclick={() => all(false)}
				><Play size={17} />Play all</button
			><button class="secondary" disabled={busy} onclick={() => all(true)}
				><Shuffle size={17} />Shuffle all</button
			>
		</div>
		<BrowseEntries
			bind:this={results}
			{active}
			{total}
			{session}
			items={rows}
			category="Tracks"
			layout="list"
			columns={1}
			{inventory}
			cacheOnly={deviceOnly}
			showOnlineOnly={showAvailability}
			localOnly={offline}
			open={play}
		/>
		{#if remoteGenre && cursor}<button
				class="secondary"
				disabled={reading}
				use:loadNearEnd={{ active, enabled: !reading && !pageError, load: () => readPage(true) }}
				onclick={() => readPage(true)}>More songs</button
			>{:else if !remoteGenre && limit < filteredTracks.length}<button
				class="secondary"
				use:loadNearEnd={{ active, enabled: true, load: () => (limit += 48) }}
				onclick={() => (limit += 48)}>More songs</button
			>{/if}
	{:else if !reading && !pageError}<p>No matching tracks.</p>{/if}
	{#if smartError}<p role="alert">{smartError}</p>
		<button class="secondary" onclick={() => smartRevision++}>Retry smart playlist</button>{/if}
	{#if pageError}<p role="alert">{pageError}</p>
		<button class="secondary" onclick={() => readPage(!!serverTracks.length)}>Retry</button>{/if}
	{#if reading}<p role="status">Loading genre tracks…</p>{/if}
	{#if queueRead && busy}<button class="text-button" onclick={() => queueRead?.abort()}
			>Cancel preparation</button
		>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
</SelectionHost>

<style>
	.group-actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 0.8rem;
	}
	.group-actions button {
		min-height: 44px;
	}
</style>
