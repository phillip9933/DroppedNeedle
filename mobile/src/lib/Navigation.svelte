<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { Ellipsis, X, Settings2 } from '@lucide/svelte';
	import {
		destinations,
		interfacePreferences,
		type Destination,
		type BrowseDestination
	} from './appearance/interface';
	import type { Snippet } from 'svelte';
	let {
		current,
		offline,
		onnavigate,
		outputs
	}: {
		current: BrowseDestination;
		offline: boolean;
		onnavigate: (id: Destination) => void;
		outputs?: Snippet;
	} = $props();
	const available = $derived(destinations.filter((d) => d.id !== 'offline' || offline));
	const pinned = $derived(
		$interfacePreferences.tabs.flatMap((id) => available.filter((d) => d.id === id))
	);
	const hidden = $derived(
		available.filter((d) => d.id !== 'settings' && !pinned.some((p) => p.id === d.id))
	);
	let dialog = $state<HTMLDialogElement>();
	let more: HTMLButtonElement;
	let open = $state(false);
	async function show() {
		if (open) return;
		open = true;
		await tick();
		dialog?.showModal();
	}
	function close(restore = true) {
		dialog?.close();
		open = false;
		if (restore) more?.focus();
	}
	function select(id: Destination) {
		if (open) close(false);
		onnavigate(id);
	}
	$effect(() => {
		if (!open) return;
		function back(e: Event) {
			if (dialog?.querySelector('dialog[open]')) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			close();
		}
		window.addEventListener('dn-back', back, true);
		return () => window.removeEventListener('dn-back', back, true);
	});
	onDestroy(() => dialog?.close());
</script>

<nav aria-label="Music" class="navigation" data-part="bottom-bar">
	{#each pinned as item (item.id)}<button
			type="button"
			data-screen-link
			aria-current={current === item.id ? 'page' : undefined}
			onclick={() => select(item.id)}><item.icon size={20} /><span>{item.label}</span></button
		>{/each}
	<button
		type="button"
		aria-label="More navigation options"
		aria-haspopup="dialog"
		aria-expanded={open}
		class:active={!pinned.some((p) => p.id === current)}
		bind:this={more}
		onclick={show}><Ellipsis size={20} /><span>More</span></button
	>
</nav>
{#if open}<dialog
		bind:this={dialog}
		aria-label="More destinations"
		oncancel={(e) => {
			e.preventDefault();
			close();
		}}
	>
		<header>
			<h2>More</h2>
			<button class="icon-button" aria-label="Close menu" onclick={() => close()}
				><X size={18} /></button
			>
		</header>
		{#each hidden as item (item.id)}<button
				class="entry"
				data-screen-link
				aria-current={current === item.id ? 'page' : undefined}
				onclick={() => select(item.id)}><item.icon size={19} />{item.label}</button
			>{/each}
		<button class="entry" data-screen-link onclick={() => select('settings')}
			><Settings2 size={19} />Settings</button
		>
		{#if outputs}{@render outputs()}{/if}
	</dialog>{/if}

<style>
	.navigation {
		display: flex;
		align-items: stretch;
		justify-content: space-evenly;
		padding: 0.35rem;
		gap: 2px;
		border-top: 1px solid var(--line);
		background: var(--nav-fill, var(--bg));
	}
	nav button {
		flex: 1;
		min-width: 0;
		min-height: 50px;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 0.2rem;
		color: var(--muted);
		border-radius: calc(var(--radius) * 0.8);
	}
	nav span {
		font-size: clamp(0.65rem, 2.6vw, 0.78rem);
		font-weight: 600;
		line-height: 1.1;
	}
	nav [aria-current='page'],
	nav .active {
		color: var(--dn-action-content);
		background: var(--dn-action);
		box-shadow: inset 0 0 0 1px var(--dn-action-edge);
	}
	:global(html[data-navigation='floating']) nav {
		margin: 0.28rem max(0.55rem, env(safe-area-inset-right)) 0.48rem;
		border: 1px solid var(--dn-edge);
		border-radius: calc(var(--radius) + 10px);
		box-shadow: 0 4px 14px #0003;
	}
	:global(html[data-navigation='floating']) nav button {
		border-radius: calc(var(--radius) + 5px);
	}
	:global(html[data-material='glass']) nav,
	:global(html[data-material='glass']) dialog {
		background: var(--glass-panel);
		backdrop-filter: blur(var(--glass-blur));
	}
	:global(html[data-material='simple']) nav [aria-current='page'],
	:global(html[data-material='simple']) nav .active {
		background: transparent;
		box-shadow: none;
		color: var(--accent);
	}
	dialog {
		position: fixed;
		inset: auto 0 0;
		width: min(100%, 32rem);
		margin: 0 auto;
		max-height: 78dvh;
		overflow: auto;
		padding: 0.6rem var(--gap) max(var(--gap), env(safe-area-inset-bottom));
		border: 1px solid var(--dn-edge);
		border-bottom: none;
		border-radius: calc(var(--radius) + 8px) calc(var(--radius) + 8px) 0 0;
		color: var(--text);
		background: var(--surface);
	}
	dialog::backdrop {
		background: rgb(0 0 0/0.5);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0.4rem 0;
		color: var(--heading);
	}
	.entry {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		min-height: 50px;
		text-align: left;
		border-bottom: 1px solid var(--line);
		font-weight: 600;
	}
	.entry[aria-current='page'] {
		color: var(--accent);
	}
</style>
