<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowLeft, Play } from '@lucide/svelte';
	import type { Session } from '../connection';
	import { errorMessage, type OnPlay } from './catalog';
	import { readPlaylist, type Playlist } from './playlists';
	import TrackRow from './TrackRow.svelte';
	let {
		session,
		playlist,
		onplay,
		onback
	}: { session: Session; playlist: Playlist; onplay: OnPlay; onback: () => void } = $props();
	let detail = $state<Awaited<ReturnType<typeof readPlaylist>>>();
	let count = $state(50);
	let busy = $state(true),
		error = $state('');
	async function load() {
		busy = true;
		error = '';
		try {
			detail = await readPlaylist(session, playlist);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void load();
	});
</script>

<button class="text-button" onclick={onback}><ArrowLeft size={16} /> Back to playlists</button>
<h1>{playlist.name}</h1>
{#if busy}<p role="status">Loading tracks…</p>
{:else if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={load}>Try again</button>
{:else if detail}
	{#if detail.resolutionFailed}
		<p role="alert">Could not check for newly added files.</p>
		<button class="secondary" onclick={load}>Try again</button>
	{/if}
	{#if detail.tracks.length}
		<button class="primary" onclick={() => detail && onplay(detail.tracks, 0)}
			><Play size={18} />Play playlist</button
		>
	{:else}<p>
			{detail.rows.length
				? 'This playlist has no tracks available in your library.'
				: 'This playlist is empty.'}
		</p>{/if}
	<div data-part="track-list">
		{#each detail.rows.slice(0, count) as { entry, index }, position (entry.id)}
			<TrackRow
				title={entry.track_name}
				artist={entry.artist_name}
				duration={entry.duration}
				position={position + 1}
				onplay={index === null ? undefined : () => detail && onplay(detail.tracks, index)}
			/>
		{/each}
	</div>
	{#if count < detail.rows.length}<button class="secondary more" onclick={() => (count += 50)}
			>More tracks</button
		>{/if}
{/if}

<style>
	h1 {
		overflow-wrap: anywhere;
	}
	.more {
		margin-top: var(--gap);
	}
</style>
