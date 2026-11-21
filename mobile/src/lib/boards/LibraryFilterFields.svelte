<script lang="ts">
	import { uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { sorts, type LibraryFilter } from './filteredSections';
	let {
		config = $bindable(),
		formats = $bindable(),
		selectKind = true,
		prefix = 'Section'
	}: {
		config: LibraryFilter;
		formats: string;
		selectKind?: boolean;
		prefix?: string;
	} = $props();
</script>

{#if selectKind}
	<label
		>{uiText('Library collection')}<InlineChoice
			selected={config.kind}
			label={uiText('Library collection')}
			><select
				bind:value={config.kind}
				onchange={() => {
					config.sort = '';
				}}
				><option value="songs">{uiText('Songs')}</option><option value="albums"
					>{uiText('Albums')}</option
				><option value="artists">{uiText('Artists')}</option></select
			></InlineChoice
		></label
	>
{/if}
<label
	>{uiText('Contains')}<input
		type="search"
		maxlength="150"
		placeholder={uiText('Any name')}
		bind:value={config.query}
	/></label
>
<label class="check"
	><input type="checkbox" bind:checked={config.favorites} />{uiText('Favorites only')}</label
>
{#if config.kind !== 'artists'}
	<label
		>{uiText('Rating')}<InlineChoice selected={config.rating} label={prefix + ' rating'}
			><select bind:value={config.rating}
				><option value={0}>{uiText('Any rating')}</option>{#each [1, 2, 3, 4, 5] as n (n)}<option
						value={n}>{n} {n === 1 ? uiText('star') : uiText('stars')}</option
					>{/each}</select
			></InlineChoice
		></label
	>
	{#if config.rating}<label
			>{uiText('Rating range')}<InlineChoice
				selected={config.ratingMode}
				label={prefix + ' rating range'}
				><select bind:value={config.ratingMode}
					><option value="at_least">{uiText('At least')}</option><option value="at_most"
						>{uiText('At most')}</option
					></select
				></InlineChoice
			></label
		>{/if}
	<label>{uiText('Audio formats')}<input placeholder="flac, mp3" bind:value={formats} /></label>
	{#if formats.trim()}<label
			>{uiText('Selected formats')}<InlineChoice selected={config.formatMode}
				><select bind:value={config.formatMode}
					><option value="with">{uiText('Include')}</option><option value="without"
						>{uiText('Exclude')}</option
					></select
				></InlineChoice
			></label
		>{/if}
{/if}
<label
	>{uiText('Sort by')}<InlineChoice
		selected={config.sort || sorts[config.kind][0][0]}
		label={prefix + ' sort'}
		><select
			value={config.sort || sorts[config.kind][0][0]}
			onchange={(e) => (config.sort = e.currentTarget.value)}
			>{#each sorts[config.kind] as [key, label] (key)}<option value={key}>{uiText(label)}</option
				>{/each}</select
		></InlineChoice
	></label
>

<style>
	.check {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 44px;
	}
	.check input {
		width: auto;
	}
</style>
