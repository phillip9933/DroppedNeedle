<script lang="ts">
	import { trackChoice } from './librarySelection.svelte';
	import TrackActions from './TrackActions.svelte';
	import type { Session } from '../connection';
	import TrackRow from './TrackRow.svelte';
	import type { PlayerTrack } from '../player';
	import type { OnPlay } from './catalog';
	let {
		session,
		tracks,
		onplay,
		albumSheet = false
	}: {
		albumSheet?: boolean;
		session: Session;
		tracks: (PlayerTrack & { favorite?: boolean })[];
		onplay: OnPlay;
	} = $props();
</script>

<div data-part="track-list" data-album-sheet={albumSheet || undefined}>
	{#each tracks as track, index (track.id)}
		<div class="row">
			<TrackRow
				choice={trackChoice(track)}
				title={track.title}
				artist={track.artist}
				duration={track.duration}
				position={index + 1}
				onplay={() => onplay(tracks, index)}
			/><TrackActions
				{session}
				tracks={[track]}
				label={'More options for ' + track.title}
				favorite={track.favorite}
			/>
		</div>
	{/each}
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.row :global(button:first-child) {
		min-width: 0;
	}
</style>
