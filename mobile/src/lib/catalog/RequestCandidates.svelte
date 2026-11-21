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
	import {
		CheckCheck,
		ChevronRight,
		CircleHelp,
		Eye,
		ListMusic,
		RefreshCw,
		SlidersHorizontal,
		Square,
		TriangleAlert
	} from '@lucide/svelte';

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
		recommended: { label: 'Recommended match', icon: CheckCheck },
		possible: { label: 'Possible match', icon: CircleHelp },
		refused: { label: 'Outside download settings', icon: SlidersHorizontal }
	} as const;
	const refusalNames = {
		quality_outside_range: 'Quality outside your configured range',
		over_size_cap: 'Exceeds your size limit',
		ignored_term: 'Contains an ignored term',
		required_term_missing: 'Missing a required term',
		below_minimum_score: 'Below your minimum score'
	} satisfies Record<NonNullable<SearchCandidate['refusal']>[number], string>;
	const outsideSettings = $derived(typeof selected === 'object' && !!selected?.refusal?.length);
	function source(candidate: SearchCandidate) {
		return [candidate.source.replace(/^plugin:/, ''), candidate.username || candidate.indexer]
			.filter(Boolean)
			.join(' · ');
	}
	function fileSummary(candidate: SearchCandidate) {
		const coverage =
			candidate.tracks_matched != null && candidate.tracks_total
				? candidate.tracks_matched + ' of ' + candidate.tracks_total + ' tracks'
				: candidate.file_count
					? candidate.file_count + (candidate.file_count === 1 ? ' file' : ' files')
					: '';
		return [
			candidate.format,
			coverage,
			candidate.size_bytes ? Math.ceil(candidate.size_bytes / 1048576) + ' MiB' : ''
		]
			.filter(Boolean)
			.join(' · ');
	}

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
	backLabel={selected ? 'Back to matches' : undefined}
	closeLabel="Close"
	scrollKey={selected && typeof selected === 'object'
		? 'match-' + selected.candidate_index
		: selected || 'matches'}
	busy={submitting}
>
	{#if error}<p role="alert">{error}</p>{/if}
	{#if selected}
		{#if typeof selected === 'object'}
			<div class="selected settings-panel" data-surface="panel">
				<h3 class="review-heading">{selected.title}</h3>
				{#if source(selected)}<span class="review-meta">{source(selected)}</span>{/if}
				{#if fileSummary(selected)}<span class="review-meta">{fileSummary(selected)}</span>{/if}
				{#if selected.note?.text}<p>{selected.note.text}</p>{/if}
			</div>
			{#if selected.files.length}
				<details class="settings-disclosure" data-surface="panel">
					<summary
						><span class="file-heading"
							><ListMusic size={18} aria-hidden="true" />View files ({selected.files.length})</span
						></summary
					>
					<ul class="review-files">
						{#each selected.files as file, i (i)}<li>
								{file.filename.split(/[\\/]/).pop() || file.filename}{#if file.bitrate}
									<small class="review-meta">{file.bitrate} kbps</small>{/if}
							</li>{/each}
					</ul>
				</details>
			{/if}
			{#if selected.refusal?.length}
				<div class="refusal">
					<TriangleAlert size={18} aria-hidden="true" />
					<ul>
						{#each selected.refusal as reason (reason)}<li>{refusalNames[reason]}</li>{/each}
					</ul>
				</div>
			{/if}
		{:else}
			<p>
				{selected === 'watch'
					? 'Pass on these matches and add the album to the wanted watchlist?'
					: 'Stop this search without starting a download?'}
			</p>
		{/if}
		<div class="confirm">
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
						{@const tierInfo = tiers[tier]}
						<section class="review-section" aria-label={tierInfo.label}>
							<h3 class="review-heading" data-tier={tier}>
								<tierInfo.icon size={18} aria-hidden="true" />{tierInfo.label}
								<span class="review-count">{list.length}</span>
							</h3>
							<div class="settings-list" data-surface="panel">
								{#each list as candidate (candidate.candidate_index)}
									<button class="settings-entry" onclick={() => (selected = candidate)}>
										<span>
											<strong>{candidate.title}</strong>
											{#if source(candidate)}<span class="review-meta">{source(candidate)}</span
												>{/if}
											{#if fileSummary(candidate)}<span class="review-meta"
													>{fileSummary(candidate)}</span
												>{/if}
											{#if candidate.refusal?.length}<span class="review-meta refusal-note"
													>{candidate.refusal.map((r) => refusalNames[r]).join(' · ')}</span
												>{/if}
										</span>
										<ChevronRight size={18} aria-hidden="true" />
									</button>
								{/each}
							</div>
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
		{#if !loading && (!job || ['searching', 'completed', 'failed'].includes(job.status))}
			<div class="settings-list" data-surface="panel">
				{#if !job || job.status === 'searching'}<button
						class="settings-entry"
						onclick={() => {
							error = '';
							void load();
						}}><RefreshCw size={18} aria-hidden="true" /><span>Check again</span></button
					>{/if}
				{#if job?.status === 'completed' && job.release_group_mbid}<button
						class="settings-entry"
						onclick={() => (selected = 'watch')}
						><Eye size={18} aria-hidden="true" /><span>None of these, keep watching</span
						><ChevronRight size={16} aria-hidden="true" /></button
					>{/if}
				{#if job}<button class="settings-entry" onclick={() => (selected = 'stop')}
						><Square size={16} aria-hidden="true" /><span>Stop search</span><ChevronRight
							size={16}
							aria-hidden="true"
						/></button
					>{/if}
			</div>
		{/if}
	{/if}
</ReviewSheet>

<style>
	.review-heading[data-tier='recommended'] :global(svg) {
		color: color-mix(in srgb, var(--color-success) 60%, var(--text));
	}
	.review-heading[data-tier='possible'] :global(svg),
	.file-heading :global(svg) {
		color: var(--accent);
	}
	.review-heading[data-tier='refused'] :global(svg),
	.refusal :global(svg) {
		color: color-mix(in srgb, var(--color-warning) 60%, var(--text));
	}
	.selected {
		gap: 0.25rem;
	}
	.selected p {
		margin: 0.35rem 0 0;
	}
	.refusal {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}
	.refusal ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.refusal-note {
		margin-top: 0.3rem;
		color: var(--text);
	}
	.file-heading {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
	}
	.confirm button {
		width: 100%;
	}
</style>
