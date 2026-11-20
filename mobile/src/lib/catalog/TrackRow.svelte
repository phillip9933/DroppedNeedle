<script lang="ts">
	import { Play } from '@lucide/svelte';
	let {
		title,
		artist,
		position,
		duration,
		onplay
	}: {
		title: string;
		artist: string;
		position: number;
		duration?: number | null;
		onplay?: () => void;
	} = $props();
	function length(seconds: number) {
		return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
	}
</script>

<button
	disabled={!onplay}
	onclick={onplay}
	aria-label={onplay ? 'Play ' + title : title + ', unavailable in your library'}
>
	<span class="index">{position}</span>
	<span class="name"
		><strong>{title}</strong><small
			>{artist}{#if !onplay}
				· Unavailable in library{/if}</small
		></span
	>
	{#if duration}<span class="length">{length(duration)}</span>{/if}
	{#if onplay}<Play size={16} aria-hidden="true" />{/if}
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
	.length {
		font-variant-numeric: tabular-nums;
	}
</style>
