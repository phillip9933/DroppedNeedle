<script lang="ts">
	import { Browser } from '@capacitor/browser';
	import { ExternalLink } from '@lucide/svelte';
	import type { Session } from '../connection';
	let { session, route, label }: { session: Session; route: string; label: string } = $props();
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
	class="text-button"
	href={session.serverUrl + route}
	target="_blank"
	rel="noopener noreferrer"
	onclick={open}>{label}<ExternalLink size={15} /></a
>
{#if error}<p role="alert">{error}</p>{/if}

<style>
	a {
		margin-block: 0.5rem;
		text-decoration: none;
	}
</style>
