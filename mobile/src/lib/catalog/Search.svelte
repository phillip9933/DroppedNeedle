<script lang="ts">
	import type { Session } from '../connection';
	import { search, errorMessage, type Album, type OnPlay, type SearchScope } from './catalog';
	import type { Playlist } from './playlists';
	import SearchCollection from './SearchCollection.svelte';
	import RequestSong from './RequestSong.svelte';
	import Albums from './Albums.svelte';
	import TrackList from './TrackList.svelte';
	let {
		session,
		onopen,
		onplay,
		onartist,
		ongenre,
		onplaylist,
		term = $bindable('')
	}: {
		session: Session;
		onopen: (a: Album) => void;
		onplay: OnPlay;
		onartist: (a: { name: string; localId?: string | null; mbid?: string | null }) => void;
		ongenre: (name: string) => void;
		onplaylist: (p: Playlist) => void;
		term?: string;
	} = $props();
	const scopes = [
		{ id: 'top', label: 'Top results' },
		{ id: 'artists', label: 'Artists' },
		{ id: 'albums', label: 'Albums' },
		{ id: 'tracks', label: 'Songs' },
		{ id: 'genres', label: 'Genres' },
		{ id: 'playlists', label: 'Playlists' }
	] as const;
	let scope = $state<SearchScope>('top'),
		offset = $state(0);
	let result = $state<Awaited<ReturnType<typeof search>> | null>(null);
	let error = $state(''),
		busy = $state(false),
		retry = $state(0);
	$effect(() => {
		const q = term.trim(),
			account = session,
			kind = scope,
			start = offset;
		void retry;
		result = null;
		error = '';
		busy = q.length >= 2 && kind !== 'genres' && kind !== 'playlists';
		if (kind === 'genres' || kind === 'playlists' || q.length < 2) return;
		const controller = new AbortController();
		let active = true;
		const timer = setTimeout(async () => {
			try {
				const found = await search(account, q, kind, start, controller.signal);
				if (active) result = found;
			} catch (e) {
				if (active) error = errorMessage(e);
			} finally {
				if (active) busy = false;
			}
		}, 300);
		return () => {
			active = false;
			clearTimeout(timer);
			controller.abort();
		};
	});
</script>

<h1>Search</h1>
<input
	type="search"
	bind:value={term}
	oninput={() => (offset = 0)}
	aria-label="Search music"
	placeholder={scope === 'top'
		? 'Search music'
		: 'Search ' + scopes.find((s) => s.id === scope)?.label.toLowerCase()}
	autocomplete="off"
/>
<div class="scopes" role="group" aria-label="Search category">
	{#each scopes as item (item.id)}<button
			aria-pressed={scope === item.id}
			onclick={() => {
				scope = item.id;
				offset = 0;
			}}>{item.label}</button
		>{/each}
</div>
{#if scope === 'genres' || scope === 'playlists'}
	<SearchCollection {session} {scope} {term} {ongenre} {onplaylist} />
{:else if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={() => retry++}>Try again</button>
{:else if busy}<p role="status">Searching…</p>
{:else if result}
	{#if result.tracks.length}<h2>Songs in your library</h2>
		<TrackList {session} tracks={result.tracks} {onplay} />{/if}
	{#if result.artists.length}<h2>Artists</h2>
		<div class="artists">
			{#each result.artists as artist (artist.mbid || artist.localId)}<button
					class="secondary"
					onclick={() => onartist(artist)}>{artist.name}</button
				>{/each}
		</div>{/if}
	{#if result.albums.length}<h2>Albums</h2>
		<Albums {session} albums={result.albums} {onopen} />{/if}
	{#if result.recordings.length}<h2>Songs to request</h2>
		{#each result.recordings as row (row.song.recording_mbid + '-' + row.song.release_mbid)}<div
				class="recording"
			>
				<span
					><strong>{row.song.track_title}</strong><small
						>{row.song.artist_name} · {row.song.album_title}</small
					></span
				><RequestSong {session} song={row.song} requested={row.requested} />
			</div>{/each}{/if}
	{#if result.partial}<p role="status">Some MusicBrainz results are unavailable.</p>
		<button class="secondary" onclick={() => retry++}>Retry search</button>{/if}
	{#if !result.albums.length && !result.tracks.length && !result.artists.length && !result.recordings.length}<p
		>
			{offset ? 'No more matches.' : 'No matches for “' + term.trim() + '”.'}
		</p>{/if}
	{#if scope !== 'top' && (offset > 0 || result.next !== null)}
		<div class="pages">
			<button
				class="secondary"
				disabled={!offset}
				onclick={() => {
					if (result) offset = result.previous;
				}}>Previous results</button
			><button
				class="secondary"
				disabled={result.next === null}
				onclick={() => {
					if (result?.next != null) offset = result.next;
				}}>Next results</button
			>
		</div>
	{/if}
{:else if term.length}<p>Enter at least two characters.</p>{/if}

<style>
	.scopes,
	.pages {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.5rem 0 1rem;
	}
	.scopes button {
		min-height: 44px;
		padding: 0.3rem 0.72rem;
		font-weight: 600;
		font-size: 0.92rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}
	.scopes button[aria-pressed='true'] {
		color: var(--on-accent);
		background: var(--accent);
		border-color: var(--accent);
	}

	.artists {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.recording {
		display: flex;
		gap: 0.65rem;
		align-items: center;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--line);
	}
	.recording span {
		flex: 1;
		min-width: 0;
	}
	.recording strong,
	.recording small {
		display: block;
	}
	.recording small {
		color: var(--muted);
	}
</style>
