<script lang="ts">
	import InlineChoice from '../controls/InlineChoice.svelte';
	import {
		libraryFilter,
		filterSummary,
		sorts,
		type FilterSection,
		type LibraryFilter
	} from '../boards/filteredSections';
	import { recordShelfMatches } from '../boards/shelfLibrary';
	import type { Preview } from '../boards/display';
	import { untrack, onMount } from 'svelte';
	import { Heart, Play, Shuffle } from '@lucide/svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, type Session } from '../connection';
	import { loadNearEnd } from './browseViewport';
	import { trackChoice, useLibrarySelection } from './librarySelection.svelte';
	import {
		albumTracks,
		path,
		localAlbum,
		localSong,
		errorMessage,
		type Album,
		type OnPlay
	} from './catalog';
	import PreviewItem from '../boards/PreviewItem.svelte';
	import TrackActions from './TrackActions.svelte';
	import Albums from './Albums.svelte';
	import { prepareLibraryQueue } from './libraryQueue';
	import { prepareLibraryPlayback } from '../player/libraryWindow';
	import TrackList from './TrackList.svelte';
	import { trackDuration } from './TrackRow.svelte';
	const selectable = useLibrarySelection();
	type Schema = components['schemas'];
	type Artist = Pick<Schema['ArtistView'], 'id' | 'name'>;
	let {
		display,
		session,
		kind,
		artist,
		fixedFilter,
		onsavefilters,
		active = true,
		artistAppearances = false,
		preview = false,
		recent = false,
		onopen,
		onartist,
		onplay
	}: {
		session: Session;
		display?: Preview;
		kind: 'albums' | 'artists' | 'songs';
		artist?: Artist;
		fixedFilter?: FilterSection;
		onsavefilters?: (config: LibraryFilter) => void;
		artistAppearances?: boolean;
		active?: boolean;
		preview?: boolean;
		recent?: boolean;
		onopen: (a: Album) => void;
		onartist: (a: Artist) => void;
		onplay: OnPlay;
	} = $props();
	let sort = $state(''),
		query = $state(''),
		favorites = $state(false);
	let rating = $state(0),
		ratingMode = $state<Schema['RatingMode']>('at_least'),
		formats = $state<string[]>([]),
		formatMode = $state<Schema['FormatMode']>('with');
	let formatRequest = $state(0),
		availableFormats = $state<string[] | null>(null),
		formatError = $state('');
	const advanced = $derived({
		rating: rating || undefined,
		rating_mode: rating ? ratingMode : undefined,
		formats: formats.length ? formats.join(',') : undefined,
		format_mode: formats.length ? formatMode : undefined
	});
	$effect(() => {
		if (!formatRequest) return;
		const account = session,
			albums = kind === 'albums';
		let valid = true;
		formatError = '';
		availableFormats = null;
		const options = albums
			? getJson<Schema['AlbumFormatCounts']>(account, path('/api/v3/library/albums/formats')).then(
					(r) => r.items.map((i) => i.format)
				)
			: getJson<Schema['StatsView']>(account, path('/api/v3/library/stats')).then((r) =>
					Object.keys(r.format_breakdown)
				);
		void options.then(
			(items) => {
				if (valid) availableFormats = items.sort();
			},
			(e) => {
				if (valid) formatError = errorMessage(e);
			}
		);
		return () => {
			valid = false;
		};
	});
	function clearAdvanced() {
		formats = [];
		formatMode = 'with';
		rating = 0;
		ratingMode = 'at_least';
	}
	let albums = $state<Album[]>([]),
		artists = $state<Schema['ArtistView'][]>([]),
		songs = $state<ReturnType<typeof localSong>[]>([]);
	let busy = $state(true),
		error = $state(''),
		next = $state<string | null>(null);
	let generation = 0;
	function albumChoice(album: Album) {
		return {
			id: 'album:' + (album.localId || album.group),
			title: album.title,
			tracks: (signal: AbortSignal) => albumTracks(session, album, signal)
		};
	}
	function artistChoice(a: Artist) {
		return {
			id: 'artist:' + a.id,
			title: a.name,
			tracks: (signal: AbortSignal, forQueue: boolean) =>
				prepareLibraryQueue(
					session,
					{ artist_id: a.id, sort: 'album', order: 'asc' },
					signal,
					undefined,
					forQueue
				)
		};
	}
	onMount(() => {
		const changed = (event: Event) => {
			const {
				kind: entity,
				id,
				value
			} = (event as CustomEvent<{ kind: string; id: string; value: boolean }>).detail;
			if (entity === 'album')
				albums = albums
					.map((a) => (a.localId === id ? { ...a, favorite: value } : a))
					.filter((a) => !(fixedFilter?.favorites ?? favorites) || a.favorite);
			if (entity === 'track')
				songs = songs
					.map((t) => (t.id === id ? { ...t, favorite: value } : t))
					.filter((t) => !(fixedFilter?.favorites ?? favorites) || t.favorite);
			if (entity === 'artist')
				artists = artists
					.map((a) => (a.id === id ? { ...a, favorite: value } : a))
					.filter((a) => !(fixedFilter?.favorites ?? favorites) || a.favorite);
		};
		window.addEventListener('dnfavoritechange', changed);
		window.addEventListener('dn-playback-intent', cancelPreparation);
		return () => {
			window.removeEventListener('dnfavoritechange', changed);
			window.removeEventListener('dn-playback-intent', cancelPreparation);
			cancelPreparation();
		};
	});
	const listFilters = $derived.by(() => {
		const config = fixedFilter;
		const by = recent ? 'date_added' : config?.sort || sort || sorts[kind][0][0];
		return {
			sort: by,
			order: ['album_count', 'date_added', 'year'].includes(by) ? 'desc' : 'asc',
			q: (config?.query ?? query.trim()) || undefined,
			favorites: (config?.favorites ?? favorites) ? 'true' : undefined,
			artist_id: kind === 'songs' ? artist?.id : undefined,
			...(config
				? {
						rating: config.rating || undefined,
						rating_mode: config.rating ? config.ratingMode : undefined,
						formats: config.formats.join(',') || undefined,
						format_mode: config.formats.length ? config.formatMode : undefined
					}
				: advanced)
		};
	});
	const noun = $derived(artistAppearances ? 'appearances' : kind);
	let preparation: AbortController | null = null;
	let progress = $state(''),
		queueError = $state('');
	function cancelPreparation() {
		preparation?.abort();
		preparation = null;
		progress = '';
	}
	$effect(() => {
		void active;
		void session;
		void listFilters;
		queueError = '';
		return cancelPreparation;
	});
	async function playAll(shuffle: boolean) {
		cancelPreparation();
		queueError = '';
		if (!active) return;
		const controller = new AbortController();
		preparation = controller;
		progress = 'Preparing queue…';
		try {
			const filters = shuffle ? { ...listFilters, sort: 'random', order: 'asc' } : listFilters;
			const batch = await prepareLibraryPlayback(
				session,
				filters,
				controller.signal,
				(n, total) => {
					progress =
						'Preparing ' + n.toLocaleString() + ' of ' + total.toLocaleString() + ' tracks…';
				}
			);
			if (controller.signal.aborted || !active) return;
			preparation = null;
			progress = '';
			await onplay(batch.tracks, 0, batch.continuation);
		} catch (e) {
			if (!controller.signal.aborted) queueError = errorMessage(e);
		} finally {
			if (preparation === controller) cancelPreparation();
		}
	}
	const fetchLimit = $derived(preview ? (display?.capacity ?? 6) : 30);
	async function load(cursor: string | null, version: number) {
		busy = true;
		error = '';
		const limit = fetchLimit;
		const params = { ...listFilters, limit, after: cursor ?? undefined };

		try {
			if (kind === 'albums') {
				const url = artist
					? path(
							artistAppearances
								? '/api/v3/library/artists/{id}/appearances'
								: '/api/v3/library/artists/{id}/albums',
							{ id: artist.id },
							{ limit, after: cursor ?? undefined }
						)
					: path('/api/v3/library/albums', {}, params);
				const result = await getJson<Schema['AlbumPage']>(session, url);
				if (version !== generation) return;
				albums = [
					...albums,
					...result.items.filter((a) => !albums.some((v) => v.localId === a.id)).map(localAlbum)
				];
				if (fixedFilter)
					recordShelfMatches(
						session,
						fixedFilter,
						albums.flatMap((a) => (a.localId ? [a.localId] : [])),
						!result.next
					);
				next = result.next ?? null;
			} else if (kind === 'artists') {
				const result = await getJson<Schema['ArtistPage']>(
					session,
					path('/api/v3/library/artists', {}, params)
				);
				if (version !== generation) return;
				artists = [...artists, ...result.items.filter((a) => !artists.some((v) => v.id === a.id))];
				if (fixedFilter)
					recordShelfMatches(
						session,
						fixedFilter,
						artists.map((a) => a.id),
						!result.next
					);
				next = result.next ?? null;
			} else {
				const result = await getJson<Schema['TrackListPage']>(
					session,
					path('/api/v3/library/tracks', {}, params)
				);
				if (version !== generation) return;
				songs = [
					...songs,
					...result.items.filter((a) => !songs.some((v) => v.id === a.id)).map((t) => localSong(t))
				];
				next = result.next ?? null;
			}
		} catch (e) {
			if (version === generation) error = errorMessage(e);
		} finally {
			if (version === generation) busy = false;
		}
	}
	$effect(() => {
		const term = query.trim();
		void session;
		void artist;
		void sort;
		void favorites;
		void kind;
		void preview;
		void fetchLimit;
		void recent;
		void fixedFilter;
		void artistAppearances;
		void advanced;
		const version = ++generation;
		albums = [];
		artists = [];
		songs = [];
		next = null;
		busy = true;
		error = '';
		const timer = setTimeout(() => void untrack(() => load(null, version)), term ? 220 : 0);
		return () => {
			clearTimeout(timer);
			generation++;
		};
	});
