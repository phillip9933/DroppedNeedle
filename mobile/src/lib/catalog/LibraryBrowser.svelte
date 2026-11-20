<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		ArrowDown,
		ArrowDownUp,
		ArrowUp,
		ChevronLeft,
		Disc3,
		Filter,
		Grid2X2,
		List,
		ListChecks,
		ListEnd,
		ListMusic,
		ListStart,
		Music2,
		Play,
		Plus,
		Search,
		Settings,
		Shuffle,
		Tags,
		UsersRound,
		X
	} from '@lucide/svelte';
	import type { Session } from '../connection';
	import { player, type PlayerTrack } from '../player';
	import type { Album, OnPlay } from './catalog';
	import { errorMessage } from './catalog';
	import { createPlaylist, type Playlist } from './playlists';
	import {
		offlineInventory,
		offlineSupported,
		saveOfflineTracks,
		watchOfflineMedia
	} from '../offline/media';
	import { availableTracks, type Availability, type OfflineInventory } from '../offline/library';
	import { accountId, loadLayout, saveLayout } from '../boards/layout';
	import {
		libraryFilter,
		type LibraryFilter,
		type FilterSection
	} from '../boards/filteredSections';
	import FilterSectionDialog from '../boards/FilterSectionDialog.svelte';
	import {
		browsePage,
		orderChoices,
		resolveItem,
		type BrowseFilters,
		type BrowseItem,
		type Category
	} from './libraryBrowse';
	import {
		readBrowsePreferences,
		saveBrowsePreferences,
		type BrowsePreferences
	} from './browsePreferences';
	import { collectionTracks, playbackFilter, shuffled } from './browseActions';
	import { prepareLibraryPlayback } from '../player/libraryWindow';
	import { queueSizeCheck } from './libraryQueue';
	import type { SmartPlaylist } from './smartPlaylists';
	import SelectionHost from './SelectionHost.svelte';
	import BrowseEntries from './BrowseEntries.svelte';
	import { loadNearEnd } from './browseViewport';
	import { tappedPlayback, type PageEnd } from './browsePlayback';
	import { browseChoice, requestFilters, type BrowseSnapshot } from './libraryBrowse';
	import LibraryFilters from './LibraryFilters.svelte';
	import LibrarySmartPlaylists from './LibrarySmartPlaylists.svelte';
	import PlaylistImport from './PlaylistImport.svelte';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import PlaylistNameForm from './PlaylistNameForm.svelte';
	import AddToPlaylist from './AddToPlaylist.svelte';

	let {
		session,
		category,
		active,
		onopen,
		onlocal,
		onplaylist,
		onplay,
		ondetail,
		onback
	}: {
		session: Session;
		category: Category;
		active: boolean;
		onopen: (album: Album) => void;
		onlocal: (artist: { id: string; name: string }) => void;
		onplaylist: (p: Playlist) => void;
		onplay: OnPlay;
		ondetail: (row: BrowseItem, tracks: PlayerTrack[], offline: boolean) => void;
		onback: () => void;
	} = $props();
	const icons = {
		Playlists: ListMusic,
		Artists: UsersRound,
		Albums: Disc3,
		Tracks: Music2,
		Genres: Tags
	};
	const Icon = $derived(icons[category]);
	const kind = $derived(
		category === 'Tracks' ? 'songs' : category === 'Albums' ? 'albums' : 'artists'
	);
	const unit = $derived(category === 'Tracks' ? 'songs' : category.toLowerCase());
	let settings = $state(untrack(() => readBrowsePreferences(session, category)));
	let filters = $state<BrowseFilters>(
		untrack(() => ({
			q: '',
			favorites: false,
			rating: 0,
			ratingMode: 'at_least',
			formats: [],
			formatMode: 'with',
			sort: settings.sort,
			order: settings.order
		}))
	);
	let availability = $state<Availability>('all'),
		connected = $state(navigator.onLine),
		inventory = $state.raw<OfflineInventory>(),
		ready = $state(false);
	const disconnected = $derived(!connected || inventory?.offlineOnly === true);
	const availableScope = $derived([availability, disconnected].join('|'));
	const available = $derived(
		disconnected || availability !== 'all'
			? inventory
				? availableTracks(inventory, availability)
				: []
			: undefined
	);
	const localFormats = $derived([
		...new Set(available?.flatMap((t) => (t.format ? [t.format.toLowerCase()] : [])) ?? [])
	]);
	const sortLabel = $derived(
		orderChoices[category].find(([s]) => s === filters.sort)?.[1] ?? 'Name'
	);
	let panel = $state<'' | 'sort' | 'search' | 'filters' | 'display'>(''),
		searchBox = $state<HTMLInputElement>(),
		typed = $state('');
	let host: SelectionHost,
		items = $state.raw<BrowseItem[]>([]),
		total = $state<number>(),
		cursor = $state<string | null>(null),
		loading = $state(true),
		waitingMore = $state(false),
		error = $state(''),
		retry = $state(0),
		scan = $state('');
	let receipt = $state(''),
		actionError = $state(''),
		progress = $state(''),
		busy = $state(false);
	let pageRequest: AbortController | undefined, actionRequest: AbortController | undefined;
	let results: BrowseEntries;
	let returnItem = '',
		preserveLength = 0,
		wasActive = false,
		visible = $state(!document.hidden);
	let snapshot: BrowseSnapshot = {},
		pages: PageEnd[] = [],
		cursors = new SvelteSet<string>();
	const known = $derived(new Set(items.map((i) => i.id)));
	const changeKey = $derived({
		f: { ...filters, formats: [...filters.formats] },
		c: category,
		a: session,
		m: available,
		retry
	});
	let lastKey: typeof changeKey | undefined;
	let context = $state.raw<BrowseItem | null>(null),
		smart = $state.raw<SmartPlaylist | 'new' | null>(null),
		newName = $state(false),
		nameBusy = $state(false),
		addTo = $state.raw<PlayerTrack[] | null>(null),
		savedFilter = $state<LibraryFilter | null>(null);

	function preferences(p: Partial<BrowsePreferences>) {
		settings = { ...settings, ...p };
		saveBrowsePreferences(session, category, settings);
	}
	function change(p: Partial<BrowseFilters>) {
		filters = { ...filters, ...p };
	}
	function chooseSort(sort: string) {
		const order =
			sort === 'date_added' || sort === 'year' || sort === 'count' || sort === 'album_count'
				? 'desc'
				: 'asc';
		change({ sort, order });
		preferences({ sort, order });
	}
	function reverse() {
		const order = filters.order === 'asc' ? 'desc' : 'asc';
		change({ order });
		preferences({ order });
	}
	function layout() {
		preferences({ layout: settings.layout === 'grid' ? 'list' : 'grid' });
	}
	function toggle(next: typeof panel) {
		panel = panel === next ? '' : next;
	}
	$effect(() => {
		if (panel === 'search') searchBox?.focus();
	});
	$effect(() => {
		void category;
		void session;
		void availableScope;
		void filters;
		untrack(() => {
			cancelAction();
			receipt = '';
			actionError = '';
		});
	});
	$effect(() => {
		const q = typed;
		const timer = setTimeout(() => {
			if (untrack(() => filters.q) !== q) change({ q });
		}, 180);
		return () => clearTimeout(timer);
	});

	onMount(() => {
		let alive = true,
			version = 0;
		const network = () => (connected = navigator.onLine);
		const refresh = async () => {
			const current = ++version;
			try {
				const data =
					offlineSupported && session.userId ? await offlineInventory(session) : undefined;
				if (alive && current === version) inventory = data;
			} catch {
				if (alive && current === version) inventory = undefined;
			} finally {
				if (alive && current === version) ready = true;
			}
		};
		const favorite = () => retry++;
		const playlistsChanged = () => {
			if (category === 'Playlists') {
				preserveLength = items.length;
				retry++;
			}
		};
		const visibility = () => (visible = !document.hidden);
		window.addEventListener('dn-playlists-updated', playlistsChanged);
		document.addEventListener('visibilitychange', visibility);
		const release = watchOfflineMedia(refresh);
		window.addEventListener('online', network);
		window.addEventListener('offline', network);
		window.addEventListener('dnfavoritechange', favorite);
		void refresh();
		return () => {
			alive = false;
			release();
			window.removeEventListener('online', network);
			window.removeEventListener('offline', network);
			window.removeEventListener('dnfavoritechange', favorite);
			window.removeEventListener('dn-playlists-updated', playlistsChanged);
			document.removeEventListener('visibilitychange', visibility);
		};
	});
	function cancelAction() {
		actionRequest?.abort();
		actionRequest = undefined;
		busy = false;
		progress = '';
	}
	onDestroy(() => {
		pageRequest?.abort();
		cancelAction();
	});
	$effect(() => {
		const definition = changeKey,
			shown = active && visible;
		if (!ready) return;
		untrack(() => {
			if (!shown) {
				pageRequest?.abort();
				pageRequest = undefined;
				waitingMore = false;
				if (loading) lastKey = undefined;
				cancelAction();
				wasActive = false;
				return;
			}
			if (!wasActive && returnItem) {
				const id = returnItem;
				returnItem = '';
				requestAnimationFrame(() => {
					if (active && visible) void results?.focusItem(id);
				});
			}
			wasActive = true;
			if (lastKey === definition) {
				pageRequest ??= new AbortController();
				return;
			}
			lastKey = definition;
			pageRequest?.abort();
			const controller = new AbortController();
			pageRequest = controller;
			const prior = preserveLength;
			preserveLength = 0;
			pages = [];
			cursors.clear();
			snapshot = {};
			if (!prior) {
				items = [];
				total = undefined;
				cursor = null;
			}
			loading = true;
			waitingMore = false;
			error = '';
			scan = '';
			const { a, c, f, m } = definition;
			void browsePage(
				a,
				c,
				f,
				null,
				controller.signal,
				m,
				(n, t) => {
					if (!controller.signal.aborted)
						scan = 'Reading genre tags · ' + n.toLocaleString() + ' of ' + t.toLocaleString();
				},
				snapshot
			)
				.then(
					(page) => {
						if (controller.signal.aborted) return;
						if (prior > page.items.length && snapshot.items) {
							items = snapshot.items.slice(0, prior);
							total = snapshot.items.length;
							cursor = items.length < total ? String(items.length) : null;
						} else {
							items = page.items;
							total = page.total;
							cursor = page.next ?? null;
						}
						pages.push({ end: items.length, after: cursor });
						if (cursor) cursors.add(cursor);
					},
					(cause) => {
						if (!controller.signal.aborted) error = errorMessage(cause);
					}
				)
				.finally(() => {
					if (!controller.signal.aborted) {
						loading = false;
						scan = '';
					}
				});
		});
	});
	async function more() {
		const after = cursor,
			signal = pageRequest?.signal;
		if (!after || !active || !visible || !signal || signal.aborted || waitingMore) return;
		waitingMore = true;
		error = '';
		try {
			const result = await browsePage(
				session,
				category,
				filters,
				after,
				signal,
				available,
				undefined,
				snapshot
			);
			if (signal.aborted) return;
			if (result.next && (cursors.has(result.next) || !result.items.some((i) => !known.has(i.id))))
				throw Error('The collection changed while loading. Try again.');
			items = [...items, ...result.items.filter((i) => !known.has(i.id))];
			cursor = result.next ?? null;
			total = result.total ?? total;
			pages.push({ end: items.length, after: cursor });
			if (cursor) cursors.add(cursor);
		} catch (cause) {
			if (!signal.aborted) error = errorMessage(cause);
		} finally {
			if (!signal.aborted) waitingMore = false;
		}
	}
	type Action = 'open' | 'play' | 'shuffle' | 'next' | 'end' | 'playlist' | 'offline';
	function open(row: BrowseItem) {
		context = null;
		returnItem = row.id;
		if (row.track) {
			cancelAction();
			try {
				const tracks = (available && snapshot.items ? snapshot.items : items).map((i) => i.track!);
				const batch = tappedPlayback(
					session.serverUrl,
					tracks,
					items.indexOf(row),
					pages,
					total,
					available ? undefined : requestFilters(filters)
				);
				void Promise.resolve(onplay(batch.tracks, batch.index, batch.continuation)).catch(
					(e) => (actionError = errorMessage(e))
				);
			} catch (e) {
				actionError = errorMessage(e);
			}
		} else if (row.album) onopen(row.album);
		else if (row.artist) onlocal(row.artist);
		else if (row.playlist) onplaylist(row.playlist);
		else if (row.genre !== undefined && !row.localTracks) ondetail(row, [], false);
		else void run('open', row);
	}
	async function run(action: Action, row?: BrowseItem) {
		if (busy) return;
		const controller = new AbortController();
		actionRequest = controller;
		const signal = controller.signal,
			forQueue = !['open', 'playlist', 'offline'].includes(action);
		const stop = () => cancelAction();
		if (forQueue) window.addEventListener('dn-playback-intent', stop);
		const update = (n: number, t: number) => {
			if (!signal.aborted)
				progress = 'Preparing tracks · ' + n.toLocaleString() + ' of ' + t.toLocaleString();
		};
		context = null;
		busy = true;
		receipt = '';
		actionError = '';
		progress = 'Preparing tracks…';
		try {
			const query =
				!available && (action === 'play' || action === 'shuffle')
					? playbackFilter(category, filters, row)
					: undefined;
			if (query) {
				const params = action === 'shuffle' ? { ...query, sort: 'random', order: 'asc' } : query;
				const batch = await prepareLibraryPlayback(session, params, signal, update);
				signal.throwIfAborted();
				window.removeEventListener('dn-playback-intent', stop);
				await onplay(batch.tracks, 0, batch.continuation);
				return;
			}
			let tracks = row
				? await resolveItem(session, row, signal, forQueue)
				: await collectionTracks(
						session,
						category,
						filters,
						signal,
						available,
						action === 'shuffle',
						update
					);
			signal.throwIfAborted();
			window.removeEventListener('dn-playback-intent', stop);
			if (action === 'open') {
				if (row) ondetail(row, tracks, disconnected);
				return;
			}
			if (!tracks.length) throw Error('No playable tracks match this selection.');
			if (row && forQueue) {
				const check = queueSizeCheck(session.serverUrl);
				tracks.forEach(check);
				if (action === 'shuffle') tracks = shuffled(tracks);
			}
			if (action === 'play' || action === 'shuffle') await onplay(tracks, 0);
			else if (action === 'next' || action === 'end') {
				await player.enqueue(tracks, session, action);
				receipt = action === 'next' ? 'Added to play next.' : 'Added to queue.';
			} else if (action === 'playlist') addTo = tracks;
			else if (action === 'offline') {
				const result = await saveOfflineTracks(
					session,
					tracks,
					(n, t) => {
						if (!signal.aborted) progress = 'Saving offline · ' + n + ' of ' + t;
					},
					signal
				);
				if (!signal.aborted) receipt = result.message;
			}
		} catch (cause) {
			if (!signal.aborted) actionError = errorMessage(cause);
		} finally {
			window.removeEventListener('dn-playback-intent', stop);
			if (actionRequest === controller) {
				actionRequest = undefined;
				busy = false;
				progress = '';
			}
		}
	}
	async function createSection(value: FilterSection) {
		try {
			const owner = await accountId(session),
				current = loadLayout(session.serverUrl, owner, 'library');
			saveLayout(
				session.serverUrl,
				owner,
				'library',
				[...current, { id: value.id, preview: true, title: '', filter: value }],
				{ before: [], after: [value] }
			);
			savedFilter = null;
			receipt = 'Added to Library sections.';
		} catch (cause) {
			actionError = errorMessage(cause);
		}
	}
	export function getHeader() {
		return categoryHeader;
	}
