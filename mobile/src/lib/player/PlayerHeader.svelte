<script lang="ts">
	import { Ellipsis, ListMusic, Pause, Play } from '@lucide/svelte';
	import type { Section } from '../boards/layout';
	let {
		row,
		sections,
		queueOpen,
		track,
		playing,
		onclose,
		onqueue,
		onsettings,
		ontoggle
	}: {
		row: Section[];
		sections: Section[];
		queueOpen: boolean;
		track: boolean;
		playing: boolean;
		onclose: () => void;
		onqueue?: () => void;
		onsettings?: () => void;
		ontoggle: () => void;
	} = $props();
	let menu = $state(false),
		trigger = $state<HTMLButtonElement>();
	const missingClose = $derived(!row.some((s) => s.id === 'player-close'));
	const queueExit = $derived(queueOpen && !row.some((s) => s.id === 'player-queue'));
	const missingPlay = $derived(
		track &&
			!queueOpen &&
			!sections.some(
				(s) => ['player-toggle', 'player-transport'].includes(s.id) && s.placement !== 'hidden'
			)
	);
	function dismiss() {
		menu = false;
		trigger?.focus({ preventScroll: true });
	}
	$effect(() => {
		if (!menu) return;
		function back(e: Event) {
			e.preventDefault();
			dismiss();
		}
		window.addEventListener('dn-back', back);
		return () => window.removeEventListener('dn-back', back);
	});
</script>

{#if missingClose || queueExit || missingPlay}
	<div class="fallback">
		{#if missingClose}<button
				class="icon-button"
				bind:this={trigger}
				aria-label="Player menu"
				aria-expanded={menu}
				onclick={() => (menu = !menu)}><Ellipsis /></button
			>{/if}
		{#if missingPlay}<button
				class="icon-button"
				aria-label={playing ? 'Pause' : 'Play'}
				onclick={ontoggle}
				>{#if playing}<Pause />{:else}<Play />{/if}</button
			>{/if}
		{#if queueExit}<button class="icon-button" aria-label="Hide play queue" onclick={onqueue}
				><ListMusic /></button
			>{/if}
		{#if menu}<div class="menu" role="group" aria-label="Player navigation">
				<button
					onclick={() => {
						dismiss();
						onclose();
					}}>Close player</button
				>
				{#if onsettings}<button
						onclick={() => {
							dismiss();
							onsettings();
						}}>Player settings</button
					>{/if}
				{#if track}<button
						onclick={() => {
							dismiss();
							onqueue?.();
						}}>{queueOpen ? 'Hide play queue' : 'Show play queue'}</button
					>{/if}
			</div>{/if}
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
	.menu {
		position: absolute;
		top: 100%;
		inset-inline-end: 0;
		z-index: 2;
		display: grid;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.3rem;
		box-shadow: 0 0.3rem 1rem #0004;
	}
	.menu button {
		min-height: 44px;
		padding-inline: 0.8rem;
		text-align: start;
		white-space: nowrap;
	}
</style>
