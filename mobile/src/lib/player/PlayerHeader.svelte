<script lang="ts">
	import Outputs from './Outputs.svelte';
	import { Cast, ChevronDown, ListMusic, Settings2, Ellipsis, Pause, Play } from '@lucide/svelte';
	import type { Section } from '../boards/layout';
	import { navigationFields, navigationPlacement, type NavigationId } from './layout';
	let {
		sections,
		title,
		playing,
		queueOpen,
		onclose,
		onqueue,
		onsettings,
		ontoggle,
		onselect
	}: {
		sections: Section[];
		title: string;
		playing: boolean;
		queueOpen: boolean;
		onclose: () => void;
		onqueue?: () => void;
		onsettings?: () => void;
		ontoggle: () => void;
		onselect?: (id: NavigationId) => void;
	} = $props();
	let menu = $state(false);
	$effect(() => {
		if (!menu) return;
		function dismiss(e: Event) {
			e.preventDefault();
			menu = false;
		}
		window.addEventListener('dn-back', dismiss);
		return () => window.removeEventListener('dn-back', dismiss);
	});
	function activate(id: NavigationId) {
		menu = false;
		if (onselect) {
			onselect(id);
			return;
		}
		if (id === 'player-close') onclose();
		else if (id === 'player-settings') onsettings?.();
		else onqueue?.();
	}
	const actions = $derived(
		navigationFields.filter((a) => a.id !== 'player-settings' || onsettings || onselect)
	);
	const fallback = $derived(
		!actions.some(
			(a) => a.id === 'player-close' && navigationPlacement(a.id, sections).startsWith('header')
		)
	);
</script>

{#snippet action(id: NavigationId, label: string)}
	{#if id === 'player-output' && !onselect}<Outputs compact />{:else}
		<button
			class="icon-button"
			data-screen-link={!onselect ? true : undefined}
			aria-label={onselect
				? 'Customize ' + label
				: id === 'player-queue'
					? queueOpen
						? 'Hide play queue'
						: 'Show play queue'
					: label}
			onclick={() => activate(id)}
		>
			{#if id === 'player-close'}<ChevronDown />{:else if id === 'player-settings'}<Settings2
					size={20}
				/>{:else if id === 'player-output'}<Cast />{:else}<ListMusic />{/if}</button
		>
	{/if}
{/snippet}
<header class="player-header">
	<div class="actions">
		{#each actions.filter((a) => navigationPlacement(a.id, sections) === 'header-start') as a (a.id)}{@render action(
				a.id,
				a.label
			)}{/each}
		{#if fallback}<button
				class="icon-button"
				aria-label="Player menu"
				aria-expanded={menu}
				onclick={() => (menu = !menu)}><Ellipsis /></button
			>{/if}
	</div>
	<strong
		>{queueOpen || sections.some((s) => ['player-track', 'player-title'].includes(s.id))
			? 'Now playing'
			: title}</strong
	>
	<div class="actions">
		{#if !queueOpen && !sections.some( (s) => ['player-transport', 'player-toggle'].includes(s.id) )}<button
				class="icon-button"
				aria-label={playing ? 'Pause' : 'Play'}
				onclick={ontoggle}
				>{#if playing}<Pause />{:else}<Play />{/if}</button
			>{/if}
		{#each actions.filter((a) => navigationPlacement(a.id, sections) === 'header-end') as a (a.id)}{@render action(
				a.id,
				a.label
			)}{/each}
	</div>
	{#if menu}<div class="menu" role="group" aria-label="Player navigation">
			<button onclick={() => activate('player-close')}>Close player</button
			>{#if onsettings || onselect}<button onclick={() => activate('player-settings')}
					>Player settings</button
				>{/if}<button onclick={() => activate('player-queue')}
				>{queueOpen ? 'Hide play queue' : 'Show play queue'}</button
			>
		</div>{/if}
	{#if queueOpen && !navigationPlacement('player-queue', sections).startsWith('header')}<button
			class="icon-button"
			aria-label="Hide play queue"
			onclick={onqueue}><ListMusic /></button
		>{/if}
</header>

<style>
	.player-header {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 3.8rem;
		background: var(--bg);
		gap: 0.2rem;
	}
	.actions {
		display: flex;
		align-items: center;
	}
	.player-header strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.87rem;
		letter-spacing: 0.03em;
	}
	.menu {
		position: absolute;
		top: 100%;
		inset-inline-start: 0;
		z-index: 2;
		display: grid;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.3rem;
		box-shadow: 0 0.3rem 1rem #0004;
	}
	.menu button {
		min-height: 44px;
		padding-inline: 0.8rem;
		text-align: start;
	}
</style>