</script>

{#snippet categoryHeader()}
	<div class="category-heading">
		<button aria-label="Back to Library" onclick={onback}><ChevronLeft size={23} /></button>
		<Icon size={25} />
		<h1>{category}</h1>
		<button
			aria-label="Category settings"
			aria-expanded={panel === 'display'}
			onclick={() => toggle('display')}><Settings size={23} /></button
		>
	</div>
{/snippet}

<SelectionHost
	{session}
	{active}
	{onplay}
	bind:this={host}
	choices={() => items.map((i) => browseChoice(session, i))}
	contains={(id) => known.has(id)}
	externalToggle
	localOnly={disconnected}
	scope={JSON.stringify([category, filters, availability])}
>
	{#if category === 'Playlists'}
		<div class="playlist-actions">
			{#if !disconnected}<PlaylistImport {session} compact onimport={() => retry++} />{/if}
			<button class="pill" onclick={() => (smart = 'new')}
				><Plus size={20} />Create smart playlist</button
			>
		</div>
	{:else}
		<div class="action-row" aria-label="Collection actions" role="group">
			<button
				aria-label="Play all"
				title="Play all"
				disabled={busy || !items.length}
				onclick={() => run('play')}><Play fill="currentColor" /></button
			>
			<button
				aria-label="Shuffle all"
				title="Shuffle all"
				disabled={busy || !items.length}
				onclick={() => run('shuffle')}><Shuffle /></button
			>
			<button
				aria-label="Play next"
				title="Play next"
				disabled={busy || !items.length}
				onclick={() => run('next')}><ListStart /></button
			>
			<button
				aria-label="Add to queue"
				title="Add to queue"
				disabled={busy || !items.length}
				onclick={() => run('end')}><ListEnd /></button
			>
			<button
				aria-label="Collection filters"
				title="Collection filters"
				aria-expanded={panel === 'filters'}
				onclick={() => toggle('filters')}><Filter /></button
			>
		</div>
	{/if}
	<div class="browse-tools" aria-label="Browse controls" role="group">
		<button
			class="sort-summary"
			aria-label="Reverse sort order"
			title="Reverse sort order"
			onclick={reverse}
			><span>{sortLabel}</span>{#if filters.order === 'asc'}<ArrowUp size={15} />{:else}<ArrowDown
					size={15}
				/>{/if}</button
		>
		{#if category === 'Playlists'}<button
				aria-label="Collection filters"
				title="Collection filters"
				aria-expanded={panel === 'filters'}
				onclick={() => toggle('filters')}><Filter /></button
			>{/if}
		<button
			aria-label="Choose sort order"
			title="Sort"
			aria-expanded={panel === 'sort'}
			onclick={() => toggle('sort')}><ArrowDownUp /></button
		>
		<button
			aria-label={'Switch to ' + (settings.layout === 'grid' ? 'list' : 'grid') + ' view'}
			title="Switch layout"
			onclick={layout}
			>{#if settings.layout === 'grid'}<List />{:else}<Grid2X2 />{/if}</button
		>
		<button
			aria-label="Select items"
			title="Select items"
			disabled={!items.length}
			onclick={() => host?.beginSelection()}><ListChecks /></button
		>
		<button
			aria-label={'Search ' + category.toLowerCase()}
			title={'Search ' + category.toLowerCase()}
			aria-expanded={panel === 'search'}
			onclick={() => toggle('search')}><Search /></button
		>
	</div>
	{#if panel === 'search'}
		<div class="search">
			<input
				type="search"
				aria-label={'Filter ' + unit}
				placeholder={'Search ' + category.toLowerCase()}
				bind:value={typed}
				bind:this={searchBox}
			/><button
				aria-label="Clear search"
				onclick={() => {
					typed = '';
					change({ q: '' });
					searchBox?.focus();
				}}><X size={18} /></button
			>
		</div>
	{:else if panel === 'sort'}
		<div class="control-panel">
			<label
				>Sort {unit}<select value={filters.sort} onchange={(e) => chooseSort(e.currentTarget.value)}
					>{#each orderChoices[category] as [value, label] (value)}<option {value}>{label}</option
						>{/each}</select
				></label
			>
		</div>
	{:else if panel === 'filters'}
		<LibraryFilters
			{session}
			{category}
			{filters}
			{change}
			{availability}
			chooseAvailability={(a) => (availability = a)}
			local={!!available}
			{localFormats}
			onsave={category !== 'Genres' && category !== 'Playlists'
				? () => (savedFilter = libraryFilter({ ...filters, query: filters.q, kind }))
				: undefined}
		/>
	{:else if panel === 'display'}
		<div class="control-panel">
			<label
				>Display<select
					value={settings.layout}
					onchange={(e) => preferences({ layout: e.currentTarget.value as 'list' | 'grid' })}
					><option value="grid">Grid</option><option value="list">List</option></select
				></label
			>
			{#if settings.layout === 'grid'}<label
					>Grid columns<select
						value={settings.columns}
						onchange={(e) => preferences({ columns: Number(e.currentTarget.value) })}
						>{#each [2, 3, 4, 5] as n (n)}<option value={n}>{n}</option>{/each}</select
					></label
				>
			{:else}<label class="check"
					><input
						type="checkbox"
						checked={settings.compact}
						onchange={(e) => preferences({ compact: e.currentTarget.checked })}
					/>Compact rows</label
				>{/if}
			{#if category === 'Genres' && !available}<p class="index-note">
					The directory lists each track’s primary genre. Opening a genre includes other tracks DN
					has tagged with it.
				</p>{/if}
			{#if category === 'Playlists'}
				{#if !disconnected}<button class="secondary" onclick={() => (newName = true)}
						><Plus size={17} />New playlist</button
					>{/if}
			{/if}
		</div>
	{/if}
	{#if !loading && !error}
		<p class="count" aria-live="polite">
			{total === undefined
				? items.length.toLocaleString() +
					(cursor ? ' loaded' : items.length === 1 ? ' item' : ' items')
				: total.toLocaleString() + (total === 1 ? ' item' : ' items')}{#if available}<span>
					· {availability === 'downloaded'
						? 'Downloaded'
						: availability === 'automatic'
							? 'Automatically saved'
							: availability === 'cached'
								? 'Playback cache'
								: 'Available offline'}</span
				>{/if}
		</p>
	{/if}
	{#if busy}<p role="status" class="notice">
			{progress} <button class="text-button" onclick={cancelAction}>Cancel preparation</button>
		</p>{/if}
	{#if actionError}<p role="alert">{actionError}</p>{/if}{#if receipt}<p role="status">
			{receipt}
		</p>{/if}
	{#if loading}<p class="notice" role="status">
			{scan || 'Loading ' + category.toLowerCase() + '…'}
		</p>{/if}
	{#if error}<p role="alert">{error}</p>
		<button class="secondary" onclick={() => (items.length && cursor ? more() : retry++)}
			>Retry</button
		>{/if}
	<BrowseEntries
		bind:this={results}
		{active}
		{total}
		{session}
		{items}
		{category}
		layout={settings.layout}
		columns={settings.columns}
		compact={settings.compact}
		{inventory}
		localOnly={disconnected}
		{open}
		menu={(row) => (context = row)}
	/>
	{#if !loading && !error && !items.length}<p class="notice">
			No matching {category.toLowerCase()}.
		</p>{/if}
	{#if cursor}<button
			class="secondary more-page"
			use:loadNearEnd={{ active, enabled: !error && !waitingMore && !loading, load: more }}
			disabled={waitingMore}
			onclick={more}>{waitingMore ? 'Loading…' : 'More ' + unit}</button
		>{/if}
</SelectionHost>

{#if context}
	{@const row = context}
	<PlaylistDialog title={row.title} onclose={() => (context = null)}>
		<div class="context-actions">
			<button onclick={() => open(row)}
				>Open {category === 'Playlists'
					? 'playlist'
					: category === 'Genres'
						? 'genre'
						: category === 'Albums'
							? 'album'
							: 'artist'}</button
			>
			<button onclick={() => run('play', row)}>Play</button><button
				onclick={() => run('shuffle', row)}>Shuffle</button
			>
			<button onclick={() => run('next', row)}>Play next</button><button
				onclick={() => run('end', row)}>Add to queue</button
			>
			{#if !disconnected}<button onclick={() => run('playlist', row)}>Add to playlist</button>{/if}
			{#if offlineSupported && !disconnected}<button onclick={() => run('offline', row)}
					>Save offline</button
				>{/if}
			{#if row.smart}<button
					onclick={() => {
						smart = row.smart!;
						context = null;
					}}>Edit smart playlist</button
				>{/if}
		</div>
	</PlaylistDialog>
{/if}
{#if smart}<LibrarySmartPlaylists
		{session}
		initial={smart === 'new' ? undefined : smart}
		onclose={() => (smart = null)}
		oncreated={() => {
			smart = null;
			retry++;
		}}
	/>{/if}
{#if newName}<PlaylistDialog title="New playlist" onclose={() => (newName = false)} busy={nameBusy}
		><PlaylistNameForm
			bind:busy={nameBusy}
			action="Create playlist"
			oncancel={() => (newName = false)}
			onsubmit={async (name) => {
				const added = await createPlaylist(session, name);
				newName = false;
				panel = '';
				window.dispatchEvent(new Event('dn-playlists-updated'));
				onplaylist(added);
			}}
		/></PlaylistDialog
	>{/if}
{#if addTo}<AddToPlaylist {session} tracks={addTo} onclose={() => (addTo = null)} />{/if}
{#if savedFilter}<FilterSectionDialog
		initial={savedFilter}
		onclose={() => (savedFilter = null)}
		onsave={createSection}
	/>{/if}

<style>
	.category-heading,
	.browse-tools,
	.playlist-actions,
	.search {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.category-heading {
		gap: 0.38rem;
		flex: 1;
	}
	.category-heading h1 {
		flex: 1;
		margin: 0;
		font-size: clamp(1.65rem, 7vw, 2.1rem);
		line-height: 1.12;
	}
	.category-heading button,
	.browse-tools button,
	.search button {
		min-width: 44px;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.category-heading button:last-child {
		border: 1px solid var(--line);
		border-radius: 999px;
	}
	.action-row {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0.3rem 0 1.05rem;
	}
	.action-row button,
	.pill,
	.playlist-actions :global(.import-pill) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		color: var(--on-accent);
		border-radius: 999px;
	}
	.action-row button {
		justify-self: center;
		width: clamp(44px, 12.8vw, 57px);
		height: auto;
		aspect-ratio: 1;
	}
	.action-row button :global(svg) {
		width: clamp(21px, 6vw, 26px);
		height: auto;
	}
	.action-row button[aria-expanded='true'] {
		outline: 2px solid var(--text);
		outline-offset: 2px;
	}
	.playlist-actions {
		gap: 0.5rem;
		margin: 0 0 1.05rem;
		flex-wrap: wrap;
	}
	.pill,
	.playlist-actions :global(.import-pill) {
		gap: 0.35rem;
		min-height: 44px;
		padding: 0.25rem 0.8rem;
		font-weight: 650;
	}
	.browse-tools {
		border-top: 1px solid var(--line);
		padding-top: 0.23rem;
		color: var(--muted);
	}
	.browse-tools button {
		padding: 0.15rem;
	}
	.browse-tools .sort-summary {
		min-width: 0;
		flex: 1;
		justify-content: flex-start;
		gap: 0.27rem;
		text-align: start;
		font-size: 0.85rem;
	}
	.sort-summary span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.browse-tools button :global(svg) {
		width: 20px;
		height: 20px;
		flex: none;
	}
	.sort-summary :global(svg) {
		width: 14px !important;
	}
	.browse-tools button[aria-expanded='true'] {
		color: var(--accent);
	}
	.search,
	.control-panel {
		padding: 0.4rem 0.15rem 0.55rem;
		gap: 0.45rem;
	}
	.search input,
	.control-panel select {
		width: 100%;
		min-width: 0;
	}
	.control-panel {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		align-items: end;
	}
	.index-note {
		grid-column: 1/-1;
		margin: 0.2rem 0;
		font-size: 0.82rem;
	}
	.control-panel label {
		font-size: 0.85rem;
		display: grid;
		gap: 0.2rem;
	}
	.control-panel .check {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		min-height: 44px;
	}
	.count,
	.notice {
		font-size: 0.85rem;
		color: var(--muted);
	}
	.count {
		margin: 0.1rem 0 0.55rem;
	}
	.more-page {
		margin-top: 0.8rem;
		width: 100%;
	}
	.context-actions {
		display: grid;
	}
	.context-actions button {
		min-height: 44px;
		padding: 0.4rem 0.3rem;
		text-align: start;
		border-bottom: 1px solid var(--line);
	}
</style>
