<script lang="ts">
	import { onMount } from 'svelte';
	import { DnError, type Session } from '../connection';
	import { errorMessage } from './catalog';
	import {
		chooseCandidate,
		closeSearch,
		getSearchJob,
		type SearchCandidate
	} from './requestActions';
	import ReviewSheet from './ReviewSheet.svelte';
	import { ChevronRight } from '@lucide/svelte';

	let {
		session,
		jobId,
		title,
		onclose,
		ondone
	}: {
		session: Session;
		jobId: string;
		title: string;
		onclose: (finished?: boolean) => void;
		ondone: (receipt: string) => void;
	} = $props();
	let job = $state<Awaited<ReturnType<typeof getSearchJob>> | null>(null);
	let selected = $state<SearchCandidate | 'watch' | 'stop' | null>(null);
	let error = $state(''),
		loading = $state(false),
		submitting = $state(false);
	let missing = false;
	const tiers = {
		recommended: 'Recommended match',
		possible: 'Possible match',
		refused: 'Outside download settings'
	} satisfies Record<SearchCandidate['tier'], string>;
	const refusalNames = {
		quality_outside_range: 'Quality outside your configured range',
		over_size_cap: 'Exceeds your size limit',
		ignored_term: 'Contains an ignored term',
		required_term_missing: 'Missing a required term',
		below_minimum_score: 'Below your minimum score'
	} satisfies Record<NonNullable<SearchCandidate['refusal']>[number], string>;
	const outsideSettings = $derived(typeof selected === 'object' && !!selected?.refusal?.length);

	function back() {
		if (selected) selected = null;
		else close();
	}
	function close() {
		onclose(missing || job?.status === 'matched' || job?.status === 'cancelled');
	}

	async function load() {
		loading = true;
		try {
			job = await getSearchJob(session, jobId);
			missing = false;
		} catch (e) {
			job = null;
			missing = e instanceof DnError && e.status === 404;
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}
	async function confirm() {
		if (!selected || submitting) return;
		submitting = true;
		error = '';
		try {
			if (typeof selected === 'object') {
				await chooseCandidate(session, jobId, selected);
				ondone('Download started from your selection.');
			} else {
				const watching = selected === 'watch';
				const result = await closeSearch(session, jobId, watching);
				if (!result.success) throw new Error('The search changed. Check its current status.');
				ondone(watching ? 'DN will keep watching for this album.' : 'Search stopped.');
			}
		} catch (e) {
			error = errorMessage(e);
			selected = null;
			await load();
		} finally {
			submitting = false;
		}
	}
	onMount(() => {
		void load();
	});
</script>

<ReviewSheet
	title={selected
		? typeof selected === 'object'
			? 'Review this match'
			: selected === 'watch'
				? 'Keep watching?'
				: 'Stop search?'
		: 'Review matches'}
	context={title}
	onback={back}
	backLabel={selected ? 'Back to matches' : 'Back to downloads'}
	busy={submitting}
>
	{#if error}<p role="alert">{error}</p>{/if}
	{#if selected}
		{#if typeof selected === 'object'}
			<div class="selected">
				<h3>{selected.title}</h3>
				<p>
					{[
						selected.source.replace(/^plugin:/, ''),
						selected.username || selected.indexer,
						selected.format
					]
						.filter(Boolean)
						.join(' · ')}
				</p>
				<p>{selected.note?.text}</p>
			</div>
			{#if selected.files.length}
				<details class="files">
					<summary>View files ({selected.files.length})</summary>
					<ul>
						{#each selected.files as file, i (i)}<li>
								{file.filename.split(/[\\/]/).pop() || file.filename}{#if file.bitrate}
									<small>· {file.bitrate} kbps</small>{/if}
							</li>{/each}
					</ul>
				</details>
			{/if}
			{#if selected.refusal?.length}<ul>
					{#each selected.refusal as reason (reason)}<li>{refusalNames[reason]}</li>{/each}
				</ul>{/if}
		{:else}
			<p>
				{selected === 'watch'
					? 'Pass on these matches and add the album to the wanted watchlist?'
					: 'Stop this search without starting a download?'}
			</p>
		{/if}
		<div class="actions confirm">
			<button class="primary" disabled={submitting} onclick={confirm}
				>{selected === 'watch'
					? 'Keep watching'
					: selected === 'stop'
						? 'Stop search'
						: outsideSettings
							? 'Download anyway'
							: 'Start download'}</button
			>
		</div>
	{:else}
		{#if loading}<p role="status">Checking search…</p>
		{:else if job}
			{#if job.reason}<p>{job.reason.text} {job.reason.action}</p>{/if}
			{#if job.status === 'completed'}
				{#each ['recommended', 'possible', 'refused'] as const as tier (tier)}
					{@const list = job.candidates.filter((c) => c.tier === tier)}
					{#if list.length}
						<section class="matches" aria-label={tiers[tier]}>
							<h3>{tiers[tier]} <small>{list.length}</small></h3>
							{#each list as candidate (candidate.candidate_index)}
								<button class="secondary match" onclick={() => (selected = candidate)}>
									<strong>{candidate.title}</strong><ChevronRight size={18} aria-hidden="true" />
									<small
										>{[
											candidate.source.replace(/^plugin:/, ''),
											candidate.username || candidate.indexer,
											candidate.format,
											candidate.tracks_matched != null && candidate.tracks_total
												? candidate.tracks_matched + ' of ' + candidate.tracks_total + ' tracks'
												: candidate.file_count
													? candidate.file_count + ' files'
													: null,
											candidate.size_bytes
												? Math.ceil(candidate.size_bytes / 1048576) + ' MiB'
												: null
										]
											.filter(Boolean)
											.join(' · ')}</small
									>

									{#if candidate.refusal?.length}<small
											>{candidate.refusal.map((r) => refusalNames[r]).join(' · ')}</small
										>{/if}
								</button>
							{/each}
						</section>
					{/if}
				{/each}
				{#if !job.candidates.length}<p>No matches found.</p>{/if}
			{:else}<p role="status">
					{job.status === 'searching'
						? 'The search is running.'
						: job.status === 'matched'
							? 'A download has already started.'
							: job.status === 'failed'
								? 'The search failed.'
								: 'The search has closed.'}
				</p>{/if}
		{/if}
		<div class="actions">
			{#if !loading && (!job || job.status === 'searching')}<button
					class="secondary"
					onclick={() => {
						error = '';
						void load();
					}}>Check again</button
				>{/if}
			{#if job?.status === 'completed' && job.release_group_mbid}<button
					class="secondary"
					onclick={() => (selected = 'watch')}>None of these, keep watching</button
				>{/if}
			{#if job && ['searching', 'completed', 'failed'].includes(job.status)}<button
					class="secondary"
					onclick={() => (selected = 'stop')}>Stop search</button
				>{/if}
			<button class="text-button" onclick={close}>Close</button>
		</div>
	{/if}
</ReviewSheet>

<style>
	.matches {
		margin-block: var(--gap);
	}
	h3 {
		font-size: 1.05rem;
		margin: 0.65rem 0;
	}
	h3 small {
		font-weight: 400;
		color: var(--muted);
	}
	.match {
		width: 100%;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.1rem 0.5rem;
		text-align: start;
		overflow-wrap: anywhere;
		background: var(--surface);
		border: 1px solid var(--line);
		padding: 0.65rem 0.75rem;
		margin-bottom: 0.35rem;
	}
	.match small {
		color: var(--muted);
		grid-column: 1;
		display: block;
		font-size: 0.84rem;
	}
	.match :global(svg) {
		grid-column: 2;
		grid-row: 1/3;
	}
	.selected h3 {
		font-size: 1.15rem;
	}
	.selected p {
		margin: 0.4rem 0;
	}
	.files {
		margin-block: var(--gap);
	}
	.files summary {
		min-height: 44px;
		align-content: center;
		cursor: pointer;
	}
	.files li {
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		gap: 0.45rem;
		flex-wrap: wrap;
		margin: var(--gap) 0;
	}
	.confirm button {
		width: 100%;
	}
</style>
