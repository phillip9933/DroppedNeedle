<script lang="ts">
	import { availabilityLabels, type Availability } from '../offline/library';
	let {
		value,
		onchange,
		inline = false
	}: {
		value: Availability;
		onchange: (value: Availability) => void;
		inline?: boolean;
	} = $props();
</script>

<label class:inline
	>Availability
	<select
		aria-label="Availability"
		{value}
		onchange={(e) => onchange(e.currentTarget.value as Availability)}
	>
		{#each Object.entries(availabilityLabels) as [key, title] (key)}
			<option value={key}>{title}</option>
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
