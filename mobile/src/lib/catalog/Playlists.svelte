<script lang="ts">
	import { uiText } from '../i18n';
	import type { Preview } from '../boards/display';
	import type { Session } from '../connection';
	import { errorMessage } from './catalog';
	import {
		playlists,
		createPlaylist,
		readPlaylist,
		playlistCover,
		type Playlist
	} from './playlists';
	import PreviewItem from '../boards/PreviewItem.svelte';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import PlaylistImport from './PlaylistImport.svelte';
	import PlaylistNameForm from './PlaylistNameForm.svelte';
	let creating = $state(false),
		saving = $state(false);
	let {
		display,
		session,
		preview = false,
		active = true,
		onopen
	}: {
		session: Session;
		display: Preview;
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

{#if !preview}<button class="text-button" onclick={() => (creating = true)}
		>{uiText('New playlist')}</button
	><PlaylistImport {session} onimport={() => retry++} />{/if}
{#if creating}
	<PlaylistDialog title={uiText('New playlist')} onclose={() => (creating = false)} busy={saving}>
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
{#if busy}<p role="status">{uiText('Loading playlists…')}</p>
{:else if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={() => retry++}>{uiText('Try again')}</button>
{:else if !items.length}<p>{uiText('No playlists yet.')}</p>
{:else}
	<div data-part="playlist-list" class="preview-items">
		{#each items.slice(0, preview ? display.limit : count) as item (item.id)}
			<PreviewItem
				{session}
				choice={{
					id: 'playlist:' + item.id,
					title: item.name,
					tracks: async (signal) => (await readPlaylist(session, item, signal)).tracks
				}}
				title={item.name}
				subtitle={item.track_count + (item.track_count === 1 ? ' track' : ' tracks')}
				artwork={playlistCover(item)}
				coverSeed={item.id}
				onclick={() => onopen(item)}
			/>
		{/each}
	</div>
	{#if !preview && count < items.length}<button class="secondary more" onclick={() => (count += 40)}
			>{uiText('More playlists')}</button
		>{/if}
{/if}

<style>
	.more {
		margin-top: var(--gap);
	}
</style>
