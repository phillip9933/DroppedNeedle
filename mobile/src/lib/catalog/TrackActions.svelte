<script lang="ts">
	import { onDestroy } from 'svelte';
	import { saveOfflineTracks, offlineSupported } from '../offline/media';
	import { Ellipsis, EllipsisVertical } from '@lucide/svelte';
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
		vertical = false,
		localOnly = false,
		favorite
	}: {
		session: Session;
		tracks: PlayerTrack[];
		label: string;
		vertical?: boolean;
		localOnly?: boolean;
		favorite?: boolean;
	} = $props();
	let menu = $state<'actions' | 'playlist' | null>(null),
		busy = $state(false),
		error = $state(''),
		message = $state(''),
		saved = $state<boolean>();
	let downloadRequest = $state<AbortController>();
	onDestroy(() => downloadRequest?.abort());
	async function download() {
		busy = true;
		error = '';
		const request = new AbortController();
		downloadRequest = request;
		message = 'Saving offline…';
		try {
			const result = await saveOfflineTracks(
				session,
				tracks,
				(done, total) => {
					if (!request.signal.aborted) message = 'Saving offline · ' + done + ' of ' + total;
				},
				request.signal
			);
			if (!request.signal.aborted) {
				if (result.failed) {
					error = result.message;
					message = '';
				} else message = result.message;
			}
		} catch (e) {
			if (!request.signal.aborted) {
				error = errorMessage(e);
				message = '';
			}
		} finally {
			downloadRequest = undefined;
			busy = false;
		}
	}
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
	class:icon-button={!vertical}
	class:bare-dots={vertical}
	aria-label={label}
	title={label}
	onclick={() => {
		menu = 'actions';
		message = error = '';
	}}
	>{#if vertical}<EllipsisVertical size={18} />{:else}<Ellipsis size={18} />{/if}</button
>
{#if !menu}<span class="sr-only" role="status">{message}</span>{/if}
{#if menu === 'actions'}
	<PlaylistDialog
		title={tracks.length === 1 ? tracks[0].title : label}
		onclose={() => (menu = null)}
		{busy}
	>
		<div class="choices">
			<button disabled={busy} onclick={() => enqueue('next')}>Play next</button>
			<button disabled={busy} onclick={() => enqueue('end')}>Add to queue</button>
			{#if !localOnly}<button disabled={busy} onclick={() => (menu = 'playlist')}
					>Add to playlist</button
				>{/if}
			{#if offlineSupported && !localOnly}<button disabled={busy} onclick={download}
					>Save offline</button
				>{/if}
			{#if !localOnly && favorite !== undefined && tracks.length === 1}<Favorite
					{session}
					kind="track"
					id={tracks[0].id}
					value={saved ?? favorite}
					onchange={(v) => (saved = v)}
				/>{/if}
			{#if downloadRequest}<button
					onclick={() => {
						downloadRequest?.abort();
						menu = null;
						message = '';
					}}>Cancel saving</button
				>
			{:else}<button disabled={busy} onclick={() => (menu = null)}>Close</button>{/if}
		</div>
		{#if error}<p role="alert">{error}</p>{:else if message}<p role="status">{message}</p>{/if}
	</PlaylistDialog>
{:else if menu === 'playlist'}<AddToPlaylist
		{tracks}
		{session}
		onclose={() => (menu = null)}
	/>{/if}

<style>
	.bare-dots {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--muted);
	}
	.choices {
		display: grid;
		gap: 0.3rem;
	}
	.choices button {
		min-height: 44px;
		text-align: left;
	}
</style>
