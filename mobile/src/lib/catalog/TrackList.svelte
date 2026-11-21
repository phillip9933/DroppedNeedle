<script lang="ts">
	import { trackChoice } from './librarySelection.svelte';
	import TrackActions from './TrackActions.svelte';
	import type { Session } from '../connection';
	import TrackRow from './TrackRow.svelte';
	import type { PlayerTrack } from '../player';
	import type { DetailInventory } from './detailInventory.svelte';
	import type { OnPlay } from './catalog';
	let {
		session,
		tracks,
		onplay,
		device,
		positions,
		albumSheet = false
	}: {
		albumSheet?: boolean;
		device?: DetailInventory;
		positions?: number[];
		session: Session;
		tracks: (PlayerTrack & { favorite?: boolean })[];
		onplay: OnPlay;
	} = $props();
	const inventory = $derived(device?.inventory);
</script>

<div data-part="track-list" data-album-sheet={albumSheet || undefined}>
	{#each tracks as track, index (track.id)}
		<div class="row">
			<TrackRow
				choice={trackChoice(track)}
				title={track.title}
				artist={track.artist}
				duration={track.duration}
				position={positions?.[index] ?? index + 1}
				availability={inventory ? (inventory.byId.has(track.id) ? 'offline' : 'online') : undefined}
				onplay={() => onplay(tracks, index)}
			/><TrackActions
				{session}
				tracks={[track]}
				label={'More options for ' + track.title}
				deviceAvailable={device ? !!inventory?.byId.has(track.id) : undefined}
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
