<script lang="ts">
	import WebDetail from './WebDetail.svelte';
	import { onMount } from 'svelte';
	import { ArrowLeft, Play, Trash2 } from '@lucide/svelte';
	import { DnError, type Session } from '../connection';
	import { errorMessage, type OnPlay } from './catalog';
	import {
		readPlaylist,
		renamePlaylist,
		movePlaylistEntry,
		removePlaylistEntry,
		deletePlaylist,
		type Playlist
	} from './playlists';
	import SelectionHost from './SelectionHost.svelte';
	import { trackChoice } from './librarySelection.svelte';
	import TrackRow from './TrackRow.svelte';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import PlaylistExport from './PlaylistExport.svelte';
	import { Download } from '@lucide/svelte';
	import ReorderList from '../controls/ReorderList.svelte';
	import PlaylistNameForm from './PlaylistNameForm.svelte';
	import PlaylistSharing from './PlaylistSharing.svelte';
	let {
		session,
		playlist,
		onplay,
		onback,
		backLabel = 'Back to playlists'
	}: {
		session: Session;
		playlist: Playlist;
		onplay: OnPlay;
		onback: () => void;
		backLabel?: string;
	} = $props();
	let detail = $state<Awaited<ReturnType<typeof readPlaylist>>>();
	let count = $state(50),
		editing = $state(false);
	let busy = $state(true),
		saving = $state(false),
		error = $state(''),
		editError = $state('');
	let exportStatus = $state('');
	let dialog = $state<'export' | 'rename' | 'sharing' | 'remove' | 'delete' | null>(null);
	let remove = $state<{ id: string; title: string } | null>(null);
	const current = $derived(detail?.playlist ?? playlist);
	async function load() {
		busy = !detail;
		error = '';
		editError = '';
		try {
			detail = await readPlaylist(session, playlist);
			if (!detail.playlist.can_edit && !detail.playlist.can_delete) editing = false;
		} catch (e) {
			detail = undefined;
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
	async function change(action: () => Promise<unknown>, deleted = false) {
		if (saving) return false;
		saving = true;
		editError = '';
		try {
			await action();
			window.dispatchEvent(new Event('dn-playlists-updated'));
			dialog = null;
			remove = null;
			if (deleted) onback();
			else await load();
			return !error;
		} catch (cause) {
			if (cause instanceof DnError && cause.status === 403) await load();
			editError = errorMessage(cause);
			return false;
		} finally {
			saving = false;
		}
	}
	async function moveEntry(from: number, to: number) {
		const entry = detail?.rows[from]?.entry;
		if (!entry || !editing || !current.can_edit) return false;
		return change(() => movePlaylistEntry(session, current.id, entry.id, to));
	}
	function close() {
		dialog = null;
		remove = null;
		editError = '';
	}
	onMount(() => {
		void load();
	});
</script>

<button class="text-button" onclick={onback}><ArrowLeft size={16} /> {backLabel}</button>
<h1>{current.name}</h1>
{#if busy}<p role="status">Loading tracks…</p>
{:else if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={load}>Try again</button>
{:else if detail}
	{#if detail.resolutionFailed}
		<p role="alert">Could not check for newly added files.</p>
		<button class="secondary" onclick={load}>Try again</button>
	{/if}
	<div class="actions">
		{#if detail.tracks.length}
			<button class="primary" onclick={() => detail && onplay(detail.tracks, 0)}
				><Play size={18} />Play playlist</button
			>
		{/if}
		<button
			class="secondary"
			onclick={() => {
				exportStatus = '';
				dialog = 'export';
			}}><Download size={17} />Export playlist</button
		>
		{#if current.can_edit || current.can_delete}
			<button
				class="secondary"
				disabled={saving}
				aria-pressed={editing}
				onclick={() => {
					editing = !editing;
					editError = '';
				}}>{editing ? 'Done editing' : 'Edit playlist'}</button
			>
		{/if}
	</div>
	{#if exportStatus}<p role="status">{exportStatus}</p>{/if}
	{#if editing}
		<div class="actions">
			{#if current.is_owner}
				<button class="text-button" disabled={saving} onclick={() => (dialog = 'rename')}
					>Rename</button
				>
				<button class="text-button" disabled={saving} onclick={() => (dialog = 'sharing')}
					>Share playlist</button
				>
			{/if}
			{#if current.can_delete}<button
					class="text-button"
					disabled={saving}
					onclick={() => (dialog = 'delete')}>Delete playlist</button
				>{/if}
		</div>
	{/if}
	{#if editError && !dialog}<p role="alert">{editError}</p>{/if}
	{#if !detail.tracks.length}
		<p>
			{detail.rows.length
				? 'This playlist has no tracks available in your library.'
				: 'This playlist is empty.'}
		</p>
	{/if}
	<SelectionHost {session} {onplay} enabled={!editing} scope={String(editing)}>
		<ReorderList
			count={detail.rows.length}
			order={() => JSON.stringify(detail?.rows.map(({ entry }) => entry.id))}
			move={moveEntry}
		>
			{#snippet children(grip)}
				{#if detail}
					<div data-part="track-list">
						{#each detail.rows.slice(0, count) as { entry, index }, position (entry.id)}
							<div class="entry" data-entry={entry.id} data-reorder-row={position}>
								<TrackRow
									choice={index === null
										? undefined
										: trackChoice(detail.tracks[index], 'entry:' + entry.id)}
									title={entry.track_name}
									artist={entry.artist_name}
									duration={entry.duration}
									position={position + 1}
									onplay={index === null ? undefined : () => detail && onplay(detail.tracks, index)}
								/>
								{#if editing && current.can_edit}
									<div class="tools">
										{@render grip(position, entry.track_name, saving)}
										<button
											class="icon-button"
											aria-label={'Remove ' + entry.track_name}
											disabled={saving}
											onclick={() => {
												remove = { id: entry.id, title: entry.track_name };
												dialog = 'remove';
												editError = '';
											}}><Trash2 size={17} /></button
										>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			{/snippet}
		</ReorderList>
		{#if count < detail.rows.length}<button class="secondary more" onclick={() => (count += 50)}
				>More tracks</button
			>{/if}</SelectionHost
	>
{/if}
{#if dialog === 'rename'}
	<PlaylistDialog title="Rename playlist" onclose={close} busy={saving}>
		<PlaylistNameForm
			initial={current.name}
			action="Save name"
			bind:busy={saving}
			oncancel={close}
			onsubmit={async (name) => {
				await renamePlaylist(session, current.id, name);
				close();
				await load();
			}}
		/>
	</PlaylistDialog>
{:else if dialog === 'sharing'}
	<PlaylistSharing
		{session}
		playlist={current}
		onclose={close}
		onvisibility={(item) => {
			if (detail) detail.playlist = item;
		}}
	/>
{:else if dialog === 'remove' || dialog === 'delete'}
	<PlaylistDialog
		title={dialog === 'remove' ? 'Remove track?' : 'Delete playlist?'}
		onclose={close}
		busy={saving}
	>
		<p>
			{dialog === 'remove'
				? 'Remove “' + remove?.title + '” from “' + current.name + '”?'
				: 'Permanently delete “' + current.name + '” for everyone who uses it?'}
		</p>
		{#if editError}<p role="alert">{editError}</p>{/if}
		<div class="actions">
			<button class="secondary" disabled={saving} onclick={close}>Cancel</button>
			{#if dialog === 'remove' && remove}
				<button
					class="primary"
					disabled={saving}
					onclick={() => {
						if (remove) {
							const id = remove.id;
							void change(() => removePlaylistEntry(session, current.id, id));
						}
					}}>Remove track</button
				>
			{:else}
				<button
					class="primary"
					disabled={saving}
					onclick={() => change(() => deletePlaylist(session, current.id), true)}
					>Delete playlist</button
				>
			{/if}
		</div>
	</PlaylistDialog>
{/if}

<WebDetail
	{session}
	route={'/playlists/' + encodeURIComponent(playlist.id)}
	label="Open playlist in web app"
/>

{#if dialog === 'export'}<PlaylistExport
		{session}
		playlist={current}
		onclose={close}
		onsaved={(message) => {
			close();
			exportStatus = message;
		}}
	/>{/if}

<style>
	h1 {
		overflow-wrap: anywhere;
	}
	.actions,
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.entry {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
	}
	.tools {
		flex-wrap: nowrap;
		gap: 0;
	}
	.more {
		margin-top: var(--gap);
	}
</style>
