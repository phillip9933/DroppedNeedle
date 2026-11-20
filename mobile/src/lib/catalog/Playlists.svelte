<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import type { Session } from '../connection';
	import { errorMessage } from './catalog';
	import { playlists, createPlaylist, playlistCover, type Playlist } from './playlists';
	import Cover from './Cover.svelte';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import PlaylistImport from './PlaylistImport.svelte';
	import PlaylistNameForm from './PlaylistNameForm.svelte';
	let creating = $state(false),
		saving = $state(false);
	let {
		session,
		preview = false,
		active = true,
		onopen
	}: {
		session: Session;
		preview?: boolean;
		active?: boolean;
		onopen: (playlist: Playlist) => void;
	} = $props();
	let items = $state<Playlist[]>([]);
	let count = $state(40);
	let busy = $state(true),
		error = $state('');
	let retry = $state(0);
	$effect(() => {
		const account = session;
		void retry;
		if (!active) return;
		let valid = true;
		async function load() {
			busy = true;
			error = '';
			try {
				const fresh = await playlists(account);
				if (valid) items = fresh;
			} catch (e) {
				if (valid) error = errorMessage(e);
			} finally {
				if (valid) busy = false;
			}
		}
		void load();
		return () => {
			valid = false;
		};
	});
</script>

{#if !preview}<button class="text-button" onclick={() => (creating = true)}>New playlist</button
	><PlaylistImport {session} onimport={() => retry++} />{/if}
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
	<button class="secondary" onclick={() => retry++}>Try again</button>
{:else if !items.length}<p>No playlists yet.</p>
{:else}
	<div data-part="playlist-list">
		{#each items.slice(0, preview ? 3 : count) as item (item.id)}
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
	{#if !preview && count < items.length}<button class="secondary more" onclick={() => (count += 40)}
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
