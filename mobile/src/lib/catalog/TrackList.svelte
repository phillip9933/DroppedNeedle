<script lang="ts">
	import { Play } from '@lucide/svelte';
	import type { PlayerTrack } from '../player';
	import type { OnPlay } from './catalog';
	let { tracks, onplay }: { tracks: PlayerTrack[]; onplay: OnPlay } = $props();
	function length(seconds: number) {
		return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
	}
</script>

<div data-part="track-list" class="tracks">
	{#each tracks as track, index (track.id)}
		<button onclick={() => onplay(tracks, index)} aria-label={'Play ' + track.title}>
			<span class="index">{index + 1}</span>
			<span class="name"><strong>{track.title}</strong><small>{track.artist}</small></span>
			{#if track.duration}<span class="length">{length(track.duration)}</span>{/if}
			<Play size={16} aria-hidden="true" />
		</button>
	{/each}
</div>

<style>
	.tracks button {
		display: flex;
		align-items: center;
		gap: var(--gap);
		width: 100%;
		text-align: start;
		min-height: 3.6rem;
		padding: 0.45rem 0;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--line);
		color: var(--text);
	}
	.index,
	.length,
	small {
		color: var(--muted);
		font-size: 0.86rem;
	}
	.index {
		min-width: 1.6rem;
		text-align: center;
	}
	.name {
		flex: 1;
		min-width: 0;
	}
	.name > * {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.length {
		font-variant-numeric: tabular-nums;
	}
</style>
