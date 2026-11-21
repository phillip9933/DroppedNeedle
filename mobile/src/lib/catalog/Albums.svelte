<script lang="ts">
	import type { Session } from '../connection';
	import { albumTracks, type Album } from './catalog';
	import { albumItem } from './libraryBrowse';
	import { readBrowsePreferences } from './browsePreferences';
	import BrowseEntries from './BrowseEntries.svelte';
	import { useLibrarySelection } from './librarySelection.svelte';
	import Cover from './Cover.svelte';
	const selectable = useLibrarySelection();
	let {
		session,
		albums,
		strip = false,
		onopen
	}: {
		session: Session;
		albums: Album[];
		strip?: boolean;
		onopen: (album: Album) => void;
	} = $props();
	const settings = $derived(readBrowsePreferences(session, 'Albums'));
	const items = $derived(albums.map(albumItem));
</script>

{#if strip}
	<div class="strip" data-part="album-grid">
		{#each albums as album (album.localId || album.group)}
			<button
				use:selectable={{
					id: 'album:' + (album.localId || album.group),
					title: album.title,
					tracks: (signal) => albumTracks(session, album, signal)
				}}
				class="album"
				data-part="album-card"
				onclick={() => onopen(album)}
			>
				<Cover {session} path={album.art} seed={album.group || album.localId || album.title} />
				<strong>{album.title}</strong><span>{album.artist}</span>
			</button>
		{/each}
	</div>
{:else}
	<BrowseEntries
		{session}
		{items}
		category="Albums"
		albumGallery
		layout={settings.layout}
		columns={settings.columns}
		compact={settings.compact}
		open={(item) => {
			if (item.album) onopen(item.album);
		}}
	/>
{/if}

<style>
	.strip {
		display: grid;
		grid-template-columns: none;
		grid-auto-flow: column;
		grid-auto-columns: clamp(7.5rem, 36%, 10rem);
		gap: var(--gap);
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
		padding: 0.15rem 0.1rem 0.5rem;
	}
	.strip button {
		scroll-snap-align: start;
	}
	.album {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		min-width: 0;
		text-align: start;
		background: transparent;
		border: 0;
		color: var(--text);
		padding: 0;
		line-height: 1.35;
	}
	strong,
	.album > span {
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	strong {
		margin-top: 0.5rem;
		font-size: 1rem;
	}
	.album > span {
		font-size: 0.88rem;
		color: var(--muted);
	}
</style>
