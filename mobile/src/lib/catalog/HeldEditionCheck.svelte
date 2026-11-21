<script lang="ts">
	import { uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { DnError, getJson, postJson, putJson, type Session } from '../connection';
	import { editions, editionLabel, errorMessage, path } from './catalog';
	import { formatHeldReceipt, type HeldEntry } from './heldReview';
	type Schema = components['schemas'];
	let {
		session,
		entry,
		fileIds,
		ondone,
		onbusy
	}: {
		session: Session;
		entry: HeldEntry;
		fileIds: number[];
		ondone: (receipt: string) => void;
		onbusy?: (busy: boolean) => void;
	} = $props();
	let status = $state<Schema['EditionStatusView'] | null>(null);
	let choices = $state<{ id: string; label: string }[]>([]);
	let selected = $state('');
	let plan = $state<Schema['EditionPlanView'] | null>(null);
	let refresh = $state(0),
		planning = $state(false),
		busy = $state(false),
		saved = $state(false);
	let loadError = $state(''),
		listError = $state(''),
		planError = $state(''),
		actionError = $state('');
	let stale = $state(false),
		useAnyway = $state(false);
	const targets = $derived(
		entry.files.filter((f) => fileIds.includes(f.id) && f.reason === 'album_needs_check')
	);
	const alreadyChosen = $derived(
		Boolean(plan?.is_current && (status?.state === 'chosen' || status?.state === 'confirmed'))
	);
	const needsOverride = $derived(
		Boolean(plan && !plan.is_current && plan.kept_count === 0 && plan.files.length)
	);

	$effect(() => {
		void refresh;
		const album = entry.check_album_id,
			groupHint = entry.release_group_mbid,
			account = session;
		const controller = new AbortController();
		status = null;
		choices = [];
		selected = '';
		stale = false;
		actionError = listError = loadError = '';
		async function load() {
			if (!album) {
				loadError = 'This held entry has no library album to check.';
				return;
			}
			try {
				const next = await getJson<Schema['EditionStatusView']>(
					account,
					path('/api/v3/library/albums/{album_id}/edition', { album_id: album }),
					controller.signal
				);
				if (controller.signal.aborted) return;
				status = next;
				const options = new SvelteMap<string, string>();
				if (next.release_mbid) options.set(next.release_mbid, 'Current edition');
				for (const candidate of next.candidates) {
					if (candidate.release_mbid && !options.has(candidate.release_mbid))
						options.set(
							candidate.release_mbid,
							candidate.album_title + ' · ' + candidate.matched_files + ' matching files'
						);
				}
				const optionsList = () => Array.from(options, ([id, label]) => ({ id, label }));
				choices = optionsList();
				selected = choices[0]?.id ?? '';
				const group = next.release_group_mbid || next.named_release_group_mbid || groupHint;
				if (!group) return;
				try {
					const response = await editions(account, group, controller.signal);
					if (controller.signal.aborted) return;
					for (const item of response.items)
						options.set(
							item.release_mbid,
							editionLabel(item) +
								(item.release_mbid === next.release_mbid ? ' · Current edition' : '')
						);
					choices = optionsList();
					if (!selected) selected = choices[0]?.id ?? '';
				} catch (e) {
					if (!controller.signal.aborted) listError = errorMessage(e);
				}
			} catch (e) {
				if (!controller.signal.aborted) loadError = errorMessage(e);
			}
		}
		void load();
		return () => controller.abort();
	});
	$effect(() => {
		const release = selected,
			snapshot = status,
			account = session;
		const controller = new AbortController();
		plan = null;
		planError = actionError = '';
		useAnyway = false;
		planning = Boolean(release && snapshot);
		if (release && snapshot) {
			void getJson<Schema['EditionPlanView']>(
				account,
				path(
					'/api/v3/library/albums/{album_id}/edition/plan',
					{ album_id: snapshot.album_id },
					{ release_mbid: release }
				),
				controller.signal
			)
				.then((value) => {
					if (controller.signal.aborted) return;
					if (
						value.identity_revision !== snapshot.identity_revision ||
						value.release_mbid !== release ||
						value.album_id !== snapshot.album_id
					) {
						stale = true;
						return;
					}
					plan = value;
				})
				.catch((e) => {
					if (!controller.signal.aborted) planError = errorMessage(e);
				})
				.finally(() => {
					if (!controller.signal.aborted) planning = false;
				});
		}
		return () => controller.abort();
	});
	async function apply() {
		if (busy || stale || !plan || !targets.length || (needsOverride && !useAnyway)) return;
		busy = true;
		onbusy?.(true);
		actionError = '';
		try {
			if (!saved && !alreadyChosen) {
				const params = { album_id: plan.album_id };
				const revision = {
					expected_identity_revision: plan.identity_revision
				} satisfies Schema['EditionRevisionBody'];
				if (plan.is_current)
					await postJson(
						session,
						path('/api/v3/library/albums/{album_id}/edition/confirm', params),
						revision
					);
				else
					await putJson(session, path('/api/v3/library/albums/{album_id}/edition', params), {
						...revision,
						release_mbid: plan.release_mbid,
						...(needsOverride && useAnyway ? { use_anyway: true } : {})
					} satisfies Schema['ChooseEditionBody']);
			}
			saved = true;
			const receipt = await postJson<Schema['HeldActionResponse']>(
				session,
				path('/api/v3/held/{entry_id}/import', { entry_id: String(entry.id) }),
				{ file_ids: targets.map((file) => file.id) } satisfies Schema['HeldFilesRequest']
			);
			ondone(formatHeldReceipt(receipt));
		} catch (e) {
			if (!saved && e instanceof DnError && e.status === 409) stale = true;
			else actionError = errorMessage(e);
		} finally {
			busy = false;
			onbusy?.(false);
		}
	}
</script>

<section class="settings-stack" aria-label={uiText('Album edition review')}>
	{#if loadError}<p role="alert">{loadError}</p>
		<button class="secondary" onclick={() => refresh++}>{uiText('Reload editions')}</button>
	{:else if !status}<p role="status">{uiText('Checking the library edition…')}</p>
	{:else}
		{#if status.reason.message}<p>{status.reason.message}</p>{/if}
		{#if choices.length}
			<label
				>{uiText('Edition')}<InlineChoice {selected} label={uiText('Edition')}
					><select bind:value={selected} disabled={busy || saved || stale}
						>{#each choices as choice (choice.id)}<option value={choice.id}>{choice.label}</option
							>{/each}</select
					></InlineChoice
				></label
			>
		{:else}<p>{uiText('No edition is available to check yet.')}</p>{/if}
		{#if listError}<p role="status">
				{uiText('Other editions could not be loaded.')}
				{listError}
			</p>{/if}
		{#if stale}
			<p role="alert">
				{uiText('The library edition changed. Reload it to review the current match.')}
			</p>
			<button class="secondary" onclick={() => refresh++}>{uiText('Reload editions')}</button>
		{:else if planError}
			<p role="alert">{planError}</p>
			<button class="secondary" onclick={() => refresh++}>{uiText('Reload editions')}</button>
		{:else if planning}<p role="status">{uiText('Comparing tracks…')}</p>
		{:else if plan}
			<div class="review-section">
				<h3 class="review-heading">{plan.edition.title}</h3>
				<p class="review-meta">
					{plan.kept_count}
					{uiText('matched ·')}
					{plan.missing_count}
					{uiText('missing ·')}
					{plan.extra_count}
					{uiText('extra')}{plan.duplicate_count
						? ' · ' + plan.duplicate_count + ' duplicates'
						: ''}{plan.other_version_count
						? ' · ' + plan.other_version_count + ' other versions'
						: ''}
				</p>
			</div>
			{#if plan.tracks.length}<details class="settings-disclosure" data-surface="panel">
					<summary>{uiText('Edition tracks (')}{plan.tracks.length})</summary>
					<ul class="review-files">
						{#each plan.tracks as track (track.disc_number + '.' + track.position)}<li
								class="edition-track"
							>
								<span class="review-meta">{track.disc_number}.{track.position}</span>
								<span
									>{track.title}<small class="review-meta"
										>{track.local_track_id ? uiText('Matched') : uiText('Missing')}</small
									></span
								>
							</li>{/each}
					</ul>
				</details>{/if}
			<details class="settings-disclosure" data-surface="panel" open>
				<summary>{uiText('Held files to retry (')}{targets.length})</summary>
				<ul class="review-files">
					{#each targets as file (file.id)}<li>{file.original_name}</li>{/each}
				</ul>
			</details>
			{#if status.files_by_itself && !alreadyChosen && !saved}<p>
					{uiText('DN will also apply this library folder’s automatic file settings.')}
				</p>{/if}
			{#if needsOverride && !saved}<label class="override"
					><input type="checkbox" bind:checked={useAnyway} disabled={busy} />{uiText(
						'Use this edition even though none of the library files match it.'
					)}</label
				>{/if}
			{#if saved}<p role="status">
					{uiText('Edition saved. The selected files can be retried.')}
				</p>{/if}
			{#if actionError}<p role="alert">{actionError}</p>{/if}
			<button
				class="primary"
				disabled={busy || !targets.length || (needsOverride && !useAnyway)}
				onclick={apply}
				>{busy
					? uiText('Working…')
					: saved || alreadyChosen
						? uiText('Retry selected files')
						: plan.is_current
							? uiText('Confirm edition and retry files')
							: uiText('Use edition and retry files')}</button
			>
		{/if}
	{/if}
</section>

<style>
	p {
		margin: 0;
	}
	label {
		display: grid;
		gap: 0.4rem;
	}
	select {
		width: 100%;
		min-height: 44px;
	}
	.edition-track {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.6rem;
	}
	.override {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-height: 44px;
	}
	.override input {
		flex: none;
		width: 1.1rem;
		height: 1.1rem;
		padding: 0;
		margin: 0;
		accent-color: var(--accent);
	}
</style>
