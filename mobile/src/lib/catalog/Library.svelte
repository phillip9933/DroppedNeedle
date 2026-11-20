<script lang="ts">
	import { untrack, onMount } from 'svelte';
	import { Heart, Play, Shuffle } from '@lucide/svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, type Session } from '../connection';
	import { path, localAlbum, localSong, errorMessage, type Album, type OnPlay } from './catalog';
	import Albums from './Albums.svelte';
	import { prepareLibraryQueue } from './libraryQueue';
	import TrackList from './TrackList.svelte';
	type Schema = components['schemas'];
	type Artist = Pick<Schema['ArtistView'], 'id' | 'name'>;
	let {
		session,
		kind,
		artist,
		active = true,
		artistAppearances = false,
		preview = false,
		recent = false,
		onopen,
		onartist,
		onplay
	}: {
		session: Session;
		kind: 'albums' | 'artists' | 'songs';
		artist?: Artist;
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
					.filter((a) => !favorites || a.favorite);
			if (entity === 'track')
				songs = songs
					.map((t) => (t.id === id ? { ...t, favorite: value } : t))
					.filter((t) => !favorites || t.favorite);
			if (entity === 'artist')
				artists = artists
					.map((a) => (a.id === id ? { ...a, favorite: value } : a))
					.filter((a) => !favorites || a.favorite);
		};
		window.addEventListener('dnfavoritechange', changed);
		window.addEventListener('dn-playback-intent', cancelPreparation);
		return () => {
			window.removeEventListener('dnfavoritechange', changed);
			window.removeEventListener('dn-playback-intent', cancelPreparation);
			cancelPreparation();
		};
	});
	const sorts = {
		albums: [
			['name', 'Album title'],
			['date_added', 'Recently added'],
			['artist', 'Artist'],
			['year', 'Release year']
		],
		artists: [
			['name', 'Artist name'],
			['album_count', 'Album count'],
			['date_added', 'Recently added']
		],
		songs: [
			['title', 'Song title'],
			['artist', 'Artist'],
			['album', 'Album'],
			['date_added', 'Recently added']
		]
	};
	const listFilters = $derived.by(() => {
		const by = recent ? 'date_added' : sort || sorts[kind][0][0];
		return {
			sort: by,
			order: ['album_count', 'date_added', 'year'].includes(by) ? 'desc' : 'asc',
			q: query.trim() || undefined,
			favorites: favorites ? 'true' : undefined,
			artist_id: kind === 'songs' ? artist?.id : undefined,
			...advanced
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
			const tracks = await prepareLibraryQueue(session, filters, controller.signal, (n, total) => {
				progress = 'Preparing ' + n.toLocaleString() + ' of ' + total.toLocaleString() + ' tracks…';
			});
			if (controller.signal.aborted || !active) return;
			preparation = null;
			progress = '';
			await onplay(tracks, 0);
		} catch (e) {
			if (!controller.signal.aborted) queueError = errorMessage(e);
		} finally {
			if (preparation === controller) cancelPreparation();
		}
	}
	async function load(cursor: string | null, version: number) {
		busy = true;
		error = '';
		const limit = preview ? (kind === 'albums' ? 6 : 3) : 30;
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
				next = result.next ?? null;
			} else if (kind === 'artists') {
				const result = await getJson<Schema['ArtistPage']>(
					session,
					path('/api/v3/library/artists', {}, params)
				);
				if (version !== generation) return;
				artists = [...artists, ...result.items.filter((a) => !artists.some((v) => v.id === a.id))];
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
		void recent;
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

{#if (!artist || kind === 'songs') && !preview}
	<div class="filters">
		<input
			type="search"
			aria-label={'Filter ' + kind}
			placeholder={'Filter ' + kind}
			bind:value={query}
		/>
		{#if !recent}<select aria-label={'Sort ' + kind} bind:value={sort}
				>{#each sorts[kind] as [value, label], i (value)}<option value={i === 0 ? '' : value}
						>{label}</option
					>{/each}</select
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
						>Your rating<select bind:value={rating}>
							<option value={0}>Any rating</option>{#each [1, 2, 3, 4, 5] as stars (stars)}<option
									value={stars}>{stars} {stars === 1 ? 'star' : 'stars'}</option
								>{/each}
						</select></label
					>
					{#if rating}<label
							>Rating range<select bind:value={ratingMode}
								><option value="at_least">At least</option><option value="at_most">At most</option
								></select
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
								>Selected formats<select bind:value={formatMode}
									><option value="with">Include</option><option value="without">Exclude</option
									></select
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
{#if albums.length}<Albums {session} {albums} {onopen} strip={preview} />{/if}
{#if artists.length}<div class="artists">
		{#each artists as a (a.id)}<button onclick={() => onartist(a)}
				><strong>{a.name}</strong><small
					>{a.album_count} {a.album_count === 1 ? 'album' : 'albums'}</small
				></button
			>{/each}
	</div>{/if}
{#if songs.length}<TrackList {session} tracks={songs} {onplay} />{/if}
{#if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={() => load(next, generation)}>Try again</button>
{:else if busy}<p role="status">Loading {noun}…</p>
{:else if next && !preview}<button class="secondary more" onclick={() => load(next, generation)}
		>More {noun}</button
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
	.filters select {
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
