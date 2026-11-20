<script lang="ts">
	import { ChevronRight, ListMusic, Tags } from '@lucide/svelte';
	import type { Session } from '../connection';
	import { errorMessage } from './catalog';
	import { searchGenres } from './discoveryWidgets';
	import { playlists, type Playlist } from './playlists';

	let {
		session,
		scope,
		term,
		ongenre,
		onplaylist,
		active = true,
		onerror,
		onready
	}: {
		session: Session;
		scope: 'genres' | 'playlists';
		term: string;
		ongenre: (name: string) => void;
		onplaylist: (p: Playlist) => void;
		active?: boolean;
		onerror?: (e: unknown) => boolean;
		onready?: () => void;
	} = $props();
	let genres = $state<string[]>([]),
		lists = $state<Playlist[]>([]);
	let busy = $state(true),
		error = $state(''),
		retry = $state(0);
	const query = $derived(term.trim().toLocaleLowerCase());
	const matchingGenres = $derived(genres.filter((g) => g.toLocaleLowerCase().includes(query)));
	const matchingLists = $derived(lists.filter((p) => p.name.toLocaleLowerCase().includes(query)));
	$effect(() => {
		const account = session,
			kind = scope;
		void retry;
		if (!active) return;
		const controller = new AbortController();
		let current = true;
		busy = true;
		error = '';
		genres = [];
		lists = [];
		async function read() {
			try {
				if (kind === 'playlists') {
					const found = await playlists(account, controller.signal);
					if (current) lists = found;
				} else {
					const labels = await searchGenres(account, controller.signal);
					if (current) genres = labels;
				}
			} catch (e) {
				if (current && !onerror?.(e)) error = errorMessage(e);
			} finally {
				if (current) {
					busy = false;
					onready?.();
				}
			}
		}
		void read();
		return () => {
			current = false;
			controller.abort();
		};
	});
</script>

{#if scope === 'genres' && query && !matchingGenres.some((g) => g.toLocaleLowerCase() === query)}
	<button class="item" onclick={() => ongenre(term.trim())}
		><Tags size={18} /><span>Browse “{term.trim()}” as a genre</span><ChevronRight
			size={17}
		/></button
	>
{/if}
{#if busy}<p role="status">Loading {scope}…</p>
{:else if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={() => retry++}>Try again</button>
{:else if scope === 'genres'}
	{#each matchingGenres as genre (genre)}<button class="item" onclick={() => ongenre(genre)}
			><Tags size={18} /><span>{genre}</span><ChevronRight size={17} /></button
		>{/each}
	{#if !query && !genres.length}<p>Enter a genre name to browse.</p>{/if}
{:else}
	{#each matchingLists as p (p.id)}<button class="item" onclick={() => onplaylist(p)}
			><ListMusic size={18} /><span>{p.name}</span><ChevronRight size={17} /></button
		>{:else}<p>{query ? 'No playlists match this search.' : 'No playlists available.'}</p>{/each}
{/if}

<style>
	.item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 48px;
		padding: 0.45rem 0;
		width: 100%;
		border-bottom: 1px solid var(--line);
		text-align: start;
	}
	.item span {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.item :global(svg) {
		color: var(--muted);
		flex: none;
	}
</style>
