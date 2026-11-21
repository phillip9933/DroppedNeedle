<script lang="ts">
	import { uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import type { CollectionDisplay } from './browsePreferences';
	let {
		settings,
		onchange
	}: { settings: CollectionDisplay; onchange: (update: Partial<CollectionDisplay>) => void } =
		$props();
</script>

<label>
	{uiText('Display')}
	<InlineChoice selected={settings.layout}>
		<select
			value={settings.layout}
			onchange={(e) => onchange({ layout: e.currentTarget.value === 'list' ? 'list' : 'grid' })}
		>
			<option value="grid">{uiText('Grid')}</option>
			<option value="list">{uiText('List')}</option>
		</select>
	</InlineChoice>
</label>
{#if settings.layout === 'grid'}
	<label>
		{uiText('Grid columns')}
		<InlineChoice selected={settings.columns}>
			<select
				value={settings.columns}
				onchange={(e) => onchange({ columns: Number(e.currentTarget.value) })}
			>
				{#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={n}>{n}</option>{/each}
			</select>
		</InlineChoice>
	</label>
{/if}
<label class="compact">
	<input
		type="checkbox"
		checked={settings.compact}
		onchange={(e) => onchange({ compact: e.currentTarget.checked })}
	/>
	{uiText('Compact rows')}
</label>

<style>
	label {
		display: grid;
		min-width: 0;
		font-size: 0.9rem;
		gap: 0.25rem;
	}
	.compact {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 44px;
	}
</style>
