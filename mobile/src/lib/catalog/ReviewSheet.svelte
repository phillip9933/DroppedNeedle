<script lang="ts">
	import type { Snippet } from 'svelte';
	import PlayerSheet from '../player/PlayerSheet.svelte';
	let {
		title,
		context = '',
		backLabel,
		closeLabel,
		scrollKey,
		busy = false,
		onback,
		children
	}: {
		title: string;
		context?: string;
		backLabel?: string;
		closeLabel?: string;
		scrollKey?: string;
		busy?: boolean;
		onback: () => void;
		children: Snippet;
	} = $props();
</script>

<PlayerSheet
	{title}
	{context}
	{closeLabel}
	backLabel={backLabel ?? (closeLabel ? undefined : 'Back')}
	scrollKey={scrollKey ?? title}
	{busy}
	onclose={onback}
>
	<div class="review-content">{@render children()}</div>
</PlayerSheet>

<style>
	.review-content {
		display: grid;
		gap: 0.85rem;
		min-width: 0;
		padding-block-start: 0.5rem;
		overflow-wrap: anywhere;
	}
	.review-content > :global(*) {
		min-width: 0;
	}
	.review-content :global(.review-section) {
		display: grid;
		gap: 0.45rem;
		min-width: 0;
	}
	.review-content :global(.review-heading) {
		display: flex;
		align-items: center;
		gap: min(0.5rem, 2vw);
		margin: 0;
		color: var(--heading, var(--text));
		font-size: 1.12rem;
		line-height: 1.3;
		letter-spacing: -0.025em;
	}
	.review-content :global(.review-count) {
		margin-inline-start: auto;
		color: var(--muted);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}
	.review-content :global(.review-meta) {
		display: block;
		color: var(--muted);
		font-size: 0.87rem;
		line-height: 1.45;
		font-weight: 450;
	}
	.review-content :global(.review-files) {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.review-content :global(.review-files > li) {
		min-width: 0;
		padding-block: 0.5rem;
		border-block-start: 1px solid var(--line);
	}
	.review-content :global(.settings-entry strong) {
		display: block;
		font-weight: 600;
	}
	.review-content :global(.settings-disclosure) {
		min-width: 0;
	}
	.review-content :global(.settings-disclosure > summary::after) {
		flex-shrink: 0;
	}
	.review-content > :global(p) {
		margin: 0;
	}
</style>
