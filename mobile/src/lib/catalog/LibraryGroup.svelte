<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Play, Shuffle } from '@lucide/svelte';
	import type { Session } from '../connection';
	import type { PlayerTrack } from '../player';
	import { errorMessage, type OnPlay } from './catalog';
	import { offlineInventory, watchOfflineMedia } from '../offline/media';
	import type { OfflineInventory } from '../offline/library';
	import { browseChoice, type BrowseItem, trackItem } from './libraryBrowse';
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
		onplay,
		active
	}: {
		session: Session;
		item: BrowseItem;
		tracks: PlayerTrack[];
		offline: boolean;
		onplay: OnPlay;
		active: boolean;
	} = $props();
	let limit = $state(48),
		error = $state(''),
		busy = $state(false),
		inventory = $state.raw<OfflineInventory>();
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
	const shown = $derived(remoteGenre ? serverTracks : tracks.slice(0, limit));
	const total = $derived(
		remoteGenre ? (knownTotal ?? item.count ?? serverTracks.length) : tracks.length
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
				: tracks;
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
	const rows = $derived(shown.map((t, i) => ({ ...trackItem(t), id: 'entry:' + i })));
	onMount(() => {
		const visibility = () => (shownDocument = !document.hidden);
		document.addEventListener('visibilitychange', visibility);
		let alive = true;
		async function read() {
			try {
				const result = await offlineInventory(session);
				if (alive) inventory = result;
			} catch {
				/* Library playback is independent of offline storage availability. */
			}
		}
		void read();
		const stop = watchOfflineMedia(read);
		return () => {
			alive = false;
			document.removeEventListener('visibilitychange', visibility);
			stop();
		};
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
			const source = remoteGenre ? shown : tracks,
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
	contains={(id) => rows.some((i) => i.id === id)}
	{session}
	{onplay}
	{active}
	localOnly={offline}
	heading={item.title}
	scope={item.id}
>
	{#if item.smart}<small>Smart playlist · on this device</small>{/if}
	<p>{total.toLocaleString()} {total === 1 ? 'track' : 'tracks'}</p>
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
			localOnly={offline}
			open={play}
		/>
		{#if remoteGenre && cursor}<button
				class="secondary"
				disabled={reading}
				use:loadNearEnd={{ active, enabled: !reading && !pageError, load: () => readPage(true) }}
				onclick={() => readPage(true)}>More songs</button
			>{:else if !remoteGenre && limit < tracks.length}<button
				class="secondary"
				use:loadNearEnd={{ active, enabled: true, load: () => (limit += 48) }}
				onclick={() => (limit += 48)}>More songs</button
			>{/if}
	{:else if !reading && !pageError}<p>No matching tracks.</p>{/if}
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
