<script lang="ts">
	import { ChevronDown, ListMusic, Pause, Play } from '@lucide/svelte';
	import type { Section } from '../boards/layout';
	let {
		row,
		sections,
		queueOpen,
		track,
		playing,
		readOnly = false,
		onclose,
		onqueue,
		ontoggle
	}: {
		row: Section[];
		sections: Section[];
		queueOpen: boolean;
		track: boolean;
		playing: boolean;
		readOnly?: boolean;
		onclose: () => void;
		onqueue?: () => void;
		ontoggle: () => void;
	} = $props();
	const missingClose = $derived(
		!row.some((s) => s.id === 'player-close') &&
			(!track || queueOpen || !sections.some((s) => s.id === 'player-close' && !s.placement))
	);
	const queueExit = $derived(queueOpen && !row.some((s) => s.id === 'player-queue'));
	const missingPlay = $derived(
		track &&
			!queueOpen &&
			!sections.some(
				(s) => ['player-toggle', 'player-transport'].includes(s.id) && s.placement !== 'hidden'
			)
	);
</script>

{#if missingClose || queueExit || missingPlay}
	<div class="fallback" inert={readOnly}>
		{#if missingClose}<button
				class="icon-button player-control"
				aria-label="Close player"
				onclick={onclose}><ChevronDown /></button
			>{/if}
		{#if missingPlay}<button
				class="icon-button player-control"
				inert={readOnly}
				aria-label={playing ? 'Pause' : 'Play'}
				onclick={ontoggle}
				>{#if playing}<Pause />{:else}<Play />{/if}</button
			>{/if}
		{#if queueExit}<button
				class="icon-button player-control"
				inert={readOnly}
				aria-label="Hide play queue"
				aria-expanded={true}
				onclick={onqueue}><ListMusic /></button
			>{/if}
	</div>{/if}

<style>
	.fallback {
		display: flex;
		justify-content: flex-end;
		gap: 0.25rem;
		align-items: center;
		position: relative;
	}
	.fallback > button {
		width: 44px;
		height: 44px;
		flex: none;
	}
</style>
