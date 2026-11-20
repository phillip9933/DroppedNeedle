<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';
	import type { Session } from '../connection';
	import { errorMessage } from './catalog';
	import { playlists, createPlaylist, playlistCover, type Playlist } from './playlists';
	import Cover from './Cover.svelte';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import PlaylistNameForm from './PlaylistNameForm.svelte';
	let creating = $state(false),
		saving = $state(false);
	let { session, onopen }: { session: Session; onopen: (playlist: Playlist) => void } = $props();
	let items = $state<Playlist[]>([]);
	let count = $state(40);
	let busy = $state(true),
		error = $state('');
	async function load() {
		busy = true;
		error = '';
		try {
			items = await playlists(session);
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

<button class="text-button" onclick={() => (creating = true)}>New playlist</button>
{#if creating}
	<PlaylistDialog title="New playlist" onclose={() => (creating = false)} busy={saving}>
		<PlaylistNameForm
			action="Create playlist"
			bind:busy={saving}
			oncancel={() => (creating = false)}
			onsubmit={async (name) => {
				const item = await createPlaylist(session, name);
				creating = false;
				onopen(item);
			}}
		/>
	</PlaylistDialog>
{/if}
{#if busy}<p role="status">Loading playlists…</p>
{:else if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={load}>Try again</button>
{:else if !items.length}<p>No playlists yet.</p>
{:else}
	<div data-part="playlist-list">
		{#each items.slice(0, count) as item (item.id)}
			<button class="row" onclick={() => onopen(item)}>
				<span class="art"><Cover {session} path={playlistCover(item)} seed={item.id} /></span>
				<span class="info"
					><strong>{item.name}</strong><small
						>{item.track_count} {item.track_count === 1 ? 'track' : 'tracks'}</small
					></span
				>
				<ChevronRight size={18} aria-hidden="true" />
			</button>
		{/each}
	</div>
	{#if count < items.length}<button class="secondary more" onclick={() => (count += 40)}
			>More playlists</button
		>{/if}
{/if}

<style>
	.row {
		display: flex;
		align-items: center;
		text-align: start;
		gap: var(--gap);
		width: 100%;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--line);
	}
	.info {
		min-width: 0;
		flex: 1;
	}
	.info strong,
	.info small {
		display: block;
		overflow-wrap: anywhere;
	}
	.info small {
		color: var(--muted);
	}
	.art {
		width: 3.25rem;
		flex-shrink: 0;
	}
	.more {
		margin-top: var(--gap);
	}
</style>
