<script lang="ts">
	import { tr, uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { onDestroy, untrack } from 'svelte';
	import type { Session } from '../connection';
	import LibraryFilterFields from '../boards/LibraryFilterFields.svelte';
	import { filterFromFields, libraryFilter } from '../boards/filteredSections';
	import { Plus, ListFilter } from '@lucide/svelte';
	import { createPlaylist, type Playlist } from './playlists';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import { maxQueueTracks } from './libraryQueue';
	import type { PlayerTrack } from '../player';
	import { offlineInventory } from '../offline/media';
	import { availableTracks } from '../offline/library';
	import { smartPlaylistTracks, writeSmartPlaylist, type SmartPlaylist } from './smartPlaylists';

	let {
		session,
		initial,
		disconnected = false,
		onblank,
		oncreated,
		onclose
	}: {
		session: Session;
		initial?: SmartPlaylist;
		disconnected?: boolean;
		onblank?: (playlist: Playlist) => void;
		oncreated: () => void;
		onclose: () => void;
	} = $props();
	let name = $state(untrack(() => initial?.name ?? ''));
	let choosing = $state(untrack(() => !initial));
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
	const id = untrack(() => initial?.id ?? 'smart-' + crypto.randomUUID());
	let sample = $state.raw<PlayerTrack[]>(),
		previewing = $state(false);
	let request: AbortController | undefined;
	function clearPreview() {
		request?.abort();
		request = undefined;
		sample = undefined;
		previewing = false;
	}
	onDestroy(() => request?.abort());
	function currentRule(): SmartPlaylist {
		return {
			...filterFromFields(config, formats),
			id,
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
	}
	async function previewTracks() {
		clearPreview();
		const controller = new AbortController();
		request = controller;
		previewing = true;
		error = '';
		try {
			const draft = currentRule();
			const local = disconnected ? availableTracks(await offlineInventory(session)) : undefined;
			const tracks = await smartPlaylistTracks(
				session,
				{
					...draft,
					name: name.trim() || uiText('Smart playlist'),
					limit: disconnected ? draft.limit : Math.min(draft.limit, 8)
				},
				controller.signal,
				local
			);
			if (!controller.signal.aborted) sample = tracks.slice(0, 8);
		} catch (cause) {
			if (!controller.signal.aborted)
				error =
					cause instanceof Error
						? cause.message
						: tr('Could not preview tracks.', '曲をプレビューできませんでした。');
		} finally {
			if (request === controller) previewing = false;
		}
	}
	function back() {
		clearPreview();
		if (!choosing && !initial) {
			choosing = true;
			error = '';
		} else onclose();
	}
	async function blank() {
		if (!onblank || busy || disconnected || !name.trim()) return;
		busy = true;
		error = '';
		try {
			const playlist = await createPlaylist(session, name.trim());
			window.dispatchEvent(new Event('dn-playlists-updated'));
			onblank(playlist);
		} catch (cause) {
			error =
				cause instanceof Error
					? cause.message
					: tr('Could not create playlist.', 'プレイリストを作成できませんでした。');
		} finally {
			busy = false;
		}
	}
	async function submit() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const next = removing ? null : currentRule();
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

{#key choosing}
	<PlaylistDialog
		page={!choosing && !removing}
		title={choosing
			? uiText('New playlist')
			: removing
				? 'Delete smart playlist?'
				: initial
					? uiText('Edit smart playlist')
					: tr('Smart playlist', 'スマートプレイリスト')}
		onclose={back}
		{busy}
	>
		{#if choosing}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void blank();
				}}
			>
				<label>{uiText('Playlist name')}<input bind:value={name} disabled={busy} /></label>
				<div class="kinds">
					<button class="secondary" type="submit" disabled={busy || disconnected || !name.trim()}
						><Plus size={21} />
						<span
							>{tr('Create empty playlist', '空のプレイリストを作成')}<small
								>{disconnected
									? tr(
											'Connect to DN to create a playlist.',
											'作成するには DN に接続してください。'
										)
									: tr('Add tracks yourself.', 'あとから曲を追加します。')}</small
							></span
						></button
					>
					<button
						class="secondary"
						type="button"
						disabled={busy}
						onclick={() => {
							choosing = false;
							error = '';
						}}
						><ListFilter size={21} />
						<span
							>{tr('Smart playlist', 'スマートプレイリスト')}<small
								>{tr(
									'Choose rules for library tracks.',
									'ライブラリの曲を選ぶ条件を設定します。'
								)}</small
							></span
						></button
					>
				</div>
				<button class="text-button" type="button" disabled={busy} onclick={onclose}
					>{uiText('Cancel')}</button
				>
			</form>
		{:else if removing}
			<p>{uiText('Delete “')}{initial?.name}{uiText('” from this device?')}</p>
			<div class="actions">
				<button
					class="secondary"
					disabled={busy}
					onclick={() => {
						removing = false;
						error = '';
					}}>{uiText('Cancel')}</button
				>
				<button class="primary" disabled={busy} onclick={submit}>{uiText('Delete playlist')}</button
				>
			</div>
		{:else}
			<p>
				{uiText(
					'These rules stay on this device. The songs update from your DN library whenever you open or play the playlist.'
				)}
			</p>
			<form
				oninput={clearPreview}
				onchange={clearPreview}
				onsubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<label
					>{uiText('Playlist name')}<input
						required
						maxlength="64"
						placeholder={uiText('Five-star songs')}
						bind:value={name}
					/></label
				>
				<h3>{tr('Track filters', '曲のフィルター')}</h3>
				<LibraryFilterFields bind:config bind:formats selectKind={false} prefix="Playlist" />
				<details open={advancedOpen}>
					<summary>{uiText('Genre, year and listening history')}</summary>
					<label
						>{uiText('Genre')}<input
							bind:value={genre}
							maxlength="160"
							placeholder={uiText('Any genre')}
						/></label
					>
					<div class="bounds">
						<label
							>{uiText('Earliest year')}<input
								type="number"
								inputmode="numeric"
								min="1"
								max="9999"
								bind:value={yearFrom}
							/></label
						>
						<label
							>{uiText('Latest year')}<input
								type="number"
								inputmode="numeric"
								min="1"
								max="9999"
								bind:value={yearTo}
							/></label
						>
						<label
							>{uiText('Minimum plays')}<input
								type="number"
								inputmode="numeric"
								min="0"
								max="1000000"
								bind:value={minPlays}
							/></label
						>
						<label
							>{uiText('Maximum plays')}<input
								type="number"
								inputmode="numeric"
								min="0"
								max="1000000"
								bind:value={maxPlays}
							/></label
						>
					</div>
					<label
						>{uiText('Not played in the last (days)')}<input
							type="number"
							inputmode="numeric"
							min="1"
							max="36500"
							bind:value={notPlayedDays}
						/></label
					>
					<small
						>{uiText(
							'Includes songs you’ve never played. Set minimum plays to 1 for previously played songs only.'
						)}</small
					>
				</details>
				<label
					>{uiText('Sort direction')}<InlineChoice selected={order}
						><select bind:value={order}
							><option value="asc">{uiText('Ascending')}</option><option value="desc"
								>{uiText('Descending')}</option
							></select
						></InlineChoice
					></label
				>
				<label
					>{uiText('Track limit')}<input
						type="number"
						inputmode="numeric"
						min="1"
						max={maxQueueTracks}
						required
						bind:value={limit}
					/></label
				>
				<button
					type="button"
					class="secondary"
					disabled={busy || previewing}
					onclick={previewTracks}>{tr('Preview matching tracks', '該当する曲をプレビュー')}</button
				>
				{#if previewing}<p role="status">{uiText('Loading…')}</p>{:else if sample}
					<section aria-label={tr('Matching tracks', '該当する曲')}>
						{#if sample.length}<ol class="sample">
								{#each sample as track (track.id)}<li>
										{track.title}<small>{track.artist}</small>
									</li>{/each}
							</ol>
						{:else}<p>{tr('No matching tracks.', '該当する曲はありません。')}</p>{/if}
					</section>
				{/if}
				<div class="actions">
					<button type="button" class="secondary" disabled={busy} onclick={onclose}
						>{uiText('Cancel')}</button
					>
					<button class="primary" disabled={busy} type="submit"
						>{initial ? uiText('Save playlist') : uiText('Create smart playlist')}</button
					>
				</div>
				{#if initial}<button
						type="button"
						class="text-button"
						disabled={busy}
						onclick={() => {
							removing = true;
							error = '';
						}}>{uiText('Delete smart playlist')}</button
					>{/if}
			</form>
		{/if}
		{#if error}<p role="alert">{error}</p>{/if}
	</PlaylistDialog>
{/key}

<style>
	.sample {
		margin: 0.5rem 0;
		padding-inline-start: 1.75rem;
	}
	.sample li {
		padding: 0.35rem;
	}
	.kinds {
		display: grid;
		gap: 0.45rem;
		margin-block: var(--gap);
	}
	.kinds button {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		text-align: start;
	}
	.kinds small {
		font-weight: 400;
		margin-top: 0.15rem;
	}
	h3 {
		margin-block: 1rem 0.5rem;
	}

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
