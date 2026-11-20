<script lang="ts">
	import { sectionTitle, type Section } from '../boards/layout';
	import { explicitPlayerGlyph } from './glyphs';
	let {
		section,
		value,
		openLabel,
		onopen
	}: {
		section: Section;
		value: string;
		openLabel?: string;
		onopen?: (el: HTMLButtonElement) => void;
	} = $props();
	const Glyph = $derived(explicitPlayerGlyph(section.icon));
	const title = $derived(section.id === 'player-title');
	const iconOnly = $derived(!!Glyph && (section.showLabel === false || !value));
</script>

<svelte:element
	this={onopen ? 'button' : title ? 'h1' : iconOnly ? 'span' : 'p'}
	type={onopen ? 'button' : undefined}
	onclick={onopen ? (e: MouseEvent) => onopen?.(e.currentTarget as HTMLButtonElement) : undefined}
	class:credit-link={!!onopen}
	class="metadata"
	class:labeled={section.showLabel === true}
	data-label-position={section.labelPosition ?? 'below'}
	class:field-title={title}
	class:field-heading={section.id === 'player-heading'}
	class:field-artist={section.id === 'player-artist'}
	class:field-album={section.id === 'player-album'}
	class:field-text={section.id.startsWith('player-text')}
	class:with-icon={!!Glyph}
	class:icon-only={iconOnly}
	data-lines={section.maxLines || undefined}
	role={!onopen && iconOnly && !title ? 'img' : undefined}
	aria-label={onopen ? openLabel : iconOnly ? value || sectionTitle(section) : undefined}
>
	{#if section.showLabel === true}<span class="caption"
			>{section.labelName?.trim() || sectionTitle(section)}</span
		>{/if}<span class="value"
		>{#if Glyph}<span
				class="metadata-icon"
				data-player-icon={section.icon}
				aria-hidden="true"
				style:--metadata-icon-size={(section.iconSize ?? 20) + 'px'}><Glyph size="100%" /></span
			>{/if}
		{#if !iconOnly}<span class="lines">{value}</span>{/if}</span
	>
</svelte:element>

<style>
	.metadata {
		display: block;
		min-width: 0;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.credit-link {
		font: inherit;
		color: inherit;
		text-align: var(--cell-align, start);
		padding: 0;
		width: 100%;
		min-block-size: max(44px, calc(var(--reserved-lines, 0) * 1lh));
	}
	.credit-link:hover .lines,
	.credit-link:focus-visible .lines {
		text-decoration: underline;
	}
	.labeled {
		display: flex;
		flex-direction: column;
		align-items: var(--cell-justify, stretch);
	}
	.caption {
		font-size: 0.8rem;
		color: var(--muted);
		order: 1;
	}
	.labeled[data-label-position='above'] .caption {
		order: -1;
	}
	.value {
		display: block;
		min-width: 0;
		max-width: 100%;
	}
	.with-icon .value {
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
	.icon-only:not(.credit-link) {
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
