<script lang="ts">
	import { uiText } from '../i18n';

	import InlineChoice from '../controls/InlineChoice.svelte';
	import type { Availability } from '../offline/library';
	let {
		value,
		onchange,
		inline = false,
		label = 'Availability',
		allLabel = uiText('All library music'),
		deviceOnly = false
	}: {
		value: Availability;
		onchange: (value: Availability) => void;
		inline?: boolean;
		label?: string;
		allLabel?: string;
		deviceOnly?: boolean;
	} = $props();
</script>

{#if !deviceOnly}<label class:inline
		>{uiText(label)}
		<InlineChoice selected={value} label={uiText(label)}
			><select {value} onchange={(e) => onchange(e.currentTarget.value as Availability)}>
				<option value="all">{allLabel}</option>
				<option value="offline">{uiText('Available offline')}</option>
			</select></InlineChoice
		>
	</label>{/if}

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
