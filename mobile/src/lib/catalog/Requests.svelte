<script lang="ts">
	import { onMount } from 'svelte';
	import { Browser } from '@capacitor/browser';
	import { Capacitor } from '@capacitor/core';
	import RequestCandidates from './RequestCandidates.svelte';
	import { ChevronRight, Ellipsis, RefreshCw } from '@lucide/svelte';
	import type { Session } from '../connection';
	import {
		activeRequests,
		requestHistory,
		requestedAlbum,
		statusLabel,
		errorMessage,
		type Album,
		type RequestItem
	} from './catalog';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import {
		approvals,
		requestViewer,
		requestActions,
		taskActions,
		taskPage,
		taskStatus,
		type Action,
		type Download,
		type Viewer
	} from './requestActions';
	let { session, onopen }: { session: Session; onopen: (a: Album) => void } = $props();
	type View = 'requests' | 'approvals' | 'downloads';
	let view = $state<View>('requests'),
		viewer = $state<Viewer | null>(null);
	let active = $state<RequestItem[]>([]),
		history = $state<RequestItem[]>([]),
		pending = $state<RequestItem[]>([]),
		tasks = $state<Download[]>([]);
	let busy = $state(false),
		error = $state(''),
		profileError = $state(''),
		receipt = $state('');
	let page = $state(1),
		pages = $state(1),
		downloadPage = $state(1),
		moreDownloads = $state(false);
	let menu = $state<{ title: string; options: Action[] } | null>(null),
		selected = $state<Action | null>(null);
	let reviewing = $state<{ jobId: string; title: string; taskId?: string } | null>(null);
	let manualJobs = $state<Record<string, string>>({});
	function closeReview(finished = false) {
		if (finished && reviewing?.taskId) delete manualJobs[reviewing.taskId];
		reviewing = null;
	}
	const serverTools = $derived([
		{ label: 'Review held files and download history', route: '/downloads' },
		{ label: 'Manage wanted watches', route: '/requests?tab=wanted' },
		...(viewer?.role === 'admin' || viewer?.role === 'trusted'
			? [
					{ label: 'Import files into the library', route: '/downloads?tab=import' },
					{ label: 'Review quality upgrades', route: '/requests?tab=upgrades' }
				]
			: []),
		...(viewer?.role === 'admin'
			? [
					{ label: 'Manage auto-downloads', route: '/requests?tab=auto-download' },
					{ label: 'Inspect quarantined downloads', route: '/downloads' }
				]
			: [])
	]);
	async function launchWeb(event: MouseEvent) {
		if (!Capacitor.isNativePlatform()) return;
		event.preventDefault();
		const url = (event.currentTarget as HTMLAnchorElement).href;
		try {
			await Browser.open({ url });
		} catch (e) {
			actionError = errorMessage(e);
		}
	}
	let actionError = $state(''),
		sending = $state(false);
	let mounted = true,
		version = 0;
	async function profile() {
		try {
			const me = await requestViewer(session);
			if (mounted) {
				viewer = me;
				profileError = '';
			}
		} catch (cause) {
			if (mounted) profileError = errorMessage(cause);
		}
	}
	async function refresh(wanted = view === 'downloads' ? downloadPage : page) {
		const sequence = ++version;
		busy = true;
		error = '';
		try {
			if (view === 'requests') {
				const [live, past] = await Promise.all([
					activeRequests(session),
					requestHistory(session, wanted)
				]);
				if (sequence !== version) return;
				active = live.items;
				history = past.items;
				page = past.page;
				pages = past.total_pages;
			} else if (view === 'approvals' && viewer?.role === 'admin') {
				const reply = await approvals(session);
				if (sequence === version) pending = reply.items;
			} else if (view === 'downloads') {
				const reply = await taskPage(session, wanted);
				if (sequence !== version) return;
				tasks = reply.items;
				downloadPage = reply.page;
				moreDownloads = tasks.length === reply.page_size;
			}
		} catch (cause) {
			if (sequence === version) error = errorMessage(cause);
		} finally {
			if (sequence === version) busy = false;
		}
	}
	function switchView(next: View) {
		if (next === view) return;
		view = next;
		receipt = '';
		actionError = '';
		void refresh();
	}
	function open(title: string, options: Action[]) {
		menu = { title, options };
		selected = options.length === 1 ? options[0] : null;
		actionError = '';
		receipt = '';
	}
	function close() {
		menu = null;
		selected = null;
		actionError = '';
	}
	async function confirm() {
		if (!selected || sending) return;
		sending = true;
		actionError = '';
		try {
			const answer = await selected.run();
			if (!mounted) return;
			receipt = answer;
			close();
			await refresh();
		} catch (cause) {
			if (mounted) {
				close();
				actionError = errorMessage(cause);
				await refresh();
			}
		} finally {
			sending = false;
		}
	}
	onMount(() => {
		void profile();
		void refresh();
		const visible = () => {
			if (!document.hidden && !busy && !menu && !reviewing) void refresh();
		};
		const timer = setInterval(visible, 15000);
		document.addEventListener('visibilitychange', visible);
		return () => {
			mounted = false;
			version++;
			clearInterval(timer);
			document.removeEventListener('visibilitychange', visible);
		};
	});
