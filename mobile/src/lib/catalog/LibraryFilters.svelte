<script lang="ts">
	import { getJson, type Session } from '../connection';
	import { errorMessage, path } from './catalog';
	import type { Category, BrowseFilters } from './libraryBrowse';
	import type { Availability } from '../offline/library';
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

<div class="filters" role="group" aria-label="Collection filters">
	<label
		>Availability<select
			aria-label="Availability"
			value={availability}
			onchange={(e) => chooseAvailability(e.currentTarget.value as Availability)}
		>
			<option value="all">All library music</option><option value="offline"
				>Available offline</option
			><option value="downloaded">Downloaded</option><option value="automatic"
				>Automatically saved</option
			><option value="cached">Playback cache</option>
		</select></label
	>
	{#if category === 'Tracks' || category === 'Albums' || category === 'Artists'}<button
			class="secondary"
			aria-pressed={filters.favorites}
			onclick={() => change({ favorites: !filters.favorites })}>Favorites only</button
		>{/if}
	{#if category === 'Tracks' || category === 'Albums'}
		<details
			ontoggle={(e) => {
				if (e.currentTarget.open) attempt++;
			}}
		>
			<summary>Rating and format</summary>
			<div class="fields">
				<label
					>Your rating<select
						value={filters.rating}
						onchange={(e) => change({ rating: Number(e.currentTarget.value) })}
						><option value="0">Any rating</option>{#each [1, 2, 3, 4, 5] as r (r)}<option value={r}
								>{r} {r === 1 ? 'star' : 'stars'}</option
							>{/each}</select
					></label
				>
				<label
					>Rating range<select
						value={filters.ratingMode}
						onchange={(e) =>
							change({ ratingMode: e.currentTarget.value as BrowseFilters['ratingMode'] })}
						><option value="at_least">At least</option><option value="at_most">At most</option
						></select
					></label
				>
				{#if error}<p role="alert">{error}</p>
					<button class="secondary" onclick={() => attempt++}>Retry formats</button>
				{:else if opening}<small>Loading formats…</small
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
					>Selected formats<select
						value={filters.formatMode}
						onchange={(e) =>
							change({ formatMode: e.currentTarget.value as BrowseFilters['formatMode'] })}
						><option value="with">With</option><option value="without">Without</option></select
					></label
				>
				<button
					class="text-button"
					onclick={() =>
						change({ rating: 0, ratingMode: 'at_least', formats: [], formatMode: 'with' })}
					>Clear rating and format</button
				>
			</div>
		</details>
	{/if}
	{#if onsave}<button class="text-button" onclick={onsave}>Save filters as section</button>{/if}
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
