<script lang="ts">
	import { untrack } from 'svelte';
	import type { Session } from '../connection';
	import { player } from '../player';
	import type { OfflineInventory } from '../offline/library';
	import { type DeviceBucket, DeviceSearchIndex, deviceScopes } from './deviceSearch';
	import type { SearchScope, OnPlay } from './catalog';
	import { errorMessage } from './catalog';
	import { browseChoice, type BrowseItem, type Category } from './libraryBrowse';
	import { readBrowsePreferences } from './browsePreferences';
	import { queueSizeCheck } from './libraryQueue';
	import { playlistShuffle } from './browseActions';
	import { tappedPlayback } from './browsePlayback';
	import { loadNearEnd } from './browseViewport';
	import BrowseEntries from './BrowseEntries.svelte';
	import BrowseItemMenu, { type BrowseAction } from './BrowseItemMenu.svelte';
	import LibrarySmartPlaylists from './LibrarySmartPlaylists.svelte';
	import type { SmartPlaylist } from './smartPlaylists';
	import SelectionHost from './SelectionHost.svelte';
	let {
		session,
		inventory,
		model,
		term,
		scope,
		active,
		limit = $bindable(48),
		choose,
		onopen,
		onplay,
		onready,
		onrules
	}: {
		session: Session;
		inventory: OfflineInventory;
		model: DeviceSearchIndex;
		term: string;
		scope: SearchScope;
		active: boolean;
		limit?: number;
		choose: (scope: SearchScope) => void;
		onopen: (category: Category, item: BrowseItem) => void;
		onplay: OnPlay;
		onready: () => void;
		onrules: () => void;
	} = $props();
	let buckets = $state.raw<DeviceBucket[]>([]),
		error = $state(''),
		busy = $state(false),
		retry = $state(0),
		notice = $state(''),
		working = $state(false);
	let context = $state.raw<{ row: BrowseItem; category: Category } | null>(null),
		editing = $state.raw<SmartPlaylist>();
	let refs = $state<Partial<Record<Category, BrowseEntries>>>({});
	let lastQuery = '';
	const query = $derived(term.trim()),
		valid = $derived(scope === 'genres' || scope === 'playlists' || query.length >= 2);
	const views = $derived(
		buckets
			.map((b) => ({
				...b,
				shown: b.items.slice(0, scope === 'top' ? 4 : limit),
				style: readBrowsePreferences(session, b.category)
			}))
			.filter((b) => b.items.length)
	);
	const known = $derived(new Set(views.flatMap((v) => v.shown.map((i) => i.id))));
	const shuffle = playlistShuffle();
	$effect(() => {
		void session;
		void active;
		void query;
		void scope;
		notice = '';
		return shuffle.cancel;
	});
	$effect(() => {
		const index = model,
			q = query,
			s = scope;
		void retry;
		if (!active || !valid) {
			if (!valid) buckets = [];
			return;
		}
		const next = JSON.stringify([s, q]);
		if (lastQuery !== next) {
			buckets = [];
			lastQuery = next;
		}
		let live = true;
		busy = true;
		error = '';
		void index
			.query(s, q)
			.then(
				(r) => {
					if (live) buckets = r;
				},
				(e) => {
					if (live) {
						buckets = [];
						error = errorMessage(e);
					}
				}
			)
			.finally(() => {
				if (live) {
					busy = false;
					untrack(onready);
				}
			});
		return () => {
			live = false;
		};
	});
	function open(category: Category, row: BrowseItem) {
		context = null;
		if (!row.track) {
			onopen(category, row);
			return;
		}
		const list = buckets.find((b) => b.category === 'Tracks')?.items ?? [],
			tracks = list.flatMap((i) => (i.track ? [i.track] : []));
		try {
			const batch = tappedPlayback(
				session.serverUrl,
				tracks,
				list.findIndex((i) => i.id === row.id),
				[],
				tracks.length
			);
			void Promise.resolve(onplay(batch.tracks, batch.index)).catch(
				(e) => (error = errorMessage(e))
			);
		} catch (e) {
			error = errorMessage(e);
		}
	}
	async function action(type: BrowseAction, row: BrowseItem) {
		context = null;
		if (working) return;
		const tracks = row.localTracks ?? (row.track ? [row.track] : []);
		working = true;
		notice = '';
		error = '';
		try {
			if (!tracks.length) throw Error('No available tracks in this selection.');
			const check = queueSizeCheck(session.serverUrl);
			tracks.forEach(check);
			if (type === 'shuffle') await shuffle.play(tracks, session, onplay);
			else if (type === 'play') await onplay(tracks, 0);
			else if (type === 'next' || type === 'end') {
				await player.enqueue(tracks, session, type);
				notice = type === 'next' ? 'Added to play next.' : 'Added to queue.';
			}
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			working = false;
		}
	}
	export function focusResult(id: string) {
		const bucket = views.find((v) => v.shown.some((row) => row.id === id));
		if (bucket) void refs[bucket.category]?.focusItem(id);
	}
	const scopeFor = (category: Category): SearchScope =>
		(Object.entries(deviceScopes).find(([, v]) => v === category)?.[0] ?? 'top') as SearchScope;
