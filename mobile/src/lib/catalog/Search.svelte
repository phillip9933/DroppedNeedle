<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { Session } from '../connection';
	import { catalogSource } from './catalogSource.svelte';
	import { DeviceSearchIndex } from './deviceSearch';
	import DeviceSearchResults from './DeviceSearchResults.svelte';
	import LibraryGroup from './LibraryGroup.svelte';
	import type { BrowseItem, Category } from './libraryBrowse';
	import { ChevronLeft } from '@lucide/svelte';
	import { search, errorMessage, type Album, type OnPlay, type SearchScope } from './catalog';
	import type { Playlist } from './playlists';
	import SearchCollection from './SearchCollection.svelte';
	import RequestSong from './RequestSong.svelte';
	import Albums from './Albums.svelte';
	import TrackList from './TrackList.svelte';
	let {
		session,
		onopen,
		onplay,
		onartist,
		ongenre,
		onplaylist,
		active = true,
		term = $bindable('')
	}: {
		session: Session;
		onopen: (a: Album) => void;
		onplay: OnPlay;
		onartist: (a: { name: string; localId?: string | null; mbid?: string | null }) => void;
		ongenre: (name: string) => void;
		onplaylist: (p: Playlist) => void;
		term?: string;
		active?: boolean;
	} = $props();
	const scopes = [
		{ id: 'top', label: 'Top results' },
		{ id: 'artists', label: 'Artists' },
		{ id: 'albums', label: 'Albums' },
		{ id: 'tracks', label: 'Songs' },
		{ id: 'genres', label: 'Genres' },
		{ id: 'playlists', label: 'Playlists' }
	] as const;
	let scope = $state<SearchScope>('top'),
		offset = $state(0);
	let result = $state<Awaited<ReturnType<typeof search>> | null>(null);
	let error = $state(''),
		busy = $state(false),
		retry = $state(0);
	let root: HTMLElement,
		localResults = $state<DeviceSearchResults>(),
		detail = $state.raw<{ category: Category; row: BrowseItem } | null>(null);
	const source = catalogSource(
		() => session,
		() => active,
		() => !!detail
	);
	const useDevice = $derived(source.useDevice),
		inventory = $derived(source.inventory);
	let ruleRevision = $state(0);
	const localModel = $derived.by(() => {
		void ruleRevision;
		return inventory ? new DeviceSearchIndex(session, inventory) : undefined;
	});
	let freshDetail = $state.raw<BrowseItem>(),
		detailError = $state('');
	let deviceLimit = $state(48);
	const positions: Partial<Record<'device' | 'dn', number>> = {};
	let previousMode: boolean | undefined,
		detailOffset = 0,
		pendingOffset: number | undefined,
		returnId = '',
		restoration = 0;
	const query = $derived({ account: session, q: term.trim(), kind: scope, start: offset, retry });
	let completed: typeof query | undefined;
	$effect(() => {
		const selected = detail,
			model = localModel;
		if (!selected) return;
		let live = true;
		detailError = '';
		if (!model) {
			freshDetail = undefined;
			return;
		}
		void model.find(selected.category, selected.row.id).then(
			(row) => {
				if (live) freshDetail = row;
			},
			(cause) => {
				if (live) detailError = errorMessage(cause);
			}
		);
		return () => {
			live = false;
		};
	});
	$effect.pre(() => {
		const local = useDevice;
		if (previousMode !== undefined && previousMode !== local && root && active && !detail) {
			const y = root.closest('main')?.scrollTop ?? 0;
			positions[previousMode ? 'device' : 'dn'] = y;
			pendingOffset = positions[local ? 'device' : 'dn'] ?? y;
		}
		previousMode = local;
	});
	function restore() {
		if (pendingOffset === undefined || detail || !active) return;
		const generation = ++restoration;
		void tick().then(() =>
			requestAnimationFrame(() => {
				if (generation !== restoration || pendingOffset === undefined || detail || !active) return;
				root.closest('main')?.scrollTo(0, pendingOffset);
				pendingOffset = undefined;
				if (useDevice && returnId) {
					const id = returnId;
					void tick().then(() => requestAnimationFrame(() => localResults?.focusResult(id)));
				}
				returnId = '';
			})
		);
	}
	function changedQuery() {
		offset = 0;
		deviceLimit = 48;
		pendingOffset = undefined;
		returnId = '';
		delete positions.device;
		delete positions.dn;
	}
	function choose(next: SearchScope) {
		if (next !== scope) {
			scope = next;
			changedQuery();
		}
	}
	export function getPlaybackAvailability(): 'offline' | undefined {
		return useDevice || detail ? 'offline' : undefined;
	}
	function enterDevice(category: Category, row: BrowseItem) {
		detailOffset = root.closest('main')?.scrollTop ?? 0;
		positions.device = detailOffset;
		freshDetail = row;
		detail = { category, row };
		void tick().then(() => {
			const main = root.closest('main');
			main?.scrollTo(0, 0);
			main?.focus({ preventScroll: true });
		});
	}
	export function goBack() {
		if (!detail) return false;
		pendingOffset = detailOffset;
		returnId = detail.row.id;
		detail = null;
		freshDetail = undefined;
		void tick().then(() => {
			if (!useDevice && completed === query) restore();
		});
		return true;
	}
	$effect(() => {
		const spec = query,
			can = active && source.ready && !detail;
		if (useDevice) {
			completed = undefined;
			return;
		}
		if (!can) return;
		const { account, q, kind, start } = spec;
		if (completed === spec) {
			untrack(restore);
			return;
		}
		result = null;
		error = '';
		const searchable = q.length >= 2 && kind !== 'genres' && kind !== 'playlists';
		busy = searchable;
		if (!searchable) {
			if (kind !== 'genres' && kind !== 'playlists') untrack(restore);
			return;
		}
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const found = await search(
					account,
					q,
					kind as 'top' | 'albums' | 'artists' | 'tracks',
					start,
					controller.signal
				);
				if (!controller.signal.aborted) {
					result = found;
					completed = spec;
				}
			} catch (cause) {
				if (!controller.signal.aborted && !source.connectionFailed(cause))
					error = errorMessage(cause);
			} finally {
				if (!controller.signal.aborted) {
					busy = false;
					if (!useDevice) restore();
				}
			}
		}, 300);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});
