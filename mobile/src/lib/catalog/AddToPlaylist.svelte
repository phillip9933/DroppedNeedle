<script lang="ts">
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import type { PlayerTrack } from '../player';
	import { errorMessage } from './catalog';
	import { playlists, createPlaylist, addLocalTracks, type Playlist } from './playlists';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import PlaylistNameForm from './PlaylistNameForm.svelte';
	let {
		session,
		tracks,
		onclose
	}: {
		session: Session;
		tracks: PlayerTrack[];
		onclose: () => void;
	} = $props();
	let items = $state<Playlist[]>([]),
		selected = $state(''),
		creating = $state(false);
	let loading = $state(true),
		busy = $state(false),
		error = $state(''),
		failed = $state(false),
		receipt = $state('');
	async function load() {
		loading = true;
		error = '';
		failed = false;
		try {
			items = (await playlists(session)).filter((item) => item.can_edit);
			selected = items[0]?.id ?? '';
		} catch (cause) {
			error = errorMessage(cause);
			failed = true;
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void load();
	});
	async function create(name: string) {
		const item = await createPlaylist(session, name);
		items = [item, ...items];
		selected = item.id;
		creating = false;
		error = '';
	}
	async function add() {
		const target = items.find((item) => item.id === selected);
		if (busy || !target || !tracks.length) return;
		busy = true;
		error = '';
		try {
			const added = await addLocalTracks(session, target.id, tracks);
			const n = added.tracks.length;
			receipt = 'Added ' + n + (n === 1 ? ' track to ' : ' tracks to ') + target.name + '.';
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			busy = false;
		}
	}
</script>

<PlaylistDialog title={creating ? 'New playlist' : 'Add to playlist'} {onclose} {busy}>
	{#if creating}
		<PlaylistNameForm
			action="Create playlist"
			onsubmit={create}
			oncancel={() => (creating = false)}
			bind:busy
		/>
	{:else if receipt}
		<p role="status">{receipt}</p>
		<button class="primary" onclick={onclose}>Done</button>
	{:else}
		{#if loading}<p role="status">Loading playlists…</p>
		{:else if failed}<p role="alert">{error}</p>
			<button class="secondary" onclick={load}>Try again</button>
		{:else}
			{#if items.length}
				<label
					>Playlist<InlineChoice {selected}
						><select bind:value={selected} disabled={busy}>
							{#each items as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
						</select></InlineChoice
					></label
				>
			{:else}<p>Create a playlist to save these tracks.</p>{/if}
			<button class="text-button" disabled={busy} onclick={() => (creating = true)}
				>New playlist</button
			>
			{#if error}<p role="alert">{error}</p>{/if}
		{/if}
		<div class="actions">
			{#if selected && !failed && !loading}<button
					class="primary"
					disabled={busy || !tracks.length}
					onclick={add}>Add {tracks.length === 1 ? 'track' : tracks.length + ' tracks'}</button
				>{/if}
			<button class="secondary" disabled={busy} onclick={onclose}>Cancel</button>
		</div>
	{/if}
</PlaylistDialog>