</script>

<div>
	<SelectionHost
		{session}
		{onplay}
		{active}
		localOnly
		scope={JSON.stringify([scope, query])}
		choices={() => views.flatMap((g) => g.shown.map((i) => browseChoice(session, i)))}
		contains={(id) => known.has(id)}
	>
		{#if !valid}{#if query}<p>Enter at least two characters.</p>{/if}
		{:else if busy && !views.length}<p role="status">Searching this device…</p>
		{:else if error}<p role="alert">{error}</p>
			<button class="secondary" onclick={() => retry++}>Retry device search</button>
		{:else if !views.length}<p>
				{query
					? 'No matches on this device for “' + query + '”.'
					: 'No ' + scope + ' available on this device.'}
			</p>
		{:else}
			{#each views as group (group.category)}
				<section aria-label={'Device ' + group.category.toLowerCase()} class="bucket">
					{#if scope === 'top'}<div class="bucket-title">
							<h2>{group.category === 'Tracks' ? 'Songs' : group.category}</h2>
							{#if group.items.length > group.shown.length}<button
									class="text-button"
									onclick={() => choose(scopeFor(group.category))}
									>See all {group.category.toLowerCase()}</button
								>{/if}
						</div>{/if}
					<BrowseEntries
						bind:this={refs[group.category]}
						{session}
						{inventory}
						items={group.shown}
						total={group.items.length}
						category={group.category}
						layout={scope === 'top' ? 'list' : group.style.layout}
						columns={group.style.columns}
						compact={group.style.compact}
						{active}
						localOnly
						open={(row) => open(group.category, row)}
						menu={(row) => (context = { row, category: group.category })}
					/>
					{#if scope !== 'top' && group.shown.length < group.items.length}<button
							class="secondary"
							use:loadNearEnd={{ active, enabled: true, load: () => (limit += 48) }}
							onclick={() => (limit += 48)}>More results</button
						>{/if}
				</section>
			{/each}
		{/if}
		{#if notice}<p role="status">{notice}</p>{/if}
	</SelectionHost>
</div>
{#if context}<BrowseItemMenu
		row={context.row}
		category={context.category}
		offline
		onclose={() => (context = null)}
		onopen={(row) => open(context!.category, row)}
		{action}
		edit={(rule) => {
			editing = rule;
			context = null;
		}}
	/>{/if}
{#if editing}<LibrarySmartPlaylists
		{session}
		initial={editing}
		onclose={() => (editing = undefined)}
		oncreated={() => {
			editing = undefined;
			onrules();
		}}
	/>{/if}

<style>
	.bucket-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.bucket-title h2 {
		margin: 0.75rem 0;
	}
	.bucket-title button {
		min-height: 44px;
	}
	.bucket + .bucket {
		margin-top: 0.6rem;
	}
</style>
