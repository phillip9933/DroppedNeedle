<script lang="ts">
	import { sectionTitle, type Section } from '../boards/layout';
	import { explicitPlayerGlyph } from './glyphs';
	let { section, value }: { section: Section; value: string } = $props();
	const Glyph = $derived(explicitPlayerGlyph(section.icon));
	const title = $derived(section.id === 'player-title');
	const iconOnly = $derived(!!Glyph && (section.showLabel === false || !value));
</script>

<svelte:element
	this={title ? 'h1' : iconOnly ? 'span' : 'p'}
	class="metadata"
	class:field-title={title}
	class:field-heading={section.id === 'player-heading'}
	class:field-artist={section.id === 'player-artist'}
	class:field-album={section.id === 'player-album'}
	class:field-text={section.id.startsWith('player-text')}
	class:with-icon={!!Glyph}
	class:icon-only={iconOnly}
	data-lines={section.maxLines || undefined}
	role={iconOnly && !title ? 'img' : undefined}
	aria-label={iconOnly ? value || sectionTitle(section) : undefined}
>
	{#if Glyph}<span
			class="metadata-icon"
			data-player-icon={section.icon}
			aria-hidden="true"
			style:--metadata-icon-size={(section.iconSize ?? 20) + 'px'}><Glyph size="100%" /></span
		>{/if}
	{#if !iconOnly}<span class="lines">{value}</span>{/if}
</svelte:element>

<style>
	.metadata {
		display: block;
		min-width: 0;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.with-icon {
		display: flex;
		align-items: center;
		justify-content: var(--cell-justify, flex-start);
		gap: 0.35em;
	}
	.metadata-icon {
		display: inline-grid;
		width: var(--metadata-icon-size);
		max-width: 40%;
		flex: none;
		aspect-ratio: 1;
	}
	.metadata-icon :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}
	.icon-only {
		min-block-size: calc(var(--reserved-lines, 0) * 1lh);
	}
	.icon-only .metadata-icon {
		max-width: 100%;
	}
	.lines {
		display: block;
		min-width: 0;
		max-width: 100%;
		min-block-size: calc(var(--reserved-lines, 0) * 1lh);
	}
	.metadata[data-lines] .lines {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: var(--field-lines);
		line-clamp: var(--field-lines);
		overflow: hidden;
	}
	.field-heading {
		font-size: 0.87em;
		font-weight: 700;
		letter-spacing: 0.03em;
	}
	.field-title {
		font-size: calc(clamp(1.75rem, 7vw, 2.45rem) * var(--cell-scale));
	}
	.field-artist {
		font-size: 1.15em;
	}
	.field-album {
		color: var(--muted);
	}
	.field-text {
		white-space: pre-wrap;
	}
</style>
