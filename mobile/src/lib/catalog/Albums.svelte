<script lang="ts">
	import type { Session } from '../connection';
	import type { Album } from './catalog';
	import Cover from './Cover.svelte';
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
</script>

<div class="albums" class:strip data-part="album-grid">
	{#each albums as album (album.localId || album.group)}
		<button class="album" data-part="album-card" onclick={() => onopen(album)}>
			<Cover {session} path={album.art} seed={album.group || album.localId || album.title} />
			<strong>{album.title}</strong><span>{album.artist}</span>
		</button>
	{/each}
</div>

<style>
	.albums {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 8.5rem), 1fr));
		gap: calc(var(--gap) * 1.4) var(--gap);
	}
	.strip {
		display: grid;
		grid-template-columns: none;
		grid-auto-flow: column;
		grid-auto-columns: clamp(7.5rem, 36%, 10rem);
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