</script>

<div class="heading">
	<h1>Requests</h1>
	<button
		class="icon-button"
		aria-label={'Refresh ' + view}
		disabled={busy}
		onclick={() => {
			void refresh();
			if (profileError) void profile();
		}}><RefreshCw size={20} /></button
	>
</div>
<div class="views" role="group" aria-label="Request views">
	<button aria-pressed={view === 'requests'} onclick={() => switchView('requests')}>Activity</button
	>
	<button aria-pressed={view === 'downloads'} onclick={() => switchView('downloads')}
		>Downloads</button
	>
	{#if viewer?.role === 'admin'}<button
			aria-pressed={view === 'approvals'}
			onclick={() => switchView('approvals')}>Approvals</button
		>{/if}
</div>
{#if profileError}<p role="alert">Could not load account permissions. {profileError}</p>{/if}
{#if error}<p role="alert">{error}</p>{/if}
{#if actionError}<p role="alert">{actionError}</p>{/if}
{#if receipt}<p role="status">{receipt}</p>{/if}

{#snippet actions(title: string, options: Action[])}
	{#if options.length}
		<button
			class="icon-button"
			aria-label={'Actions for ' + title}
			onclick={() => open(title, options)}><Ellipsis size={18} /></button
		>
	{/if}
{/snippet}

{#snippet rows(items: RequestItem[], review = false)}
	<div data-part="request-list">
		{#each items as r (r.request_kind + r.musicbrainz_id)}
			{@const album = requestedAlbum(r)}
			{@const title = r.track_title || r.album_title}
			<div class="row">
				<button class="request" disabled={!album} onclick={() => album && onopen(album)}>
					<span
						><strong>{title}</strong><small
							>{r.artist_name} · {statusLabel(
								r
							)}{#if r.progress != null && r.status === 'downloading'}
								· {Math.round(r.progress)}%{/if}</small
						>
						{#if review && r.requested_by_name}<small>Requested by {r.requested_by_name}</small
							>{/if}
						{#if r.error_message}<small>{r.error_message}</small>{/if}
					</span>
					{#if album}<ChevronRight size={18} aria-hidden="true" />{/if}
				</button>
				{@render actions(title, requestActions(session, viewer, r, review))}
			</div>
		{/each}
	</div>
{/snippet}

{#if view === 'requests'}
	{#if active.length}<h2>Active</h2>
		{@render rows(active)}{/if}
	{#if history.length}<h2>History</h2>
		{@render rows(history)}{/if}
	{#if pages > 1}
		<div class="pagination">
			<button class="secondary" disabled={busy || page < 2} onclick={() => refresh(page - 1)}
				>Previous</button
			>
			<span>{page} / {pages}</span><button
				class="secondary"
				disabled={busy || page >= pages}
				onclick={() => refresh(page + 1)}>Next</button
			>
		</div>
	{/if}
	{#if !active.length && !history.length && !error}<p role="status">
			{busy ? 'Loading requests…' : 'No requests yet.'}
		</p>{/if}
{:else if view === 'approvals'}
	<h2>Awaiting approval</h2>
	{@render rows(pending, true)}
	{#if !pending.length && !error}<p role="status">
			{busy ? 'Loading approvals…' : 'No requests awaiting approval.'}
		</p>{/if}
{:else}
	<h2>Downloads</h2>
	{#each tasks as task (task.id)}
		{@const title = task.track_title || task.album_title}
		<div class="row" data-part="download-task">
			<div class="request task">
				<span
					><strong>{title}</strong><small
						>{task.artist_name} · {taskStatus(task)}{#if task.status === 'downloading'}
							· {task.progress_percent}%{/if}</small
					>
					{#if task.reason?.text}<small>{task.reason.text}</small>{/if}
					{#if task.next_retry_at && !task.held_for_review}<small
							>Next retry {new Date(task.next_retry_at * 1000).toLocaleString()}</small
						>{/if}
				</span>
			</div>
			{#if task.held_for_review}
				<a
					class="text-button"
					href={session.serverUrl + '/downloads'}
					target="_blank"
					rel="noopener noreferrer"
					onclick={launchWeb}
					aria-label={'Review held files for ' + title + ' in browser'}>Review held files</a
				>
			{:else if task.status === 'queued' && task.search_job_id && task.candidate_index == null && viewer?.id === task.user_id}
				<button
					class="secondary"
					aria-label={'Review matches for ' + title}
					onclick={() => {
						reviewing = { jobId: task.search_job_id!, title };
					}}>Review matches</button
				>
			{:else}
				{@render actions(
					title,
					taskActions(
						session,
						viewer,
						task,
						(jobId) => {
							if (mounted) {
								manualJobs[task.id] = jobId;
								reviewing = { jobId, title, taskId: task.id };
							}
						},
						manualJobs[task.id]
					)
				)}
			{/if}
		</div>
	{/each}
	{#if !tasks.length && !error}<p role="status">
			{busy ? 'Loading downloads…' : 'No downloads on this page.'}
		</p>{/if}
	{#if downloadPage > 1 || moreDownloads}
		<div class="pagination">
			<button
				class="secondary"
				disabled={busy || downloadPage < 2}
				onclick={() => refresh(downloadPage - 1)}>Previous</button
			>
			<span>Page {downloadPage}</span><button
				class="secondary"
				disabled={busy || !moreDownloads}
				onclick={() => refresh(downloadPage + 1)}>Next</button
			>
		</div>
	{/if}
	<details class="server-tools">
		<summary>More on your server</summary>
		<p>These tools open DroppedNeedle in your browser. Sign in there if prompted.</p>
		{#each serverTools as tool (tool.label)}
			<a
				class="text-button"
				href={session.serverUrl + tool.route}
				target="_blank"
				rel="noopener noreferrer"
				onclick={launchWeb}>{tool.label}</a
			>
		{/each}
	</details>
{/if}
{#if reviewing}
	<RequestCandidates
		{session}
		jobId={reviewing.jobId}
		title={reviewing.title}
		onclose={closeReview}
		ondone={(message) => {
			closeReview(true);
			receipt = message;
			actionError = '';
			void refresh();
		}}
	/>
{/if}
{#if menu}
	<PlaylistDialog title={menu.title} onclose={close} busy={sending}>
		{#if selected}<p>{selected.effect}</p>
			<div class="actions">
				<button class="secondary" disabled={sending} onclick={close}>Go back</button>
				<button class="primary" disabled={sending} onclick={confirm}>{selected.label}</button>
			</div>
		{:else}
			<div class="choices">
				{#each menu.options as option (option.label)}
					<button class="secondary" onclick={() => (selected = option)}>{option.label}</button
					>{/each}
				<button class="text-button" onclick={close}>Close</button>
			</div>
		{/if}
	</PlaylistDialog>
{/if}

<style>
	.server-tools {
		margin-block: var(--gap);
	}
	.server-tools summary {
		cursor: pointer;
	}
	.server-tools a {
		display: block;
		width: fit-content;
	}
	.server-tools p {
		color: var(--muted);
	}
	.views {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		border-bottom: 1px solid var(--line);
	}
	.views button {
		min-height: 44px;
		padding: 0.35rem 0.75rem;
		color: var(--muted);
	}
	.views button[aria-pressed='true'] {
		color: var(--text);
		border-bottom: 2px solid var(--accent);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		border-bottom: 1px solid var(--line);
	}
	.row .request {
		min-width: 0;
		flex: 1;
		border: 0;
	}
	.choices {
		display: grid;
		gap: 0.4rem;
	}
	.heading,
	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gap);
	}
	.pagination {
		margin-block: var(--gap);
	}
	.request {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		background: transparent;
		color: var(--text);
		border: 0;
		border-bottom: 1px solid var(--line);
		width: 100%;
		text-align: start;
		padding: 0.8rem 0;
		min-height: 3.4rem;
	}
	.request span {
		min-width: 0;
	}
	.request strong,
	.request small {
		display: block;
		overflow-wrap: anywhere;
	}
	.request small {
		color: var(--muted);
		margin-top: 0.2rem;
	}
</style>
