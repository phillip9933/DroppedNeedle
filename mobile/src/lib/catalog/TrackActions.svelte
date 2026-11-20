<script lang="ts">
	import { Ellipsis } from '@lucide/svelte';
	import { player, type PlayerTrack } from '../player';
	import type { Session } from '../connection';
	import { errorMessage } from './catalog';
	import AddToPlaylist from './AddToPlaylist.svelte';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import Favorite from './Favorite.svelte';
	let {
		session,
		tracks,
		label,
		favorite
	}: { session: Session; tracks: PlayerTrack[]; label: string; favorite?: boolean } = $props();
	let menu = $state<'actions' | 'playlist' | null>(null),
		busy = $state(false),
		error = $state(''),
		message = $state(''),
		saved = $state<boolean>();
	async function enqueue(placement: 'next' | 'end') {
		busy = true;
		error = '';
		try {
			await player.enqueue(tracks, session, placement);
			menu = null;
			message = placement === 'next' ? 'Added to play next.' : 'Added to queue.';
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<button
	class="icon-button"
	aria-label={label}
	title={label}
	onclick={() => {
		menu = 'actions';
		message = error = '';
	}}><Ellipsis size={18} /></button
>
<span class="sr-only" role="status">{message}</span>
{#if menu === 'actions'}
	<PlaylistDialog
		title={tracks.length === 1 ? tracks[0].title : label}
		onclose={() => (menu = null)}
		{busy}
	>
		<div class="choices">
			<button disabled={busy} onclick={() => enqueue('next')}>Play next</button>
			<button disabled={busy} onclick={() => enqueue('end')}>Add to queue</button>
			<button disabled={busy} onclick={() => (menu = 'playlist')}>Add to playlist</button>
			{#if favorite !== undefined && tracks.length === 1}<Favorite
					{session}
					kind="track"
					id={tracks[0].id}
					value={saved ?? favorite}
					onchange={(v) => (saved = v)}
				/>{/if}
			<button disabled={busy} onclick={() => (menu = null)}>Close</button>
		</div>
		{#if error}<p role="alert">{error}</p>{/if}
	</PlaylistDialog>
{:else if menu === 'playlist'}<AddToPlaylist
		{tracks}
		{session}
		onclose={() => (menu = null)}
	/>{/if}

<style>
	.choices {
		display: grid;
		gap: 0.3rem;
	}
	.choices button {
		min-height: 44px;
		text-align: left;
	}
</style>
