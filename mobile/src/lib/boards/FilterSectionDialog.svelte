<script lang="ts">
	import { untrack } from 'svelte';
	import PlaylistDialog from '../catalog/PlaylistDialog.svelte';
	import { libraryFilter, sorts, type FilterSection, type LibraryFilter } from './filteredSections';
	let {
		initial,
		onclose,
		onsave,
		ondelete
	}: {
		initial: Partial<FilterSection>;
		onclose: () => void;
		onsave: (value: FilterSection) => void;
		ondelete?: () => void;
	} = $props();
	let name = $state(untrack(() => initial.name ?? ''));
	let config = $state<LibraryFilter>(untrack(() => libraryFilter(initial)));
	let formats = $state(untrack(() => config.formats.join(', '))),
		removing = $state(false),
		error = $state('');
	function save() {
		const title = name.trim();
		if (!title) {
			error = 'Give this section a name.';
			return;
		}
		const parts = [
			...new Set(
				formats
					.split(',')
					.map((i) => i.trim().toLowerCase())
					.filter(Boolean)
			)
		];
		const normalized = libraryFilter({ ...config, formats: parts });
		if (config.kind !== 'artists' && normalized.formats.length !== parts.length) {
			error = 'Enter audio formats separated by commas, such as flac, mp3.';
			return;
		}
		try {
			onsave({
				...normalized,
				id: initial.id ?? 'library-filter-' + crypto.randomUUID(),
				name: title
			});
		} catch {
			error = 'Could not save the filtered section on this device.';
		}
	}
</script>

<PlaylistDialog
	title={removing
		? 'Delete filtered section?'
		: initial.id
			? 'Edit filtered section'
			: 'New filtered section'}
	{onclose}
>
	{#if removing}
		<p>Remove “{initial.name}” from your Home and Library layouts on this device?</p>
		<div class="actions">
			<button class="secondary" onclick={() => (removing = false)}>Cancel</button><button
				class="primary"
				onclick={ondelete}>Delete section</button
			>
		</div>
	{:else}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				save();
			}}
		>
			<label
				>Section name<input
					required
					maxlength="64"
					placeholder="Five-star songs"
					bind:value={name}
				/></label
			>
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
			<label
				>Contains<input
					type="search"
					maxlength="150"
					placeholder="Any name"
					bind:value={config.query}
				/></label
			>
			<label class="check"
				><input type="checkbox" bind:checked={config.favorites} />Favorites only</label
			>
			{#if config.kind !== 'artists'}
				<label
					>Rating<select aria-label="Section rating" bind:value={config.rating}
						><option value={0}>Any rating</option>{#each [1, 2, 3, 4, 5] as n (n)}<option value={n}
								>{n} {n === 1 ? 'star' : 'stars'}</option
							>{/each}</select
					></label
				>
				{#if config.rating}<label
						>Rating range<select aria-label="Section rating range" bind:value={config.ratingMode}
							><option value="at_least">At least</option><option value="at_most">At most</option
							></select
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
					aria-label="Section sort"
					value={config.sort || sorts[config.kind][0][0]}
					onchange={(e) => (config.sort = e.currentTarget.value)}
					>{#each sorts[config.kind] as [key, label] (key)}<option value={key}>{label}</option
						>{/each}</select
				></label
			>
			{#if error}<p role="alert">{error}</p>{/if}
			<div class="actions">
				<button type="button" class="secondary" onclick={onclose}>Cancel</button><button
					class="primary"
					type="submit">{initial.id ? 'Apply filters' : 'Create section'}</button
				>
			</div>
			{#if ondelete}<button type="button" class="text-button" onclick={() => (removing = true)}
					>Delete saved section</button
				>{/if}
		</form>
	{/if}
</PlaylistDialog>

<style>
	form .check {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 44px;
	}
	form .check input {
		width: auto;
	}
</style>
