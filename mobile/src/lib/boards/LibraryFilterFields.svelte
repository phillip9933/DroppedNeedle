<script lang="ts">
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
		>Library collection<select
			aria-label="Library collection"
			bind:value={config.kind}
			onchange={() => {
				config.sort = '';
			}}
			><option value="songs">Songs</option><option value="albums">Albums</option><option
				value="artists">Artists</option
			></select
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
		>Rating<select aria-label={prefix + ' rating'} bind:value={config.rating}
			><option value={0}>Any rating</option>{#each [1, 2, 3, 4, 5] as n (n)}<option value={n}
					>{n} {n === 1 ? 'star' : 'stars'}</option
				>{/each}</select
		></label
	>
	{#if config.rating}<label
			>Rating range<select aria-label={prefix + ' rating range'} bind:value={config.ratingMode}
				><option value="at_least">At least</option><option value="at_most">At most</option></select
			></label
		>{/if}
	<label>Audio formats<input placeholder="flac, mp3" bind:value={formats} /></label>
	{#if formats.trim()}<label
			>Selected formats<select bind:value={config.formatMode}
				><option value="with">Include</option><option value="without">Exclude</option></select
			></label
		>{/if}
{/if}
<label
	>Sort by<select
		aria-label={prefix + ' sort'}
		value={config.sort || sorts[config.kind][0][0]}
		onchange={(e) => (config.sort = e.currentTarget.value)}
		>{#each sorts[config.kind] as [key, label] (key)}<option value={key}>{label}</option
			>{/each}</select
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
