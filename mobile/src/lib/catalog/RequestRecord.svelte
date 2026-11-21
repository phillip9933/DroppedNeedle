<script lang="ts">
	import { ChevronRight, EllipsisVertical } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import type { Session } from '../connection';
	import Cover from './Cover.svelte';
	import RequestStatus from './RequestStatus.svelte';

	let {
		session,
		title,
		artist,
		kind,
		art,
		state,
		label,
		onopen,
		openLabel,
		onactions,
		download,
		children
	}: {
		session: Session;
		title: string;
		artist: string;
		kind: string;
		art?: string;
		state: string;
		label: string;
		onopen?: () => void;
		openLabel?: string;
		onactions?: () => void;
		download?: boolean;
		children?: Snippet;
	} = $props();
</script>

{#snippet identity()}
	<span class="art"><Cover {session} path={art} seed={art || title} /></span>
	<span class="identity">
		<strong>{title}</strong>
		<span class="byline">{artist}{artist ? ' · ' : ''}{kind === 'track' ? 'Track' : 'Album'}</span>
		<span class="state"><RequestStatus {state} {label} /></span>
	</span>
{/snippet}

<li class="record" data-part={download ? 'download-task' : undefined}>
	<div class="record-head">
		{#if onopen}
			<button class="main" aria-label={openLabel ?? title + ', ' + label} onclick={onopen}>
				{@render identity()}
				{#if !onactions}<ChevronRight size={18} aria-hidden="true" />{/if}
			</button>
		{:else}
			<div class="main">{@render identity()}</div>
		{/if}
		{#if onactions}
			<button class="overflow" aria-label={'Actions for ' + title} onclick={onactions}>
				<EllipsisVertical size={20} aria-hidden="true" />
			</button>
		{/if}
	</div>
	{#if children}<div class="details">{@render children()}</div>{/if}
</li>

<style>
	.record {
		--thumb: clamp(36px, 12vw, 44px);
		--gutter: 0.65rem;
		min-width: 0;
		padding-block: 0.65rem;
		border-block-end: 1px solid var(--line);
		overflow-wrap: anywhere;
	}
	.record-head,
	.main {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.main {
		text-align: start;
		gap: var(--gutter);
		flex: 1;
		min-height: 44px;
	}
	.art {
		width: var(--thumb);
		flex: none;
	}
	.identity {
		display: grid;
		flex: 1;
		min-width: 0;
		line-height: 1.35;
		gap: 0.1rem;
	}
	.identity strong {
		font-weight: 620;
	}
	.byline,
	.details,
	.main > :global(svg),
	.overflow {
		color: var(--muted);
	}
	.byline,
	.details {
		font-size: 0.85rem;
	}
	.state {
		display: flex;
		margin-top: 0.15rem;
	}
	.overflow {
		display: grid;
		place-items: center;
		min-width: 44px;
		min-height: 44px;
	}
	.details {
		margin-inline-start: calc(var(--thumb) + var(--gutter));
		line-height: 1.4;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.3rem;
	}
	.details:not(:empty) {
		margin-top: 0.35rem;
	}
</style>
