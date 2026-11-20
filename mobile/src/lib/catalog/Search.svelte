<script lang="ts">
	import type { Session } from '../connection';
	import { search, errorMessage, type Album, type OnPlay } from './catalog';
	import Albums from './Albums.svelte';
	import TrackList from './TrackList.svelte';
	let {
		session,
		onopen,
		onplay,
		term = $bindable('')
	}: { session: Session; onopen: (a: Album) => void; onplay: OnPlay; term?: string } = $props();
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
	aria-label="Search albums and songs"
	placeholder="Search albums and songs"
	autocomplete="off"
/>
{#if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={() => retry++}>Try again</button>
{:else if busy}<p role="status">Searching…</p>
{:else if result}
	{#if result.tracks.length}<h2>Songs in your library</h2>
		<TrackList tracks={result.tracks} {onplay} />{/if}
	{#if result.albums.length}<h2>Albums</h2>
		<Albums {session} albums={result.albums} {onopen} />{/if}
	{#if result.partial}<p role="status">Some MusicBrainz results are unavailable.</p>{/if}
	{#if !result.albums.length && !result.tracks.length}<p>No matches for “{term.trim()}”.</p>{/if}
{:else if term.length}<p>Enter at least two characters.</p>{/if}
