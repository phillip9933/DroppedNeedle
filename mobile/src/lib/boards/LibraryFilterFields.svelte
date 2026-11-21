<script lang="ts">
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
		>Library collection<InlineChoice selected={config.kind} label="Library collection"
			><select
				bind:value={config.kind}
				onchange={() => {
					config.sort = '';
				}}
				><option value="songs">Songs</option><option value="albums">Albums</option><option
					value="artists">Artists</option
				></select
			></InlineChoice
		></label
	>
{/if}
<label
	>Contains<input
		type="search"
		maxlength="150"
		placeholder="Any name"
		bind:value={config.query}
	/></label
>
<label class="check"><input type="checkbox" bind:checked={config.favorites} />Favorites only</label>
{#if config.kind !== 'artists'}
	<label
		>Rating<InlineChoice selected={config.rating} label={prefix + ' rating'}
			><select bind:value={config.rating}
				><option value={0}>Any rating</option>{#each [1, 2, 3, 4, 5] as n (n)}<option value={n}
						>{n} {n === 1 ? 'star' : 'stars'}</option
					>{/each}</select
			></InlineChoice
		></label
	>
	{#if config.rating}<label
			>Rating range<InlineChoice selected={config.ratingMode} label={prefix + ' rating range'}
				><select bind:value={config.ratingMode}
					><option value="at_least">At least</option><option value="at_most">At most</option
					></select
				></InlineChoice
			></label
		>{/if}
	<label>Audio formats<input placeholder="flac, mp3" bind:value={formats} /></label>
	{#if formats.trim()}<label
			>Selected formats<InlineChoice selected={config.formatMode}
				><select bind:value={config.formatMode}
					><option value="with">Include</option><option value="without">Exclude</option></select
				></InlineChoice
			></label
		>{/if}
{/if}
<label
	>Sort by<InlineChoice selected={config.sort || sorts[config.kind][0][0]} label={prefix + ' sort'}
		><select
			value={config.sort || sorts[config.kind][0][0]}
			onchange={(e) => (config.sort = e.currentTarget.value)}
			>{#each sorts[config.kind] as [key, label] (key)}<option value={key}>{label}</option
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
