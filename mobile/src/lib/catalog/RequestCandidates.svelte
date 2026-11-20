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
	import PlaylistDialog from './PlaylistDialog.svelte';

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
	const refusalNames = {
		quality_outside_range: 'Quality outside your configured range',
		over_size_cap: 'Exceeds your size limit',
		ignored_term: 'Contains an ignored term',
		required_term_missing: 'Missing a required term',
		below_minimum_score: 'Below your minimum score'
	} satisfies Record<NonNullable<SearchCandidate['refusal']>[number], string>;
	const outsideSettings = $derived(typeof selected === 'object' && !!selected?.refusal?.length);

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

<PlaylistDialog title={'Review matches for ' + title} onclose={close} busy={submitting}>
	{#if error}<p role="alert">{error}</p>{/if}
	{#if selected}
		{#if typeof selected === 'object'}
			<p>Download {selected.title} from {selected.source}?</p>
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
		<div class="actions">
			<button class="secondary" disabled={submitting} onclick={() => (selected = null)}
				>Go back</button
			>
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
				<div class="matches">
					{#each job.candidates as candidate (candidate.candidate_index)}
						<button class="secondary match" onclick={() => (selected = candidate)}>
							<strong>{candidate.title}</strong>
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
									candidate.size_bytes ? Math.ceil(candidate.size_bytes / 1048576) + ' MiB' : null
								]
									.filter(Boolean)
									.join(' · ')}</small
							>
							{#if candidate.note?.text}<small>{candidate.note.text}</small>{/if}
							{#if candidate.refusal?.length}<small
									>{candidate.refusal.map((r) => refusalNames[r]).join(' · ')}</small
								>{/if}
						</button>
					{:else}<p>No matches found.</p>{/each}
				</div>
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
</PlaylistDialog>

<style>
	.matches {
		display: grid;
		gap: 0.4rem;
		margin-bottom: 0.8rem;
	}
	.match {
		text-align: start;
		overflow-wrap: anywhere;
	}
	.match small {
		display: block;
		color: var(--muted);
		margin-top: 0.2rem;
	}
</style>
