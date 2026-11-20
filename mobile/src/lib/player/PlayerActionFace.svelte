<script lang="ts">
	import { Play, Pause, CirclePause, SquarePause } from '@lucide/svelte';
	import type { Section } from '../boards/layout';
	import { explicitPlayerGlyph } from './glyphs';
	let {
		section,
		glyph,
		label,
		size = 24,
		defaultLabel = false,
		fill = false,
		playback
	}: {
		section?: Section;
		glyph: typeof Play;
		label: string;
		size?: number;
		defaultLabel?: boolean;
		fill?: boolean;
		playback?: 'play' | 'pause';
	} = $props();
	const icon = $derived(section?.icon ?? 'default');
	const displayLabel = $derived(section?.showLabel ?? (icon === 'none' || defaultLabel));
	const paired = $derived(icon === 'play' || icon === 'circle-play' || icon === 'square-play');
	const Glyph = $derived(
		icon === 'none'
			? null
			: icon === 'default'
				? glyph
				: playback === 'pause' && paired
					? icon === 'circle-play'
						? CirclePause
						: icon === 'square-play'
							? SquarePause
							: Pause
					: (explicitPlayerGlyph(icon) ?? glyph)
	);
	const Mark = $derived(playback === 'pause' ? Pause : Play);
</script>

{#if Glyph || displayLabel}<span class="face" data-player-icon={icon} data-playback={playback}>
		{#if Glyph}<span
				class="glyph"
				style:--glyph-size={(section?.iconSize ?? size) + 'px'}
				aria-hidden="true"
			>
				<Glyph size="100%" fill={fill ? 'currentColor' : 'none'} />
				{#if playback && icon !== 'default' && !paired}<span class="state"
						><Mark size="100%" fill="currentColor" /></span
					>{/if}
			</span>{/if}
		{#if displayLabel}<span class="caption">{label}</span>{/if}
	</span>{/if}

<style>
	.face {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3em;
		flex-wrap: wrap;
		max-width: 100%;
		min-width: 0;
		vertical-align: middle;
	}
	.glyph {
		display: inline-grid;
		position: relative;
		width: var(--glyph-size);
		max-width: 100%;
		aspect-ratio: 1;
		flex: 0 1 auto;
	}
	.glyph :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}
	.state {
		position: absolute;
		inset: auto -0.12em -0.12em auto;
		width: 48%;
		aspect-ratio: 1;
		padding: 0.05em;
		border-radius: 50%;
		background: var(--bg);
		color: var(--text);
	}
	.caption {
		min-width: 0;
		font-size: 0.88em;
		line-height: 1.15;
		overflow-wrap: anywhere;
	}
</style>
