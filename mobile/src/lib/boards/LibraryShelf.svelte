<script lang="ts">
	import { uiText } from '../i18n';
	import { Play } from '@lucide/svelte';
	import type { Session } from '../connection';
	import type { PlayerTrack } from '../player';
	import { errorMessage, type OnPlay } from '../catalog/catalog';
	import { browseChoice, type BrowseItem } from '../catalog/libraryBrowse';
	import { tappedPlayback } from '../catalog/browsePlayback';
	import TrackActions from '../catalog/TrackActions.svelte';
	import PreviewItem from './PreviewItem.svelte';
	import type { Preview } from './display';
	import type { Section } from './layout';
	import { entityFilter, shelfRows } from './shelfLibrary';
	let {
		section,
		display,
		expanded,
		session,
		tracks,
		active,
		onopen,
		onplay
	}: {
		section: Section;
		display: Preview;
		expanded: boolean;
		session: Session;
		tracks?: PlayerTrack[];
		active: boolean;
		onopen: (row: BrowseItem) => void;
		onplay: OnPlay;
	} = $props();
	let rows = $state.raw<BrowseItem[]>([]),
		busy = $state(true),
		error = $state(''),
		progress = $state(''),
		retry = $state(0),
		limit = $state(48);
	let previous: { session: Session; device: boolean; id: string } | undefined;
	let actionError = $state('');
	const songs = $derived(rows.flatMap((row) => (row.track ? [row.track] : [])));
	const shown = $derived(rows.slice(0, expanded ? limit : display.capacity));
	$effect(() => {
		const item = section,
			account = session,
			music = tracks;
		void retry;
		if (!active) return;
		if (previous?.session !== account || previous.device !== !!music || previous.id !== item.id)
			rows = [];
		previous = { session: account, device: !!music, id: item.id };
		const request = new AbortController();
		busy = true;
		error = '';
		progress = '';
		void shelfRows(account, item, music, request.signal, (count, total) => {
			progress =
				'Indexing genres · ' + count.toLocaleString() + ' of ' + total.toLocaleString() + ' tracks';
		})
			.then(
				(found) => {
					if (!request.signal.aborted) rows = found;
				},
				(e) => {
					if (!request.signal.aborted) {
						rows = [];
						error = errorMessage(e);
					}
				}
			)
			.finally(() => {
				if (!request.signal.aborted) busy = false;
			});
		return () => request.abort();
	});
	async function play(index: number) {
		actionError = '';
		try {
			const batch = tappedPlayback(session.serverUrl, songs, index, [], songs.length);
			await onplay(batch.tracks, batch.index);
		} catch (cause) {
			actionError = errorMessage(cause);
		}
	}
</script>

{#if expanded && tracks && entityFilter(section.filter)}<p>
		{uiText('Showing saved music previously matched by DroppedNeedle.')}
	</p>{/if}
{#if expanded && songs.length}<button class="secondary action" onclick={() => play(0)}
		><Play size={16} />{uiText('Play from beginning')}</button
	>{/if}
{#if rows.length}<div class="preview-items">
		{#each shown as row, index (row.id)}
			{#snippet rowActions()}{#if row.track}<TrackActions
						{session}
						tracks={[row.track]}
						favorite={row.track.favorite}
						localOnly
						label={'More options for ' + row.title}
					/>{/if}{/snippet}
			<PreviewItem
				{session}
				cacheOnly={!!tracks}
				title={row.title}
				subtitle={row.subtitle ??
					(row.count === undefined ? '' : row.count + ' ' + (row.count === 1 ? 'track' : 'tracks'))}
				artwork={row.art ?? row.covers?.[0]}
				coverSeed={section.id === 'library-genres' && !row.art ? undefined : row.title}
				detail={row.track?.album}
				label={row.track ? 'Play ' + row.title : row.title}
				choice={browseChoice(session, row)}
				onclick={() => (row.track ? void play(index) : onopen(row))}
				actions={row.track ? rowActions : undefined}
			/>
		{/each}
	</div>{/if}
{#if actionError}<p role="alert">{actionError}</p>{/if}
{#if error}<p role="alert">{error}</p>
	<button class="text-button" onclick={() => retry++}>{uiText('Try again')}</button>
{:else if busy && !rows.length}<p role="status">{progress || uiText('Loading collection…')}</p>
{:else if !rows.length}<p>
		{section.id === 'library-recently-added'
			? uiText('No saved albums have a known library addition date.')
			: tracks
				? uiText('No matching music on this device.')
				: uiText('No library genres found.')}
	</p>
{:else if expanded && shown.length < rows.length}<button
		class="secondary"
		onclick={() => (limit += 48)}>{uiText('More results')}</button
	>{/if}

<style>
	.action {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
		min-height: 44px;
		margin-bottom: 0.5rem;
	}
</style>
