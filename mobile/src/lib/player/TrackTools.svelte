<script lang="ts">
	import { untrack } from 'svelte';
	import type { Section } from '../boards/layout';
	import PlayerActionFace from './PlayerActionFace.svelte';
	import { Star, Heart, ListPlus, Wrench } from '@lucide/svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, putJson, postJson, type Session } from '../connection';
	import { trackToolFields } from './layout';
	import type { PlayerTrack } from '../player';
	import { errorMessage, path } from '../catalog/catalog';
	import Favorite from '../catalog/Favorite.svelte';
	import AddToPlaylist from '../catalog/AddToPlaylist.svelte';

	type Model = components['schemas'];
	let {
		session,
		track,
		title,
		startOpen,
		sample = false,
		section,
		mode = 'tools',
		fields = trackToolFields.map((a) => a.id) as readonly string[]
	}: {
		session: Session;
		track: PlayerTrack;
		title: string;
		startOpen: boolean;
		sample?: boolean;
		section?: Section;
		mode?: 'tools' | 'field';
		fields?: readonly string[];
	} = $props();
	let open = $state(untrack(() => startOpen)),
		playlist = $state(false);
	let library = $state<Model['TrackView'] | null>(null),
		rating = $state<number | null>(null);
	let libraryError = $state(''),
		ratingError = $state(''),
		saving = $state(false),
		retry = $state(0);
	const trackId = $derived(track.id),
		trackTitle = $derived(track.title);
	const quality = $derived(
		library
			? [
					library.format?.toUpperCase(),
					library.bit_depth && library.bit_depth + '-bit',
					library.sample_rate && library.sample_rate / 1000 + ' kHz',
					library.bit_rate && library.bit_rate + ' kbps'
				]
					.filter(Boolean)
					.join(' · ')
			: ''
	);

	$effect(() => {
		if (!open || sample) return;
		const id = trackId,
			name = trackTitle,
			current = session;
		void retry;
		let live = true;
		libraryError = ratingError = '';
		rating = null;
		library = null;
		async function findTrack() {
			// The library exposes a paged search. Use the UUID to distinguish live versions and duplicate titles.
			let after: string | undefined;
			const cursors: string[] = [];
			do {
				const result = await getJson<Model['TrackListPage']>(
					current,
					path('/api/v3/library/tracks', {}, { q: name, limit: 100, after })
				);
				if (!live) return;
				const found = result.items.find((t) => t.id === id);
				if (found) {
					library = found;
					return;
				}
				after = result.next ?? undefined;
				if (!after || cursors.includes(after)) break;
				cursors.push(after);
			} while (live);
			if (live) libraryError = 'Library details are unavailable for this track.';
		}
		if (fields.includes('player-favorite') || fields.includes('player-quality'))
			void findTrack().catch((e) => {
				if (live) libraryError = errorMessage(e);
			});
		if (fields.includes('player-rating'))
			void postJson<Model['RatingLookupResponse']>(current, path('/api/v3/ratings/lookup'), {
				track_ids: [id]
			})
				.then((v) => {
					if (live) rating = v.tracks[id] ?? 0;
				})
				.catch((e) => {
					if (live) ratingError = errorMessage(e);
				});
		return () => {
			live = false;
		};
	});
	async function rate(value: number) {
		if (saving || rating === null) return;
		saving = true;
		ratingError = '';
		try {
			await putJson<Model['RatingStatusResponse']>(
				session,
				path('/api/v3/ratings/{kind}/{item_id}', { kind: 'track', item_id: track.id }),
				{ rating: value }
			);
			rating = value;
		} catch (e) {
			ratingError = errorMessage(e);
		} finally {
			saving = false;
		}
	}
</script>

{#snippet heart(active: boolean)}<PlayerActionFace
		section={mode === 'field' ? section : undefined}
		glyph={Heart}
		size={18}
		label={active ? 'Favorited' : 'Favorite'}
		fill={active}
	/>{/snippet}
{#snippet favorite()}{#if sample}<button
			class="icon-button custom-action"
			aria-label="Favorite track">{@render heart(false)}</button
		>
	{:else if library}<Favorite
			{session}
			kind="track"
			id={track.id}
			value={library.favorite}
			face={heart}
		/>
	{:else if !libraryError}<button
			class="icon-button custom-action"
			disabled
			aria-label="Loading favorite">{@render heart(false)}</button
		>{/if}{/snippet}
{#snippet addPlaylist()}<button
		class="secondary custom-action"
		aria-label="Add to playlist"
		onclick={() => {
			if (!sample) playlist = true;
		}}
	>
		<PlayerActionFace
			section={mode === 'field' ? section : undefined}
			glyph={ListPlus}
			size={17}
			label="Add to playlist"
			defaultLabel
		/>
	</button>{/snippet}
{#snippet contents()}
	{#if fields.includes('player-favorite') || fields.includes('player-playlist')}<div class="tools">
			{#if fields.includes('player-favorite')}{@render favorite()}{/if}{#if fields.includes('player-playlist')}{@render addPlaylist()}{/if}
		</div>{/if}
	{#if fields.includes('player-rating') && (rating !== null || sample)}<div
			class="stars"
			role="group"
			aria-label="Your track rating"
		>
			{#each [1, 2, 3, 4, 5] as value (value)}
				<button
					disabled={saving}
					aria-label={'Rate ' + value + (value === 1 ? ' star' : ' stars')}
					aria-pressed={rating === value}
					onclick={() => rate(value)}
					><PlayerActionFace
						section={mode === 'field' ? section : undefined}
						glyph={Star}
						size={20}
						label={String(value)}
						fill={(sample ? 3 : (rating ?? 0)) >= value}
					/></button
				>
			{/each}
			{#if (rating ?? 0) > 0}<button class="text-button" disabled={saving} onclick={() => rate(0)}
					>Clear rating</button
				>{/if}
		</div>{/if}
	{#if fields.includes('player-quality') && (quality || sample)}<p>
			{sample ? 'FLAC · 24-bit · 48 kHz' : quality}
		</p>{/if}
	{#if libraryError || ratingError}<p role="alert">
			{[libraryError, ratingError].filter(Boolean).join(' ')}
		</p>
		<button class="text-button" onclick={() => retry++}>Try again</button>{/if}{/snippet}
{#if mode === 'tools'}<details bind:open data-part="track-tools">
		<summary aria-label={title}
			>{#if (section?.icon && section.icon !== 'default') || section?.showLabel !== undefined || section?.iconSize}<PlayerActionFace
					{section}
					glyph={Wrench}
					size={18}
					label={title}
					defaultLabel
				/>{:else}{title}{/if}</summary
		>{#if open}{@render contents()}{/if}
	</details>{:else}{@render contents()}{/if}
{#if playlist}<AddToPlaylist {session} tracks={[track]} onclose={() => (playlist = false)} />{/if}

<style>
	button.custom-action {
		width: auto;
		min-width: min(44px, 100%);
		height: auto;
		min-height: 44px;
		max-width: 100%;
	}

	summary {
		cursor: pointer;
		padding: 0.65rem 0;
		font-weight: 600;
	}
	.stars,
	.tools,
	.tools .secondary {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		justify-content: var(--cell-justify, flex-start);
		gap: 0.35rem;
	}
	.stars button {
		min-height: 44px;
		min-width: 44px;
		color: var(--accent);
	}
	p {
		color: var(--muted);
	}
</style>
