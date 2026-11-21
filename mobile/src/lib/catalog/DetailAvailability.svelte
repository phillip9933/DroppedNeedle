<script lang="ts">
	import { uiText } from '../i18n';
	import type { Availability } from '../offline/library';
	import type { DetailInventory } from './detailInventory.svelte';
	import LibraryAvailability from './LibraryAvailability.svelte';
	let {
		source,
		available,
		total,
		observedAt,
		unavailable = 0,
		deviceOnly = false,
		editing = false,
		value,
		onchange
	}: {
		source: DetailInventory;
		available: number;
		total?: number;
		observedAt?: number;
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
			<span>{uiText('Device availability could not be checked.')} {source.storageError}</span>
			<button class="text-button" onclick={source.retryStorage}
				>{uiText('Retry device check')}</button
			>
		{:else if !source.inventory}<span>{uiText('Checking device availability…')}</span>
		{:else if total === undefined || total < available}
			<span
				>{available.toLocaleString()}
				{available === 1 ? uiText('track') : uiText('tracks')}
				{uiText('available on this device. Full library count unknown.')}</span
			>
		{:else if observedAt}
			<span
				>{available.toLocaleString()}
				{available === 1 ? uiText('track') : uiText('tracks')}
				{uiText('available on this device. DN last showed')}
				{total.toLocaleString()}
				{uiText('playable')}
				{total === 1 ? uiText('track') : uiText('tracks')}
				{uiText('on')}
				<time datetime={new Date(observedAt).toISOString()}
					>{new Date(observedAt).toLocaleDateString()}</time
				>.</span
			>
		{:else}
			<span
				>{available.toLocaleString()}
				{uiText('of')}
				{total.toLocaleString()}
				{uiText('playable')}
				{total === 1 ? uiText('track') : uiText('tracks')}
				{uiText('available on this device.')}</span
			>
		{/if}
		{#if unavailable}
			<span
				>{unavailable.toLocaleString()}
				{unavailable === 1 ? uiText('entry has') : uiText('entries have')}
				{uiText('no playable file in DN.')}</span
			>
		{/if}
	</div>
	{#if editing}<span>{uiText('Editing the full playlist order.')}</span>
	{:else}<LibraryAvailability
			inline
			{deviceOnly}
			label={uiText('Track availability')}
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
