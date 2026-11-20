<script lang="ts">
	import type { Snippet } from 'svelte';
	import Cover from '../catalog/Cover.svelte';
	import type { Session } from '../connection';

	let {
		session,
		title,
		subtitle,
		detail,
		time,
		artwork,
		coverSeed,
		onclick,
		label,
		part,
		disabled = false,
		actions
	}: {
		session: Session;
		title: string;
		subtitle?: string;
		detail?: string;
		time?: { value: string; label: string };
		artwork?: string;
		coverSeed?: string;
		onclick?: () => void;
		label?: string;
		part?: string;
		disabled?: boolean;
		actions?: Snippet;
	} = $props();
</script>

{#snippet content()}
	{#if coverSeed}<span class="art"><Cover {session} path={artwork} seed={coverSeed} /></span>{/if}
	<span class="text"
		><strong>{title}</strong>{#if subtitle}<small>{subtitle}</small>{/if}{#if time}<small
				><time datetime={time.value}>{time.label}</time></small
			>{/if}{#if detail}<small>{detail}</small>{/if}</span
	>
{/snippet}
<div class="item" class:actions={!!actions} data-preview-item>
	{#if onclick}<button class="body" data-part={part} aria-label={label} {onclick} {disabled}
			>{@render content()}</button
		>
	{:else}<div class="body" data-part={part}>{@render content()}</div>{/if}
	{#if actions}{@render actions()}{/if}
</div>

<style>
	.item {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-bottom: 1px solid var(--line);
	}
	.body {
		min-width: 0;
		width: 100%;
		min-height: var(--preview-height);
		padding: var(--preview-padding) 0;
		display: flex;
		align-items: center;
		gap: var(--preview-gap);
		text-align: start;
		color: var(--text);
	}
	.art {
		display: block;
		width: calc(var(--preview-art) * var(--preview-art-scale));
		flex-shrink: 0;
	}
	.text {
		display: grid;
		min-width: 0;
		line-height: 1.3;
		gap: 2px;
	}
	strong,
	small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global([data-collection='expanded']) small {
		white-space: normal;
		overflow-wrap: anywhere;
	}
	small {
		color: var(--muted);
	}
	:global([data-preview='grid']) .item {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		align-items: stretch;
		flex-direction: column;
		justify-content: flex-start;
	}
	:global([data-preview='grid']) .body {
		flex: 1;
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		padding: var(--preview-padding);
	}
	:global([data-preview='grid']) .art {
		width: 100%;
	}
	:global([data-preview='grid']) .text {
		padding: 2px;
	}
	:global([data-preview='grid']) .actions > :global(.icon-button) {
		align-self: flex-end;
	}
</style>
