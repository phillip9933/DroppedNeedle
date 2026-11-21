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
	let genre = $state(untrack(() => initial?.genre ?? ''));
	let yearFrom = $state(untrack(() => initial?.yearFrom)),
		yearTo = $state(untrack(() => initial?.yearTo));
	let minPlays = $state(untrack(() => initial?.minPlays)),
		maxPlays = $state(untrack(() => initial?.maxPlays));
	let notPlayedDays = $state(untrack(() => initial?.notPlayedDays));
	const advancedOpen = untrack(
		() =>
			!!(
				genre ||
				yearFrom ||
				yearTo ||
				minPlays !== undefined ||
				maxPlays !== undefined ||
				notPlayedDays
			)
	);
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
						order,
						genre,
						yearFrom,
						yearTo,
						minPlays,
						maxPlays,
						notPlayedDays
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
			<details open={advancedOpen}>
				<summary>Genre, year and listening history</summary>
				<label>Genre<input bind:value={genre} maxlength="160" placeholder="Any genre" /></label>
				<div class="bounds">
					<label
						>Earliest year<input
							type="number"
							inputmode="numeric"
							min="1"
							max="9999"
							bind:value={yearFrom}
						/></label
					>
					<label
						>Latest year<input
							type="number"
							inputmode="numeric"
							min="1"
							max="9999"
							bind:value={yearTo}
						/></label
					>
					<label
						>Minimum plays<input
							type="number"
							inputmode="numeric"
							min="0"
							max="1000000"
							bind:value={minPlays}
						/></label
					>
					<label
						>Maximum plays<input
							type="number"
							inputmode="numeric"
							min="0"
							max="1000000"
							bind:value={maxPlays}
						/></label
					>
				</div>
				<label
					>Not played in the last (days)<input
						type="number"
						inputmode="numeric"
						min="1"
						max="36500"
						bind:value={notPlayedDays}
					/></label
				>
				<small
					>Includes songs you’ve never played. Set minimum plays to 1 for previously played songs
					only.</small
				>
			</details>
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

<style>
	details {
		margin: 1rem 0;
		border-block: 1px solid var(--line);
		padding: 0.6rem 0;
	}
	summary {
		cursor: pointer;
		line-height: 2;
		font-weight: 600;
	}
	.bounds {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0 0.6rem;
	}
	small {
		display: block;
		color: var(--muted);
	}
</style>
