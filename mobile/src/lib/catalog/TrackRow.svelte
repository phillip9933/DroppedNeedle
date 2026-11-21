<script lang="ts" module>
	export function trackDuration(seconds: number) {
		return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
	}
</script>

<script lang="ts">
	import { uiText } from '../i18n';
	import { useLibrarySelection, type LibraryChoice } from './librarySelection.svelte';
	import { Play } from '@lucide/svelte';
	import { trackStatusLabels, trackStatusIcons, type TrackStatus } from './trackStatus';
	const statusId = $props.id();
	const selectable = useLibrarySelection();
	let {
		title,
		artist,
		position,
		albumRow = false,
		duration,
		onplay,
		availability,
		choice
	}: {
		title: string;
		artist: string;
		position: number;
		albumRow?: boolean;
		duration?: number | null;
		onplay?: () => void;
		choice?: LibraryChoice;
		availability?: TrackStatus;
	} = $props();
</script>

<button
	class:album-row={albumRow}
	use:selectable={choice}
	disabled={!onplay}
	onclick={onplay}
	aria-describedby={availability ? statusId : undefined}
	aria-label={onplay ? 'Play ' + title : title + ', unavailable in your library'}
>
	<span class="index">{position}</span>
	<span class="name"
		><strong>{title}</strong><small
			>{artist}{#if !onplay}
				{uiText('· Unavailable in library')}{/if}</small
		>
		{#if availability}{@const Icon = trackStatusIcons[availability]}<span
				class="availability"
				class:offline={availability === 'offline'}
				id={statusId}
				><Icon size={13} aria-hidden="true" /><span class:sr-only={albumRow}
					>{uiText(trackStatusLabels[availability])}</span
				></span
			>{/if}</span
	>
	{#if duration}<span class="length">{trackDuration(duration)}</span>{/if}
	{#if onplay && !albumRow}<Play size={16} aria-hidden="true" />{/if}
</button>

<style>
	button {
		display: flex;
		align-items: center;
		gap: var(--gap);
		width: 100%;
		text-align: start;
		min-height: 3.6rem;
		padding: 0.45rem 0;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--line);
		color: var(--text);
	}
	button:disabled {
		opacity: 1;
		color: var(--muted);
	}
	button:disabled .name small {
		white-space: normal;
	}
	.index,
	.length,
	small {
		color: var(--muted);
		font-size: 0.86rem;
	}
	.index {
		min-width: 1.6rem;
		text-align: center;
	}
	.name {
		flex: 1;
		min-width: 0;
	}
	.name > * {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name .availability {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		color: var(--muted);
		font-size: 0.76rem;
		line-height: 1.35;
	}
	.length {
		font-variant-numeric: tabular-nums;
	}
	.album-row {
		min-height: 48px;
		padding: 0.38rem 0;
		border: 0;
		gap: 0.5rem;
	}
	.album-row :is(.length, .index, small) {
		color: var(--album-secondary, var(--muted));
	}
	.album-row .name {
		overflow: hidden;
		position: relative;
	}
	.album-row .name strong {
		font-weight: 560;
	}
	.album-row .name .availability {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
	.album-row .name .availability:not(.offline) {
		clip-path: inset(50%);
	}
	.album-row .name .offline {
		position: static;
		width: auto;
		height: auto;
		display: inline-flex;
		vertical-align: middle;
		margin-left: 0.3rem;
	}
	.album-row .name small {
		display: inline-block;
		vertical-align: middle;
		max-width: 100%;
		line-height: 1.3;
	}
	.album-row .name:has(.offline) small {
		max-width: calc(100% - 1.2rem);
	}
</style>
