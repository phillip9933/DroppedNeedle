<script lang="ts">
	import { Browser } from '@capacitor/browser';
	import { ExternalLink } from '@lucide/svelte';
	import type { Session } from '../connection';
	let {
		session,
		route,
		label,
		iconOnly = false
	}: { session: Session; route: string; label: string; iconOnly?: boolean } = $props();
	let error = $state('');
	async function open(event: MouseEvent) {
		event.preventDefault();
		error = '';
		try {
			await Browser.open({ url: session.serverUrl + route });
		} catch {
			error = 'Could not open the browser.';
		}
	}
</script>

<a
	class={iconOnly ? 'icon-button' : 'text-button'}
	aria-label={label}
	title={iconOnly ? label : undefined}
	href={session.serverUrl + route}
	target="_blank"
	rel="noopener noreferrer"
	onclick={open}
	>{#if !iconOnly}{label}{/if}<ExternalLink size={15} /></a
>
{#if error}<p role="alert">{error}</p>{/if}

<style>
	a.icon-button {
		margin: 0;
		display: inline-grid;
		place-items: center;
	}
	a {
		margin-block: 0.5rem;
		text-decoration: none;
	}
</style>
