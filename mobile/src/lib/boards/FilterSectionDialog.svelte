<script lang="ts">
	import { untrack } from 'svelte';
	import PlaylistDialog from '../catalog/PlaylistDialog.svelte';
	import LibraryFilterFields from './LibraryFilterFields.svelte';
	import {
		libraryFilter,
		filterFromFields,
		type FilterSection,
		type LibraryFilter
	} from './filteredSections';
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
		try {
			const normalized = filterFromFields(config, formats);
			onsave({
				...normalized,
				id: initial.id ?? 'library-filter-' + crypto.randomUUID(),
				name: title
			});
		} catch (cause) {
			error =
				cause instanceof Error
					? cause.message
					: 'Could not save the filtered section on this device.';
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
			<LibraryFilterFields bind:config bind:formats />
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
