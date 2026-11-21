<script lang="ts">
	import { Cast, ChevronDown, ListMusic, Settings2 } from '@lucide/svelte';
	import type { Section } from '../boards/layout';
	import { navigationFields, type NavigationId } from './layout';
	import Outputs from './Outputs.svelte';
	import PlayerActionFace from './PlayerActionFace.svelte';
	let {
		id,
		section,
		queueOpen = false,
		editing = false,
		disabled = false,
		onactivate
	}: {
		id: NavigationId;
		section?: Section;
		queueOpen?: boolean;
		editing?: boolean;
		disabled?: boolean;
		onactivate: (id: NavigationId) => void;
	} = $props();
	const label = $derived(navigationFields.find((field) => field.id === id)!.label);
	const accessible = $derived(
		id === 'player-queue' ? (queueOpen ? 'Hide play queue' : 'Show play queue') : label
	);
	const glyphs = {
		'player-close': ChevronDown,
		'player-settings': Settings2,
		'player-queue': ListMusic,
		'player-output': Cast
	};
</script>

<span
	class="navigation-action"
	class:captioned={section?.showLabel === true ||
		(section?.icon === 'none' && section?.showLabel !== false)}
	style:--action-size={Math.max(44, (section?.iconSize ?? 24) + 8) + 'px'}
>
	{#if id === 'player-menu'}{:else if id === 'player-output' && !editing}<Outputs
			compact
			{section}
		/>
	{:else}<button
			class="icon-button player-control"
			data-screen-link={id === 'player-settings' && !editing ? true : undefined}
			{disabled}
			aria-label={accessible}
			aria-expanded={id === 'player-queue' ? queueOpen : undefined}
			onclick={() => onactivate(id)}
		>
			<PlayerActionFace
				{section}
				glyph={glyphs[id]}
				size={id === 'player-settings' ? 20 : 24}
				{label}
			/>
		</button>{/if}
</span>

<style>
	.navigation-action {
		display: grid;
		align-items: center;
		justify-items: var(--cell-align, center);
		width: 100%;
		min-width: 0;
	}
	.navigation-action :global(button.icon-button) {
		display: grid;
		place-items: center;
		box-sizing: border-box;
		inline-size: min(100%, var(--action-size));
		block-size: auto;
		min-inline-size: 0;
		min-block-size: 0;
		aspect-ratio: 1;
		padding: 0;
		border-radius: 50%;
	}
	.navigation-action.captioned :global(button.icon-button) {
		inline-size: fit-content;
		max-inline-size: 100%;
		min-height: 44px;
		aspect-ratio: auto;
		border-radius: var(--radius);
		padding: 0.15rem 0.3rem;
	}
</style>
