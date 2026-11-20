<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import { library, errorMessage, type Album } from './catalog';
	import Albums from './Albums.svelte';
	let { session, onopen }: { session: Session; onopen: (album: Album) => void } = $props();
	let albums = $state<Album[]>([]),
		next = $state<string | null>(),
		busy = $state(true),
		error = $state('');
	let active = true;
	async function load(after?: string) {
		busy = true;
		error = '';
		try {
			const page = await library(session, after);
			if (!active) return;
			const known = new Set(after ? albums.map((a) => a.localId) : []);
			albums = [...(after ? albums : []), ...page.albums.filter((a) => !known.has(a.localId))];
			next = page.next;
		} catch (e) {
			if (active) error = errorMessage(e);
		} finally {
			if (active) busy = false;
		}
	}
	onMount(() => {
		void load();
		return () => {
			active = false;
		};
	});
</script>

{#if albums.length}<h2>Recently added</h2>
	<Albums {session} {albums} {onopen} />{/if}
{#if error}<p role="alert">{error}</p>
	<button class="secondary" onclick={() => load(next ?? undefined)}>Try again</button>
{:else if busy}<p role="status">Loading albums…</p>
{:else if next}<button class="secondary" onclick={() => load(next ?? undefined)}>More albums</button
	>
{:else if !albums.length}<p>Your library is empty. Search for an album to request it.</p>{/if}
