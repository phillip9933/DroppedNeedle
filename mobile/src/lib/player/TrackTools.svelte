<script lang="ts">
	import { untrack } from 'svelte';
	import { Capacitor } from '@capacitor/core';
	import type { Section } from '../boards/layout';
	import PlayerActionFace from './PlayerActionFace.svelte';
	import { Star, Heart, ListPlus, Wrench, Download, CircleCheck } from '@lucide/svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, postJson, type Session } from '../connection';
	import { trackToolFields } from './layout';
	import type { PlayerTrack } from '../player';
	import { errorMessage, path } from '../catalog/catalog';
	import Favorite from '../catalog/Favorite.svelte';
	import {
		offlineInventory,
		offlineSupported,
		removeOffline,
		saveOfflineTracks,
		watchOfflineMedia
	} from '../offline/media';
	import type { OfflineOrigin } from '../offline/tracks';
	import { changeTrackFeedback } from '../offline/feedback';
	import {
		feedbackScope,
		feedbackChanged,
		trackFeedback,
		confirmedFeedback,
		type FeedbackRecord
	} from '../offline/feedbackStore';
	import FeedbackStatus from '../offline/FeedbackStatus.svelte';
	import AddToPlaylist from '../catalog/AddToPlaylist.svelte';
	import PlaylistDialog from '../catalog/PlaylistDialog.svelte';

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
	let origin = $state<OfflineOrigin>(),
		deviceReady = $state(false),
		online = $state(navigator.onLine),
		offlineOnly = $state(false),
		confirmRemove = $state(false),
		changingDownload = $state(false),
		downloadError = $state('');
	let downloadReceipt = $state<{ id: string; text: string }>();
	const backgroundDownloads = Capacitor.getPlatform() === 'android';
	const sourceActions: Record<OfflineOrigin, string> = {
		downloaded: 'Downloaded',
		automatic: 'Keep automatic download',
		cached: 'Keep cached track'
	};
	const downloadLabel = $derived.by(() => {
		if (sample) return 'Save offline';
		if (changingDownload) return 'Updating download…';
		if (origin) return sourceActions[origin];
		if (backgroundDownloads && (!online || offlineOnly)) return 'Queue for download';
		if (!online) return 'Connect to download';
		return offlineOnly ? 'Offline-only playback' : 'Save offline';
	});
	let local = $state<PlayerTrack>(),
		favoriteValue = $state<boolean>(),
		library = $state<Model['TrackView'] | null>(null),
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
			: (local?.format?.toUpperCase() ?? '')
	);

	$effect(() => {
		if (!open || sample) return;
		const id = trackId,
			name = trackTitle,
			current = session;
		void retry;
		let live = true;
		libraryError = ratingError = downloadError = '';
		rating = null;
		library = null;
		local = undefined;
		favoriteValue = undefined;
		origin = undefined;
		deviceReady = false;
		const scope = feedbackScope(current);
		let observed: FeedbackRecord[] = [];
		async function preferred(field: 'rating' | 'favorite', value: number | boolean) {
			return confirmedFeedback(
				scope,
				id,
				field,
				value,
				observed.find((r) => r.field === field)
			).catch(() => value);
		}
		const update = (event: Event) => {
			const record = (event as CustomEvent<FeedbackRecord>).detail;
			if (record.scope !== scope || record.id !== id) return;
			if (record.field === 'rating') rating = Number(record.value);
			else favoriteValue = record.value === true;
		};
		window.addEventListener(feedbackChanged, update);
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
					const favorite = await preferred('favorite', found.favorite);
					if (live) {
						library = found;
						favoriteValue = Boolean(favorite);
					}
					return;
				}
				after = result.next ?? undefined;
				if (!after || cursors.includes(after)) break;
				cursors.push(after);
			} while (live);
			if (live) libraryError = 'Library details are unavailable for this track.';
		}
		const wantFavorite = fields.includes('player-favorite'),
			wantQuality = fields.includes('player-quality'),
			wantRating = fields.includes('player-rating'),
			wantDownload = fields.includes('player-download') && offlineSupported;
		let read = 0;
		async function readDevice() {
			const version = ++read;
			const data =
				scope && offlineSupported
					? await offlineInventory(current).catch(() => undefined)
					: undefined;
			if (live && version === read) {
				origin = data?.byId.get(id)?.origin;
				offlineOnly = data?.offlineOnly === true;
				deviceReady = !!scope;
			}
			return data;
		}
		function connectionChanged() {
			online = navigator.onLine;
		}
		const stopWatching = wantDownload
			? watchOfflineMedia(() => {
					void readDevice();
				})
			: undefined;
		if (wantDownload) {
			connectionChanged();
			window.addEventListener('online', connectionChanged);
			window.addEventListener('offline', connectionChanged);
		}
		async function load() {
			const data = await readDevice();
			if (!live) return;
			const stored = data?.byId.get(id)?.track;
			if (stored) {
				local = stored;
				favoriteValue = stored.favorite ?? false;
				rating = stored.rating ?? 0;
			}
			const offline = !navigator.onLine || data?.offlineOnly === true;
			if (offline) {
				if (!stored && (wantFavorite || wantQuality || wantRating))
					libraryError = 'This track has no offline details.';
				return;
			}
			if (stored) observed = await trackFeedback(scope, id).catch(() => []);
			if (!live) return;
			if (wantFavorite || wantQuality)
				void findTrack().catch((e) => {
					if (live && !stored) libraryError = errorMessage(e);
				});
			if (wantRating)
				void postJson<Model['RatingLookupResponse']>(current, path('/api/v3/ratings/lookup'), {
					track_ids: [id]
				})
					.then(async (v) => {
						const confirmed = await preferred('rating', v.tracks[id] ?? 0);
						if (live) rating = Number(confirmed);
					})
					.catch((e) => {
						if (live && !stored) ratingError = errorMessage(e);
					});
		}
		void load();
		return () => {
			live = false;
			stopWatching?.();
			window.removeEventListener('online', connectionChanged);
			window.removeEventListener('offline', connectionChanged);
			window.removeEventListener(feedbackChanged, update);
		};
	});
	async function download(remove = false) {
		if (sample || changingDownload) return;
		changingDownload = true;
		downloadError = '';
		downloadReceipt = undefined;
		const id = track.id;
		try {
			if (remove) {
				await removeOffline(session, [track.id]);
				confirmRemove = false;
			} else {
				const result = await saveOfflineTracks(session, [track]);
				if (result.failed) throw Error(result.message);
				if (result.queued && id === track.id) downloadReceipt = { id, text: result.message };
			}
		} catch (error) {
			downloadError = errorMessage(error);
		} finally {
			changingDownload = false;
		}
	}
	async function rate(value: number) {
		if (saving || rating === null) return;
		saving = true;
		ratingError = '';
		try {
			rating = Number(await changeTrackFeedback(session, track.id, 'rating', value));
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
	{:else if favoriteValue !== undefined}<Favorite
			{session}
			kind="track"
			id={track.id}
			value={favoriteValue}
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
	{#if fields.includes('player-favorite') || fields.includes('player-playlist') || (fields.includes('player-download') && offlineSupported)}<div
			class="tools"
		>
			{#if fields.includes('player-favorite')}{@render favorite()}{/if}{#if fields.includes('player-playlist')}{@render addPlaylist()}{/if}
			{#if fields.includes('player-download') && offlineSupported}<button
					class="secondary custom-action"
					aria-label={origin === 'downloaded' ? 'Manage track download' : downloadLabel}
					title={downloadLabel}
					disabled={!sample &&
						(!deviceReady ||
							changingDownload ||
							(!backgroundDownloads && !origin && (!online || offlineOnly)))}
					onclick={() => {
						if (origin === 'downloaded') confirmRemove = true;
						else void download();
					}}
					><PlayerActionFace
						section={mode === 'field' ? section : undefined}
						glyph={origin === 'downloaded' ? CircleCheck : Download}
						size={18}
						label={downloadLabel}
						defaultLabel
					/></button
				>{/if}
		</div>{/if}
	{#if downloadError && !confirmRemove}<p role="alert">{downloadError}</p>{/if}
	{#if downloadReceipt?.id === track.id && !origin}
		<p role="status">
			{downloadReceipt.text}
			<button class="text-button" onclick={() => window.dispatchEvent(new Event('dn-open-offline'))}
				>View download queue</button
			>
		</p>
	{/if}
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
	{#if !sample && local && (fields.includes('player-favorite') || fields.includes('player-rating'))}
		<FeedbackStatus
			{session}
			id={track.id}
			field={fields.length === 1
				? fields[0] === 'player-rating'
					? 'rating'
					: 'favorite'
				: undefined}
		/>
	{/if}
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
{#if confirmRemove}<PlaylistDialog
		title="Remove download?"
		busy={changingDownload}
		onclose={() => (confirmRemove = false)}
	>
		<p>Remove the saved copy of “{track.title}” from this device?</p>
		{#if downloadError}<p role="alert">{downloadError}</p>{/if}
		<div class="actions">
			<button class="secondary" disabled={changingDownload} onclick={() => (confirmRemove = false)}
				>Keep download</button
			>
			<button class="primary" disabled={changingDownload} onclick={() => void download(true)}
				>Remove download</button
			>
		</div>
	</PlaylistDialog>{/if}

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
