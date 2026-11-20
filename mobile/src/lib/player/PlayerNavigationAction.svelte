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
		header = false,
		onactivate
	}: {
		id: NavigationId;
		section?: Section;
		queueOpen?: boolean;
		editing?: boolean;
		header?: boolean;
		onactivate: (id: NavigationId) => void;
	} = $props();
	const label = $derived(navigationFields.find((field) => field.id === id)!.label);
	const accessible = $derived(
		editing
			? 'Customize ' + label
			: id === 'player-queue'
				? queueOpen
					? 'Hide play queue'
					: 'Show play queue'
				: label
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
	style:padding={header && section?.padding !== undefined ? section.padding + 'px' : undefined}
	style:align-self={header ? section?.vAlign : undefined}
>
	{#if id === 'player-output' && !editing}<Outputs compact {section} />
	{:else}<button
			class="icon-button"
			data-screen-link={!editing ? true : undefined}
			aria-label={accessible}
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
		display: inline-flex;
		min-width: 0;
		max-width: 100%;
		align-items: center;
		justify-content: center;
	}
	button {
		width: auto;
		max-width: 100%;
		min-width: min(44px, 100%);
		min-height: 44px;
		height: auto;
	}
</style>