</script>

{#if fixedFilter && !preview}<p>{filterSummary(fixedFilter)}</p>{/if}
{#if (!artist || kind === 'songs') && !preview && !fixedFilter}
	<div class="filters">
		<input
			type="search"
			aria-label={'Filter ' + kind}
			placeholder={'Filter ' + kind}
			bind:value={query}
		/>
		{#if !recent}<InlineChoice selected={sort} label={'Sort ' + kind}
				><select bind:value={sort}
					>{#each sorts[kind] as [value, label], i (value)}<option value={i === 0 ? '' : value}
							>{label}</option
						>{/each}</select
				></InlineChoice
			>{/if}
		<button
			class="icon-button"
			aria-label="Favorites only"
			title="Favorites only"
			aria-pressed={favorites}
			onclick={() => (favorites = !favorites)}
			><Heart size={18} fill={favorites ? 'currentColor' : 'none'} /></button
		>
	</div>
	{#if kind !== 'artists'}
		<details
			class="advanced"
			ontoggle={(event) => {
				if (event.currentTarget.open && !formatRequest) formatRequest = 1;
			}}
		>
			<summary
				>Rating and format{#if rating || formats.length}<span>
						· Filters applied</span
					>{/if}</summary
			>
			<div class="advanced-body">
				<div class="rating">
					<label
						>Your rating<InlineChoice selected={rating}
							><select bind:value={rating}>
								<option value={0}>Any rating</option>{#each [1, 2, 3, 4, 5] as stars (stars)}<option
										value={stars}>{stars} {stars === 1 ? 'star' : 'stars'}</option
									>{/each}
							</select></InlineChoice
						></label
					>
					{#if rating}<label
							>Rating range<InlineChoice selected={ratingMode}
								><select bind:value={ratingMode}
									><option value="at_least">At least</option><option value="at_most">At most</option
									></select
								></InlineChoice
							></label
						>{/if}
				</div>
				<fieldset>
					<legend>{kind === 'albums' ? 'Primary audio format' : 'Audio format'}</legend>
					{#if formatError}<p role="alert">{formatError}</p>
						<button class="text-button" onclick={() => formatRequest++}>Retry formats</button>
					{:else if !availableFormats}<p role="status">Loading formats…</p>
					{:else if !availableFormats.length}<p>No audio formats found.</p>
					{:else}
						<div class="formats">
							{#each availableFormats as format (format)}<label
									><input
										type="checkbox"
										value={format}
										bind:group={formats}
									/>{format.toUpperCase()}</label
								>{/each}
						</div>
						{#if formats.length}<label
								>Selected formats<InlineChoice selected={formatMode}
									><select bind:value={formatMode}
										><option value="with">Include</option><option value="without">Exclude</option
										></select
									></InlineChoice
								></label
							>{/if}
					{/if}
				</fieldset>
				{#if rating || formats.length}<button class="text-button" onclick={clearAdvanced}
						>Clear rating and format</button
					>{/if}
			</div>
		</details>
	{/if}
	{#if onsavefilters}<button
			class="text-button"
			onclick={() =>
				onsavefilters?.(
					libraryFilter({
						kind,
						query,
						favorites,
						sort: recent ? 'date_added' : sort,
						rating,
						ratingMode,
						formats,
						formatMode
					})
				)}>Save filters as section</button
		>{/if}
{/if}
{#if kind === 'songs' && !preview}
	<div class="collection-actions">
		{#if progress}<p role="status">{progress}</p>
			<button class="secondary" onclick={cancelPreparation}>Cancel preparation</button>
		{:else}
			<button class="secondary" disabled={!songs.length || busy} onclick={() => playAll(false)}
				><Play size={16} aria-hidden="true" />Play all</button
			>
			<button class="secondary" disabled={!songs.length || busy} onclick={() => playAll(true)}
				><Shuffle size={16} aria-hidden="true" />Shuffle all</button
			>
		{/if}
	</div>
	{#if queueError}<p role="alert">{queueError}</p>{/if}
{/if}
{#if display}
	<div
		class="preview-items"
		data-part={kind === 'albums' ? 'album-grid' : kind === 'artists' ? 'artist-list' : 'track-list'}
	>
		{#each albums.slice(0, display.limit) as album (album.localId || album.group)}
			<PreviewItem
				{session}
				part="album-card"
				choice={albumChoice(album)}
				title={album.title}
				subtitle={album.artist}
				artwork={album.art}
				coverSeed={album.group || album.localId || album.title}
				onclick={() => onopen(album)}
			/>
		{/each}
		{#each artists.slice(0, display.limit) as a (a.id)}
			<PreviewItem
				{session}
				choice={artistChoice(a)}
				title={a.name}
				subtitle={a.album_count + (a.album_count === 1 ? ' album' : ' albums')}
				artwork={path('/api/v3/library/artists/{id}/artwork', { id: a.id }, { size: 250 })}
				coverSeed={a.id}
				onclick={() => onartist(a)}
			/>
		{/each}
		{#each songs.slice(0, display.limit) as song, index (song.id)}
			<PreviewItem
				{session}
				choice={trackChoice(song)}
				title={song.title}
				label={'Play ' + song.title}
				subtitle={song.artist}
				detail={[song.album, song.duration ? trackDuration(song.duration) : '']
					.filter(Boolean)
					.join(' · ')}
				artwork={song.artworkUrl}
				coverSeed={song.album || song.title}
				onclick={() => onplay(songs.slice(0, display?.limit), index)}
			>
				{#snippet actions()}<TrackActions
						{session}
						tracks={[song]}
						label={'More options for ' + song.title}
						favorite={song.favorite}
					/>{/snippet}
			</PreviewItem>
		{/each}
	</div>
{:else}
	{#if albums.length}<Albums {session} {albums} {onopen} strip={preview} />{/if}
	{#if artists.length}<div class="artists">
			{#each artists as a (a.id)}<button
					use:selectable={artistChoice(a)}
					onclick={() => onartist(a)}
					><strong>{a.name}</strong><small
						>{a.album_count} {a.album_count === 1 ? 'album' : 'albums'}</small
					></button
				>{/each}
		</div>{/if}
	{#if songs.length}<TrackList {session} tracks={songs} {onplay} />{/if}
{/if}
{#if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={() => load(next, generation)}>Try again</button>
{:else if busy}<p role="status">Loading {noun}…</p>
{:else if next && !preview}<button
		class="secondary more"
		data-selection-more={artist ? true : undefined}
		use:loadNearEnd={{ active, enabled: !!artist && !busy, load: () => load(next, generation) }}
		onclick={() => load(next, generation)}>More {noun}</button
	>
{:else if !albums.length && !songs.length && !artists.length}<p>
		No {noun}
		{rating || formats.length || query
			? 'match your filters'
			: favorites
				? 'in your favorites'
				: 'in this collection'}.
	</p>{/if}

<style>
	.collection-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: var(--gap);
	}
	.collection-actions p {
		margin: 0;
	}
	.filters {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: var(--gap);
	}
	.filters input {
		flex: 2 1 9rem;
		min-width: 6rem;
	}
	.filters :global(.inline-choice) {
		flex: 1 1 8rem;
		min-width: 0;
	}
	.advanced {
		margin: 0 0 var(--gap);
	}
	.advanced summary {
		width: fit-content;
		min-height: 44px;
		align-content: center;
		font-weight: 600;
		cursor: pointer;
	}
	.advanced summary span {
		font-weight: 400;
	}
	.advanced-body {
		display: grid;
		gap: 0.7rem;
		padding: var(--gap);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.rating,
	.formats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}
	.rating label,
	.advanced fieldset > label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.9rem;
	}
	.rating label {
		flex: 1;
		min-width: 7rem;
	}
	.advanced select {
		width: 100%;
		min-height: 44px;
	}
	.advanced fieldset {
		min-width: 0;
		padding: 0;
		border: 0;
		margin: 0;
	}
	.advanced legend {
		padding: 0;
		font-size: 0.9rem;
	}
	.formats label {
		min-height: 44px;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.5rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.formats input {
		accent-color: var(--text);
	}
	.advanced fieldset > label {
		width: fit-content;
		margin-top: 0.4rem;
	}
	.artists button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		gap: var(--gap);
		padding: 0.8rem 0;
		border-bottom: 1px solid var(--line);
		text-align: left;
	}
	.artists small {
		color: var(--muted);
	}
	.more {
		margin-top: var(--gap);
	}
</style>
