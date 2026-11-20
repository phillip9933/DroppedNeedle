<script lang="ts">
	import TrackRow from './TrackRow.svelte';
	import type { PlayerTrack } from '../player';
	import type { OnPlay } from './catalog';
	let { tracks, onplay }: { tracks: PlayerTrack[]; onplay: OnPlay } = $props();
</script>

<div data-part="track-list">
	{#each tracks as track, index (track.id)}
		<TrackRow
			title={track.title}
			artist={track.artist}
			duration={track.duration}
			position={index + 1}
			onplay={() => onplay(tracks, index)}
		/>
	{/each}
</div>
