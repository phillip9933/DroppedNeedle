<script lang="ts">
	import { uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { getJson, type Session } from '../connection';
	import { errorMessage, path } from './catalog';
	import type { Category, BrowseFilters } from './libraryBrowse';
	import type { Availability } from '../offline/library';
	import LibraryAvailability from './LibraryAvailability.svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	type S = components['schemas'];
	let {
		session,
		category,
		filters,
		change,
		availability,
		chooseAvailability,
		local = false,
		localFormats = [],
		onsave
	}: {
		session: Session;
		category: Category;
		filters: BrowseFilters;
		change: (f: Partial<BrowseFilters>) => void;
		availability: Availability;
		chooseAvailability: (a: Availability) => void;
		local?: boolean;
		localFormats?: string[];
		onsave?: () => void;
	} = $props();
	let options = $state<string[]>([]),
		error = $state(''),
		attempt = $state(0),
		opening = $state(false);
	$effect(() => {
		const n = attempt,
			offline = local,
			known = localFormats,
			kind = category,
			account = session;
		if (!n || !['Albums', 'Tracks'].includes(kind)) return;
		let active = true;
		const controller = new AbortController();
		error = '';
		opening = true;
		const read = offline
			? Promise.resolve(known)
			: kind === 'Albums'
				? getJson<S['AlbumFormatCounts']>(
						account,
						path('/api/v3/library/albums/formats'),
						controller.signal
					).then((r) => r.items.map((i) => i.format))
				: getJson<S['StatsView']>(account, path('/api/v3/library/stats'), controller.signal).then(
						(r) => Object.keys(r.format_breakdown)
					);
		void read
			.then(
				(r) => {
					if (active) options = [...r].sort();
				},
				(e) => {
					if (active) error = errorMessage(e);
				}
			)
			.finally(() => {
				if (active) opening = false;
			});
		return () => {
			active = false;
			controller.abort();
		};
	});
</script>

<div class="filters" role="group" aria-label={uiText('Collection filters')}>
	<LibraryAvailability value={availability} onchange={chooseAvailability} />
	{#if category === 'Tracks' || category === 'Albums' || category === 'Artists'}<button
			class="secondary"
			aria-pressed={filters.favorites}
			onclick={() => change({ favorites: !filters.favorites })}>{uiText('Favorites only')}</button
		>{/if}
	{#if category === 'Tracks' || category === 'Albums'}
		<details
			ontoggle={(e) => {
				if (e.currentTarget.open) attempt++;
			}}
		>
			<summary>{uiText('Rating and format')}</summary>
			<div class="fields">
				<label
					>{uiText('Your rating')}<InlineChoice selected={filters.rating}
						><select
							value={filters.rating}
							onchange={(e) => change({ rating: Number(e.currentTarget.value) })}
							><option value="0">{uiText('Any rating')}</option
							>{#each [1, 2, 3, 4, 5] as r (r)}<option value={r}
									>{r} {r === 1 ? uiText('star') : uiText('stars')}</option
								>{/each}</select
						></InlineChoice
					></label
				>
				<label
					>{uiText('Rating range')}<InlineChoice selected={filters.ratingMode}
						><select
							value={filters.ratingMode}
							onchange={(e) =>
								change({ ratingMode: e.currentTarget.value as BrowseFilters['ratingMode'] })}
							><option value="at_least">{uiText('At least')}</option><option value="at_most"
								>{uiText('At most')}</option
							></select
						></InlineChoice
					></label
				>
				{#if error}<p role="alert">{error}</p>
					<button class="secondary" onclick={() => attempt++}>{uiText('Retry formats')}</button>
				{:else if opening}<small>{uiText('Loading formats…')}</small
					>{:else}{#each options as format (format)}<label class="check"
							><input
								type="checkbox"
								checked={filters.formats.includes(format)}
								onchange={(e) =>
									change({
										formats: e.currentTarget.checked
											? [...filters.formats, format]
											: filters.formats.filter((x) => x !== format)
									})}
							/>{format.toUpperCase()}</label
						>{/each}{/if}
				<label
					>{uiText('Selected formats')}<InlineChoice selected={filters.formatMode}
						><select
							value={filters.formatMode}
							onchange={(e) =>
								change({ formatMode: e.currentTarget.value as BrowseFilters['formatMode'] })}
							><option value="with">{uiText('With')}</option><option value="without"
								>{uiText('Without')}</option
							></select
						></InlineChoice
					></label
				>
				<button
					class="text-button"
					onclick={() =>
						change({ rating: 0, ratingMode: 'at_least', formats: [], formatMode: 'with' })}
					>{uiText('Clear rating and format')}</button
				>
			</div>
		</details>
	{/if}
	{#if onsave}<button class="text-button" onclick={onsave}
			>{uiText('Save filters as section')}</button
		>{/if}
</div>

<style>
	.filters,
	.fields {
		display: grid;
		gap: 0.55rem;
	}
	.filters {
		padding: var(--gap);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}
	label {
		display: grid;
		gap: 0.15rem;
		font-size: 0.87rem;
	}
	select {
		min-width: 0;
		width: 100%;
	}
	summary {
		cursor: pointer;
		min-height: 44px;
		align-content: center;
		font-weight: 600;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 44px;
	}
</style>
