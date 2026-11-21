<script lang="ts">
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { untrack } from 'svelte';
	import type { Session } from '../connection';
	import LibraryFilterFields from '../boards/LibraryFilterFields.svelte';
	import { filterFromFields, libraryFilter } from '../boards/filteredSections';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import { maxQueueTracks } from './libraryQueue';
	import { writeSmartPlaylist, type SmartPlaylist } from './smartPlaylists';

	let {
		session,
		initial,
		oncreated,
		onclose
	}: {
		session: Session;
		initial?: SmartPlaylist;
		oncreated: () => void;
		onclose: () => void;
	} = $props();
	let name = $state(untrack(() => initial?.name ?? ''));
	let config = $state(untrack(() => libraryFilter(initial)));
	let formats = $state(untrack(() => config.formats.join(', ')));
	let limit = $state<number | undefined>(untrack(() => initial?.limit ?? 100));
	let order = $state<'asc' | 'desc'>(untrack(() => initial?.order ?? 'asc'));
	let removing = $state(false),
		busy = $state(false),
		error = $state('');
	async function submit() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const next: SmartPlaylist | null = removing
				? null
				: {
						...filterFromFields(config, formats),
						id: initial?.id ?? 'smart-' + crypto.randomUUID(),
						name,
						limit: limit ?? 0,
						order
					};
			await writeSmartPlaylist(session, next, initial);
			oncreated();
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : 'Could not update this playlist on the device.';
		} finally {
			busy = false;
		}
	}
</script>

<PlaylistDialog
	title={removing
		? 'Delete smart playlist?'
		: initial
			? 'Edit smart playlist'
			: 'Create smart playlist'}
	{onclose}
	{busy}
>
	{#if removing}
		<p>Delete “{initial?.name}” from this device?</p>
		<div class="actions">
			<button
				class="secondary"
				disabled={busy}
				onclick={() => {
					removing = false;
					error = '';
				}}>Cancel</button
			>
			<button class="primary" disabled={busy} onclick={submit}>Delete playlist</button>
		</div>
	{:else}
		<p>
			These rules stay on this device. The songs update from your DN library whenever you open or
			play the playlist.
		</p>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<label
				>Playlist name<input
					required
					maxlength="64"
					placeholder="Five-star songs"
					bind:value={name}
				/></label
			>
			<LibraryFilterFields bind:config bind:formats selectKind={false} prefix="Playlist" />
			<label
				>Sort direction<InlineChoice selected={order}
					><select bind:value={order}
						><option value="asc">Ascending</option><option value="desc">Descending</option></select
					></InlineChoice
				></label
			>
			<label
				>Track limit<input
					type="number"
					inputmode="numeric"
					min="1"
					max={maxQueueTracks}
					required
					bind:value={limit}
				/></label
			>
			<div class="actions">
				<button type="button" class="secondary" disabled={busy} onclick={onclose}>Cancel</button>
				<button class="primary" disabled={busy} type="submit"
					>{initial ? 'Save playlist' : 'Create smart playlist'}</button
				>
			</div>
			{#if initial}<button
					type="button"
					class="text-button"
					disabled={busy}
					onclick={() => {
						removing = true;
						error = '';
					}}>Delete smart playlist</button
				>{/if}
		</form>
	{/if}
	{#if error}<p role="alert">{error}</p>{/if}
</PlaylistDialog>