</script>

<div bind:this={root}>
	<div hidden={!!detail}>
		<h1>Search</h1>
		<input
			type="search"
			bind:value={term}
			oninput={changedQuery}
			aria-label="Search music"
			placeholder={scope === 'top'
				? 'Search music'
				: 'Search ' + scopes.find((s) => s.id === scope)?.label.toLowerCase()}
			autocomplete="off"
		/>
		<div class="scopes" role="group" aria-label="Search category">
			{#each scopes as item (item.id)}<button
					aria-pressed={scope === item.id}
					onclick={() => choose(item.id)}>{item.label}</button
				>{/each}
		</div>
		{#if source.policyIssue}<p role="alert">{source.policyIssue}</p>
			<button class="secondary" onclick={() => source.retryPolicy()}>Retry search settings</button>
		{:else if !source.ready}<p role="status">Opening search…</p>
		{:else if useDevice}
			<p class="device-source" role="status">
				{source.unreachable
					? 'DN is unavailable. Searching music on this device.'
					: 'Searching music on this device.'}
				{#if source.unreachable}<button
						class="text-button"
						onclick={() => {
							source.retryNetwork();
							retry++;
						}}>Retry DN</button
					>{/if}
			</p>
			{#if source.storageError}<p role="alert">{source.storageError}</p>
				{#if session.userId}<button class="secondary" onclick={() => source.retryStorage()}
						>Retry device library</button
					>{/if}
			{:else if inventory && !inventory.items.length}<p>
					No music is saved or cached for this account on this device.
				</p>
			{:else if inventory && localModel}<DeviceSearchResults
					bind:this={localResults}
					bind:limit={deviceLimit}
					{session}
					{inventory}
					model={localModel}
					{term}
					{scope}
					active={active && !detail}
					{choose}
					onopen={enterDevice}
					{onplay}
					onready={restore}
					onrules={() => ruleRevision++}
				/>
			{:else if source.storageBusy}<p role="status">Opening saved music…</p>{/if}
		{:else if scope === 'genres' || scope === 'playlists'}
			<SearchCollection
				{session}
				{scope}
				{term}
				{ongenre}
				{onplaylist}
				active={active && !detail}
				onerror={source.connectionFailed}
				onready={restore}
			/>
		{:else if error}<p role="alert">{error}</p>
			<button class="secondary" onclick={() => retry++}>Try again</button>
		{:else if busy}<p role="status">Searching…</p>
		{:else if result}
			{#if result.tracks.length}<h2>Songs in your library</h2>
				<TrackList {session} tracks={result.tracks} {onplay} />{/if}
			{#if result.artists.length}<h2>Artists</h2>
				<div class="artists">
					{#each result.artists as artist (artist.mbid || artist.localId)}<button
							class="secondary"
							onclick={() => onartist(artist)}>{artist.name}</button
						>{/each}
				</div>{/if}
			{#if result.albums.length}<h2>Albums</h2>
				<Albums {session} albums={result.albums} {onopen} />{/if}
			{#if result.recordings.length}<h2>Songs to request</h2>
				{#each result.recordings as row (row.song.recording_mbid + '-' + row.song.release_mbid)}<div
						class="recording"
					>
						<span
							><strong>{row.song.track_title}</strong><small
								>{row.song.artist_name} · {row.song.album_title}</small
							></span
						><RequestSong {session} song={row.song} requested={row.requested} />
					</div>{/each}{/if}
			{#if result.partial}<p role="status">Some MusicBrainz results are unavailable.</p>
				<button class="secondary" onclick={() => retry++}>Retry search</button>{/if}
			{#if !result.albums.length && !result.tracks.length && !result.artists.length && !result.recordings.length}<p
				>
					{offset ? 'No more matches.' : 'No matches for “' + term.trim() + '”.'}
				</p>{/if}
			{#if scope !== 'top' && (offset > 0 || result.next !== null)}
				<div class="pages">
					<button
						class="secondary"
						disabled={!offset}
						onclick={() => {
							if (result) offset = result.previous;
						}}>Previous results</button
					><button
						class="secondary"
						disabled={result.next === null}
						onclick={() => {
							if (result?.next != null) offset = result.next;
						}}>Next results</button
					>
				</div>
			{/if}
		{:else if term.length}<p>Enter at least two characters.</p>{/if}
	</div>
	{#if detail}
		<button class="text-button device-back" aria-label="Back to search" onclick={goBack}
			><ChevronLeft size={18} />Back to search</button
		>
		{#if detailError}<p role="alert">{detailError}</p>
			<button class="secondary" onclick={() => source.retryStorage()}>Retry device library</button>
		{:else}
			{#key detail.row.id}<LibraryGroup
					{session}
					{active}
					offline
					item={freshDetail ?? detail.row}
					tracks={freshDetail?.localTracks ?? []}
					{onplay}
				/>{/key}
		{/if}
	{/if}
</div>

<style>
	.device-source,
	.device-back {
		display: flex;
		gap: 0.45rem;
		align-items: center;
	}
	.device-source {
		font-size: 0.85rem;
		color: var(--muted);
	}
	.device-source button,
	.device-back {
		min-height: 44px;
	}
	.scopes,
	.pages {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.5rem 0 1rem;
	}
	.scopes button {
		min-height: 44px;
		padding: 0.3rem 0.72rem;
		font-weight: 600;
		font-size: 0.92rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}
	.scopes button[aria-pressed='true'] {
		color: var(--on-accent);
		background: var(--accent);
		border-color: var(--accent);
	}

	.artists {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.recording {
		display: flex;
		gap: 0.65rem;
		align-items: center;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--line);
	}
	.recording span {
		flex: 1;
		min-width: 0;
	}
	.recording strong,
	.recording small {
		display: block;
	}
	.recording small {
		color: var(--muted);
	}
</style>
