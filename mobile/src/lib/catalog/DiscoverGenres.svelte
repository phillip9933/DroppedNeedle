<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import { errorMessage, type Album, type OnPlay } from './catalog';
	import { genreNames, browseGenre, type DiscoverArtistRef } from './discovery';
	import LibraryRadio from './LibraryRadio.svelte';
	import DiscoverShelf from './DiscoverShelf.svelte';
	let {
		session,
		onopen,
		onartist,
		onplay,
		active
	}: {
		session: Session;
		onopen: (a: Album) => void;
		onartist: (a: DiscoverArtistRef) => void;
		onplay: OnPlay;
		active: boolean;
	} = $props();
	let name = $state(''),
		term = $state(''),
		offset = $state(0),
		retry = $state(0);
	let genreList = $state<string[]>([]),
		result = $state<Awaited<ReturnType<typeof browseGenre>> | null>(null),
		error = $state(''),
		busy = $state(true);
	function choose(genre: string) {
		name = genre;
		offset = 0;
		term = '';
	}
	function back(event: Event) {
		if (active && name && !event.defaultPrevented) {
			event.preventDefault();
			choose('');
		}
	}
	$effect(() => {
		const account = session,
			genre = name,
			start = offset;
		void retry;
		let current = true;
		busy = true;
		error = '';
		result = null;
		const load = genre
			? browseGenre(account, genre, start).then((data) => {
					if (current) result = data;
				})
			: genreNames(account).then((data) => {
					if (current) genreList = data;
				});
		load
			.catch((cause) => {
				if (current) error = errorMessage(cause);
			})
			.finally(() => {
				if (current) busy = false;
			});
		return () => {
			current = false;
		};
	});
	onMount(() => {
		window.addEventListener('dn-back', back);
		return () => window.removeEventListener('dn-back', back);
	});
</script>

<section data-part="genres">
	{#if name}<button class="secondary" onclick={() => choose('')}>All genres</button>
		<h2>{name}</h2>
		<LibraryRadio {session} seedType="genre" seedId={name} {onplay} />{/if}
	{#if busy}<p role="status">Loading genres…</p>{:else if error}<p role="alert">{error}</p>
		<button class="secondary" onclick={() => retry++}>Try again</button>
	{:else if !name}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				if (term.trim()) choose(term.trim());
			}}
		>
			<input
				type="search"
				aria-label="Genre name"
				placeholder="Find a genre"
				bind:value={term}
			/><button class="secondary" disabled={!term.trim()}>Browse genre</button>
		</form>
		<div class="genres">
			{#each genreList.filter((g) => g
					.toLowerCase()
					.includes(term.trim().toLowerCase())) as g (g)}<button
					class="secondary"
					onclick={() => choose(g)}>{g}</button
				>{/each}
		</div>
	{:else if result}{#each result.lists as shelf (shelf.title)}<DiscoverShelf
				{shelf}
				{session}
				{onopen}
				{onartist}
			/>{:else}<p>No artists or albums found for this genre.</p>{/each}
		{#if offset > 0 || result.more}<div class="pages">
				<button class="secondary" disabled={offset === 0} onclick={() => (offset -= result!.limit)}
					>Previous</button
				><button class="secondary" disabled={!result.more} onclick={() => (offset += result!.limit)}
					>Next</button
				>
			</div>{/if}
	{/if}
</section>

<style>
	form,
	.genres,
	.pages {
		display: flex;
		align-items: center;
		gap: var(--gap);
		flex-wrap: wrap;
		margin-block: var(--gap);
	}
	form input {
		min-width: 0;
		flex: 1;
	}
	.pages {
		justify-content: space-between;
	}
</style>
