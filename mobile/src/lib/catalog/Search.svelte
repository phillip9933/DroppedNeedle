<script lang="ts">
	import type { Session } from '../connection';
	import { search, errorMessage, type Album, type OnPlay } from './catalog';
	import RequestSong from './RequestSong.svelte';
	import Albums from './Albums.svelte';
	import TrackList from './TrackList.svelte';
	let {
		session,
		onopen,
		onplay,
		onartist,
		term = $bindable('')
	}: {
		session: Session;
		onopen: (a: Album) => void;
		onplay: OnPlay;
		onartist: (a: { name: string; localId?: string | null; mbid?: string | null }) => void;
		term?: string;
	} = $props();
	let result = $state<Awaited<ReturnType<typeof search>> | null>(null);
	let error = $state(''),
		busy = $state(false),
		retry = $state(0);
	$effect(() => {
		const q = term.trim(),
			account = session;
		void retry;
		result = null;
		error = '';
		busy = q.length >= 2;
		if (q.length < 2) return;
		let active = true;
		const timer = setTimeout(async () => {
			try {
				const found = await search(account, q);
				if (active) result = found;
			} catch (e) {
				if (active) error = errorMessage(e);
			} finally {
				if (active) busy = false;
			}
		}, 350);
		return () => {
			active = false;
			clearTimeout(timer);
		};
	});
</script>

<h1>Search</h1>
<input
	type="search"
	bind:value={term}
	aria-label="Search artists, albums and songs"
	placeholder="Search artists, albums and songs"
	autocomplete="off"
/>
{#if error}<p role="alert">{error}</p>
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
	{#if result.partial}<p role="status">Some MusicBrainz results are unavailable.</p>{/if}
	{#if !result.albums.length && !result.tracks.length && !result.artists.length && !result.recordings.length}<p
		>
			No matches for “{term.trim()}”.
		</p>{/if}
{:else if term.length}<p>Enter at least two characters.</p>{/if}

<style>
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
