<script lang="ts">
	import type { Session } from '../connection';
	import { errorMessage, type Album, type OnPlay } from './catalog';
	import { browseGenre, type DiscoverArtistRef } from './discovery';
	import DiscoverShelf from './DiscoverShelf.svelte';
	import LibraryRadio from './LibraryRadio.svelte';
	let {
		session,
		name,
		onopen,
		onartist,
		onplay
	}: {
		session: Session;
		name: string;
		onopen: (a: Album) => void;
		onartist: (a: DiscoverArtistRef) => void;
		onplay: OnPlay;
	} = $props();
	let offset = $state(0),
		retry = $state(0);
	let result = $state<Awaited<ReturnType<typeof browseGenre>> | null>(null),
		error = $state(''),
		busy = $state(true);
	$effect(() => {
		const account = session,
			genre = name,
			start = offset;
		void retry;
		let current = true;
		busy = true;
		error = '';
		result = null;
		browseGenre(account, genre, start)
			.then((data) => {
				if (current) result = data;
			})
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
</script>

<h2>{name}</h2>
<LibraryRadio {session} seedType="genre" seedId={name} {onplay} />
{#if busy}<p role="status">Loading genres…</p>{:else if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={() => retry++}>Try again</button>
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

<style>
	.pages {
		display: flex;
		gap: var(--gap);
		margin-block: var(--gap);
	}
</style>
