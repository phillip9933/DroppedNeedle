<script lang="ts">
	import type { Availability } from '../offline/library';
	import type { DetailInventory } from './detailInventory.svelte';
	import LibraryAvailability from './LibraryAvailability.svelte';
	let {
		source,
		available,
		total,
		unavailable = 0,
		deviceOnly = false,
		editing = false,
		value,
		onchange
	}: {
		source: DetailInventory;
		available: number;
		total?: number;
		unavailable?: number;
		deviceOnly?: boolean;
		editing?: boolean;
		value: Availability;
		onchange: (value: Availability) => void;
	} = $props();
</script>

<div class="device-tracks">
	<div aria-live="polite">
		{#if source.storageError}
			<span>Device availability could not be checked. {source.storageError}</span>
			<button class="text-button" onclick={source.retryStorage}>Retry device check</button>
		{:else if !source.inventory}<span>Checking device availability…</span>
		{:else if total === undefined || total < available}
			<span
				>{available.toLocaleString()}
				{available === 1 ? 'track' : 'tracks'} available on this device. Full library count unknown.</span
			>
		{:else}
			<span
				>{available.toLocaleString()} of {total.toLocaleString()} playable {total === 1
					? 'track'
					: 'tracks'} available on this device.</span
			>
		{/if}
		{#if unavailable}
			<span
				>{unavailable.toLocaleString()}
				{unavailable === 1 ? 'entry has' : 'entries have'} no playable file in DN.</span
			>
		{/if}
	</div>
	{#if editing}<span>Editing the full playlist order.</span>
	{:else}<LibraryAvailability
			inline
			{deviceOnly}
			label="Track availability"
			{value}
			{onchange}
		/>{/if}
</div>

<style>
	.device-tracks {
		display: grid;
		gap: 0.35rem;
		margin-block: 0.65rem;
		color: var(--muted);
		font-size: 0.86rem;
	}
	.device-tracks > div > span {
		display: block;
	}
</style>
