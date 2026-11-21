<script lang="ts" module>
	export type BrowseAction = 'play' | 'shuffle' | 'next' | 'end' | 'offline' | 'playlist';
</script>

<script lang="ts">
	import type { BrowseItem, Category } from './libraryBrowse';
	import type { SmartPlaylist } from './smartPlaylists';
	import { offlineSupported } from '../offline/media';
	import PlaylistDialog from './PlaylistDialog.svelte';
	let {
		row,
		category,
		offline = false,
		onclose,
		onopen,
		action,
		onpin,
		edit
	}: {
		row: BrowseItem;
		category: Category;
		offline?: boolean;
		onclose: () => void;
		onopen: (row: BrowseItem) => void;
		action: (type: BrowseAction, row: BrowseItem) => void;
		onpin?: () => void;
		edit?: (rule: SmartPlaylist) => void;
	} = $props();
	const singular = {
		Albums: 'album',
		Artists: 'artist',
		Tracks: 'song',
		Genres: 'genre',
		Playlists: 'playlist'
	};
</script>

<PlaylistDialog title={row.title} {onclose}>
	<div class="choices">
		<button onclick={() => onopen(row)}>Open {singular[category]}</button>
		<button onclick={() => action('play', row)}>Play</button><button
			onclick={() => action('shuffle', row)}>Shuffle</button
		>
		<button onclick={() => action('next', row)}>Play next</button><button
			onclick={() => action('end', row)}>Add to queue</button
		>
		{#if !offline}<button onclick={() => action('playlist', row)}>Add to playlist</button>
			{#if offlineSupported}<button onclick={() => action('offline', row)}>Save offline</button
				>{/if}
		{/if}
		{#if row.smart && edit}<button onclick={() => edit?.(row.smart!)}>Edit smart playlist</button
			>{/if}
		{#if category === 'Playlists' && onpin}<button onclick={onpin}>Pin to home screen</button>{/if}
	</div>
</PlaylistDialog>

<style>
	.choices {
		display: grid;
	}
	.choices button {
		min-height: 44px;
		padding: 0.4rem 0.3rem;
		text-align: start;
		border-bottom: 1px solid var(--line);
	}
</style>
