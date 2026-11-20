<script lang="ts">
	import { untrack, onMount } from 'svelte';
	import { Heart } from '@lucide/svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, type Session } from '../connection';
	import { path, localAlbum, localSong, errorMessage, type Album, type OnPlay } from './catalog';
	import Albums from './Albums.svelte';
	import TrackList from './TrackList.svelte';
	type Schema = components['schemas'];
	type Artist = Pick<Schema['ArtistView'], 'id' | 'name'>;
	let {
		session,
		kind,
		artist,
		onopen,
		onartist,
		onplay
	}: {
		session: Session;
		kind: 'albums' | 'artists' | 'songs';
		artist?: Artist;
		onopen: (a: Album) => void;
		onartist: (a: Artist) => void;
		onplay: OnPlay;
	} = $props();
	let sort = $state(''),
		query = $state(''),
		favorites = $state(false);
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
		return () => window.removeEventListener('dnfavoritechange', changed);
	});
	const sorts = {
		albums: [
			['date_added', 'Recently added'],
			['name', 'Album title'],
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
	async function load(cursor: string | null, version: number) {
		busy = true;
		error = '';
		const by = sort || sorts[kind][0][0];
		const params = {
			limit: 30,
			after: cursor ?? undefined,
			sort: by,
			order: ['album_count', 'date_added', 'year'].includes(by) ? 'desc' : 'asc',
			q: query.trim() || undefined,
			favorites: favorites ? 'true' : undefined
		};
		try {
			if (kind === 'albums') {
				const url = artist
					? path(
							'/api/v3/library/artists/{id}/albums',
							{ id: artist.id },
							{ limit: 30, after: cursor ?? undefined }
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

{#if !artist}
	<div class="filters">
		<input
			type="search"
			aria-label={'Filter ' + kind}
			placeholder={'Filter ' + kind}
			bind:value={query}
		/>
		<select aria-label={'Sort ' + kind} bind:value={sort}
			>{#each sorts[kind] as [value, label], i (value)}<option value={i === 0 ? '' : value}
					>{label}</option
				>{/each}</select
		>
		<button
			class="icon-button"
			aria-label="Favorites only"
			title="Favorites only"
			aria-pressed={favorites}
			onclick={() => (favorites = !favorites)}
			><Heart size={18} fill={favorites ? 'currentColor' : 'none'} /></button
		>
	</div>
{/if}
{#if albums.length}<Albums {session} {albums} {onopen} />{/if}
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
{:else if busy}<p role="status">Loading {kind}…</p>
{:else if next}<button class="secondary more" onclick={() => load(next, generation)}
		>More {kind}</button
	>
{:else if !albums.length && !songs.length && !artists.length}<p>
		No {kind}
		{favorites ? 'in your favorites' : query ? 'match your filter' : 'in this collection'}.
	</p>{/if}

<style>
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
