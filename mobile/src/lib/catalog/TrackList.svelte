<script lang="ts">
	import { trackChoice } from './librarySelection.svelte';
	import TrackActions from './TrackActions.svelte';
	import type { Session } from '../connection';
	import TrackRow, { trackDuration } from './TrackRow.svelte';
	import { Disc3, Play } from '@lucide/svelte';
	import { tr } from '../i18n';
	import type { PlayerTrack } from '../player';
	import type { DetailInventory } from './detailInventory.svelte';
	import type { OnPlay } from './catalog';
	let {
		session,
		tracks,
		onplay,
		device,
		positions,
		showDiscs = false,
		albumSheet = false
	}: {
		albumSheet?: boolean;
		showDiscs?: boolean;
		device?: DetailInventory;
		positions?: number[];
		session: Session;
		tracks: (PlayerTrack & { favorite?: boolean })[];
		onplay: OnPlay;
	} = $props();
	const discs = $derived.by(() => {
		const groups: ({ disc: number; tracks: PlayerTrack[]; duration?: number } | undefined)[] = [];
		if (!showDiscs) return groups;
		let current: (typeof groups)[number];
		tracks.forEach((track, i) => {
			const disc = track.discNumber || 1;
			if (!current || current.disc !== disc) {
				current = { disc, tracks: [], duration: 0 };
				groups[i] = current;
			}
			current.tracks.push(track);
			if (current.duration !== undefined)
				current.duration = track.duration ? current.duration + track.duration : undefined;
		});
		return groups;
	});
	const inventory = $derived(device?.inventory);
</script>

<div data-part="track-list" data-album-sheet={albumSheet || undefined}>
	{#each tracks as track, index (track.id)}
		{@const disc = discs[index]}
		{#if disc}<div class="disc" data-part="album-disc">
				<Disc3 size={18} /><span>{tr('Disc ' + disc.disc, 'ディスク ' + disc.disc)}</span>
				{#if disc.duration}<small>{trackDuration(disc.duration)}</small>{/if}
				<button
					aria-label={tr('Play disc ' + disc.disc, 'ディスク ' + disc.disc + 'を再生')}
					onclick={() => onplay(disc.tracks, 0)}><Play size={16} /></button
				>
			</div>{/if}
		<div class="row" class:album={albumSheet}>
			<TrackRow
				albumRow={albumSheet}
				choice={trackChoice(track)}
				title={track.title}
				artist={track.artist}
				duration={track.duration}
				position={positions?.[index] ?? index + 1}
				availability={inventory ? (inventory.byId.has(track.id) ? 'offline' : 'online') : undefined}
				onplay={() => onplay(tracks, index)}
			/><TrackActions
				{session}
				vertical={albumSheet}
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
	.disc {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-height: 44px;
		padding-inline: 0.55rem;
		background: color-mix(in srgb, var(--text) 7%, transparent);
		color: var(--text);
	}
	.disc span {
		flex: 1;
		font-weight: 600;
	}
	.disc small {
		color: var(--album-secondary, var(--muted));
		font-variant-numeric: tabular-nums;
	}
	.disc button {
		display: grid;
		place-items: center;
		min-width: 44px;
		min-height: 44px;
	}
	.album {
		gap: 0.12rem;
	}
	.album :global(.bare-dots) {
		flex: none;
		color: var(--text);
	}
</style>
