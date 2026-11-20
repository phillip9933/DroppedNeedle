<script lang="ts">
	import { availabilityLabels, type Availability } from '../offline/library';
	let {
		value,
		onchange,
		inline = false,
		label = 'Availability',
		deviceOnly = false
	}: {
		value: Availability;
		onchange: (value: Availability) => void;
		inline?: boolean;
		label?: string;
		deviceOnly?: boolean;
	} = $props();
</script>

<label class:inline
	>{label}
	<select
		aria-label={label}
		{value}
		onchange={(e) => onchange(e.currentTarget.value as Availability)}
	>
		{#each Object.entries(availabilityLabels) as [key, title] (key)}
			{#if !deviceOnly || key !== 'all'}<option value={key}>{title}</option>{/if}
		{/each}
	</select>
</label>

<style>
	label {
		display: grid;
		gap: 0.15rem;
		font-size: 0.87rem;
	}
	select {
		min-width: 0;
		width: 100%;
	}
	.inline {
		grid-template-columns: 1fr minmax(0, auto);
		align-items: center;
		gap: var(--gap);
	}
</style>
