<script lang="ts">
	import { onMount } from 'svelte';
	import { Browser } from '@capacitor/browser';
	import { Capacitor } from '@capacitor/core';
	import RequestCandidates from './RequestCandidates.svelte';
	import {
		ArrowDownToLine,
		Check,
		ChevronRight,
		CircleAlert,
		CircleCheck,
		Clock3,
		Ellipsis,
		ListFilter,
		Minus,
		RefreshCw
	} from '@lucide/svelte';
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
		downloadGroups,
		taskPage,
		taskState,
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
	let historyStatus = $state(''),
		historySort = $state('');
	let historyTotal = $state(0);
	const downloadSections = $derived(downloadGroups(tasks));
	const tabs = $derived<{ id: View; label: string }[]>([
		{ id: 'requests', label: 'Activity' },
		{ id: 'downloads', label: 'Downloads' },
		...(viewer?.role === 'admin' ? [{ id: 'approvals' as const, label: 'Approvals' }] : [])
	]);
	function tabKey(event: KeyboardEvent, index: number) {
		const last = tabs.length - 1;
		const target = {
			ArrowRight: (index + 1) % tabs.length,
			ArrowLeft: (index + last) % tabs.length,
			Home: 0,
			End: last
		}[event.key];
		if (target == null) return;
		event.preventDefault();
		const next = tabs[target].id;
		document.getElementById('requests-tab-' + next)?.focus();
		switchView(next);
	}
	function statusCue(state: string) {
		if (['imported', 'completed'].includes(state)) return { icon: CircleCheck, tone: 'success' };
		if (['failed', 'rejected'].includes(state)) return { icon: CircleAlert, tone: 'error' };
		if (
			[
				'incomplete',
				'partial',
				'awaiting_approval',
				'awaiting_review',
				'held_for_review',
				'request_quota_full',
				'storage_full',
				'no_download_source'
			].includes(state)
		)
			return { icon: CircleAlert, tone: 'warning' };
		if (['processing', 'importing', 'downloading'].includes(state))
			return { icon: ArrowDownToLine, tone: 'info' };
		if (['cancelled', 'cancelling'].includes(state)) return { icon: Minus, tone: 'neutral' };
		return { icon: Clock3, tone: 'neutral' };
	}
	function updateHistory() {
		history = [];
		pages = 1;
		page = 1;
		void refresh(1);
	}
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
					requestHistory(session, wanted, historyStatus || undefined, historySort || undefined)
				]);
				if (sequence !== version) return;
				active = live.items;
				history = past.items;
				historyTotal = past.total ?? past.items.length;
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
<div class="views" role="tablist" aria-label="Request views">
	{#each tabs as tab, i (tab.id)}
		<button
			role="tab"
			id={'requests-tab-' + tab.id}
			aria-selected={view === tab.id}
			aria-controls="requests-panel"
			tabindex={view === tab.id ? 0 : -1}
			onkeydown={(e) => tabKey(e, i)}
			onclick={() => switchView(tab.id)}>{tab.label}</button
		>
	{/each}
</div>
<div id="requests-panel" role="tabpanel" tabindex="0" aria-labelledby={'requests-tab-' + view}>
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

	{#snippet badge(label: string, state: string)}
		{@const cue = statusCue(state)}
		<span class="badge" data-tone={cue.tone}><cue.icon size={14} aria-hidden="true" />{label}</span>
	{/snippet}
	{#snippet progress(title: string, value: number)}
		{@const percent = Math.min(100, Math.max(0, Math.round(value)))}
		<div class="progress">
			<progress aria-label={'Download progress for ' + title} value={percent} max="100"
			></progress><span>{percent}%</span>
		</div>
	{/snippet}
	{#snippet rows(items: RequestItem[], list: 'active' | 'history' | 'approvals')}
		<ul class="records" data-part="request-list">
			{#each items as r (r.request_kind + r.musicbrainz_id)}
				{@const album = requestedAlbum(r)}
				{@const title = r.track_title || r.album_title}
				<li class="row">
					<div class="item-line">
						<div class="identity">
							{#if album}<button
									class="title-link"
									onclick={() => onopen(album)}
									aria-label={title + ', ' + statusLabel(r)}
								>
									<strong>{title}</strong><ChevronRight size={16} aria-hidden="true" /></button
								>
							{:else}<strong>{title}</strong>{/if}
							<small
								>{r.artist_name}{r.artist_name ? ' · ' : ''}{r.request_kind === 'track'
									? 'Track'
									: 'Album'}</small
							>
						</div>
						{@render actions(title, requestActions(session, viewer, r, list === 'approvals'))}
					</div>
					{@render badge(statusLabel(r), r.waiting_reason || r.task_state || r.status)}
					{#if r.progress != null && r.status === 'downloading'}{@render progress(
							title,
							r.progress
						)}{/if}
					{#if list === 'approvals' && r.requested_by_name}<small
							>Requested by {r.requested_by_name}</small
						>{/if}
					{#if list === 'history' && (r.completed_at || r.requested_at)}
						{@const time = new Date((r.completed_at || r.requested_at) * 1000)}
						<small
							>{r.completed_at ? 'Finished' : 'Requested'}
							<time datetime={time.toISOString()}
								>{time.toLocaleDateString(undefined, {
									year: 'numeric',
									month: 'short',
									day: 'numeric'
								})}</time
							></small
						>
					{/if}
					{#if r.error_message}<p class="reason">{r.error_message}</p>{/if}
				</li>
			{/each}
		</ul>
	{/snippet}

	{#if view === 'requests'}
		{#if active.length}<section aria-label="Active requests">
				<h2 class="section-title">Active <span>{active.length}</span></h2>
				{@render rows(active, 'active')}
			</section>{/if}
		{#if history.length || historyStatus || historySort || active.length || historyTotal}
			<section aria-label="Request history">
				<h2 class="section-title">History <span>{historyTotal}</span></h2>
				<details class="filters">
					<summary
						><ListFilter size={16} aria-hidden="true" />Filter and sort history{#if historyStatus || historySort}<Check
								size={15}
								aria-label="Filters applied"
							/>{/if}</summary
					>
					<div>
						<label
							>History status<select
								value={historyStatus}
								onchange={(event) => {
									historyStatus = event.currentTarget.value;
									updateHistory();
								}}
							>
								<option value="">All statuses</option><option value="imported">Imported</option
								><option value="incomplete">Incomplete</option><option value="failed">Failed</option
								><option value="cancelled">Cancelled</option><option value="rejected"
									>Rejected</option
								>
								{#if viewer?.role === 'admin'}<option value="reimportable">Can reimport</option
									>{/if}
							</select></label
						>
						<label
							>History order<select
								value={historySort}
								onchange={(event) => {
									historySort = event.currentTarget.value;
									updateHistory();
								}}
							>
								<option value="">Newest first</option><option value="oldest">Oldest first</option
								><option value="status">By status</option>
							</select></label
						>
					</div>
				</details>
				{#if history.length}{@render rows(history, 'history')}
				{:else if !busy && !error}<p>
						{historyStatus ? 'No requests match this status.' : 'No request history yet.'}
					</p>{/if}
			</section>
		{/if}
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
		{#if !active.length && !history.length && !historyStatus && !historySort && !error}<p
				role="status"
			>
				{busy ? 'Loading requests…' : 'No requests yet.'}
			</p>{/if}
	{:else if view === 'approvals'}
		<h2 class="section-title">Awaiting approval <span>{pending.length}</span></h2>
		{@render rows(pending, 'approvals')}
		{#if !pending.length && !error}<p role="status">
				{busy ? 'Loading approvals…' : 'No requests awaiting approval.'}
			</p>{/if}
	{:else}
		{#each downloadSections as [group, entries] (group)}
			<section aria-label={group}>
				<h2 class="section-title">{group} <span>{entries.length}</span></h2>
				<ul class="records">
					{#each entries as task (task.id)}
						{@const title = task.track_title || task.album_title}
						{@const state = taskState(task)}
						{@const label = state.charAt(0).toUpperCase() + state.slice(1).replaceAll('_', ' ')}
						<li class="row" data-part="download-task">
							<div class="item-line">
								<div class="identity">
									<strong>{title}</strong><small
										>{task.artist_name}{task.artist_name ? ' · ' : ''}{task.download_type ===
										'track'
											? 'Track'
											: 'Album'}</small
									>
								</div>

								{#if task.held_for_review}
									<a
										class="text-button"
										href={session.serverUrl + '/downloads'}
										target="_blank"
										rel="noopener noreferrer"
										onclick={launchWeb}
										aria-label={'Review held files for ' + title + ' in browser'}
										>Review held files</a
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
							{@render badge(label, state)}
							{#if task.status === 'downloading'}
								{@render progress(title, task.progress_percent)}
								{#if task.files_total > 0}<small
										>{task.files_completed} of {task.files_total} files</small
									>{/if}
							{/if}
							{#if task.reason?.text}<p class="reason">{task.reason.text}</p>{/if}
							{#if task.next_retry_at && task.retry_max > 0 && !task.held_for_review}<small
									>Next retry {new Date(task.next_retry_at * 1000).toLocaleString()}</small
								>{/if}
						</li>
					{/each}
				</ul>
			</section>
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
</div>
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
		gap: 0.25rem;
		padding: 0.2rem;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: var(--radius);
	}
	.views button {
		flex: 1;
		min-width: 0;
		min-height: 44px;
		padding: 0.35rem 0.3rem;
		font-size: 0.9rem;
		color: var(--text);
		border: 2px solid transparent;
		border-radius: max(2px, calc(var(--radius) - 0.2rem));
	}
	.views button[aria-selected='true'] {
		background: var(--bg);
		color: var(--text);
		border-color: currentColor;
		font-weight: 750;
	}
	.heading,
	.pagination,
	.item-line,
	.section-title,
	.title-link,
	.progress {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.heading,
	.pagination,
	.item-line {
		justify-content: space-between;
	}
	.section-title span {
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		padding: 0.12rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 99rem;
		font-weight: 600;
	}
	.pagination {
		margin-block: var(--gap);
	}
	.records {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: var(--radius);
	}
	.row {
		padding: 0.7rem 0.85rem;
		display: grid;
		gap: 0.35rem;
		min-width: 0;
	}
	.row + .row {
		border-top: 1px solid var(--line);
	}
	.item-line {
		align-items: flex-start;
	}
	.identity {
		min-width: 0;
	}
	.identity strong,
	.identity small,
	.row > small {
		display: block;
		overflow-wrap: anywhere;
	}
	.identity strong {
		font-size: 1rem;
	}
	.title-link {
		text-align: start;
		min-height: 44px;
	}
	.title-link strong {
		text-decoration: underline;
		text-underline-offset: 0.16rem;
	}
	.identity small,
	.row > small {
		color: var(--muted);
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		justify-self: start;
		font-size: 0.8rem;
		font-weight: 650;
		line-height: 1.3;
		padding: 0.24rem 0.5rem;
		border: 1px solid currentColor;
		border-radius: 99rem;
		background: var(--raised);
		color: var(--text);
	}
	.badge[data-tone='info'] {
		background: var(--color-info, var(--raised));
		color: var(--color-info-content, var(--text));
	}
	.badge[data-tone='success'] {
		background: var(--color-success, var(--raised));
		color: var(--color-success-content, var(--text));
	}
	.badge[data-tone='warning'] {
		background: var(--color-warning, var(--raised));
		color: var(--color-warning-content, var(--text));
	}
	.badge[data-tone='error'] {
		background: var(--color-error, var(--raised));
		color: var(--color-error-content, var(--text));
	}
	.progress {
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
	}
	progress {
		flex: 1;
		min-width: 0;
		height: 0.65rem;
		accent-color: var(--text);
	}
	.row .reason {
		margin: 0;
		color: var(--text);
		overflow-wrap: anywhere;
		font-size: 0.9rem;
	}
	.filters {
		margin-bottom: 0.65rem;
	}
	.filters summary {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 44px;
		width: fit-content;
		font-weight: 600;
		cursor: pointer;
	}
	.filters summary::after {
		content: '▾';
	}
	.filters[open] summary::after {
		content: '▴';
	}
	.filters > div {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0.3rem 0 0.7rem;
	}
	.filters label {
		display: grid;
		flex: 1;
		min-width: 7.5rem;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	.filters select {
		min-height: 44px;
		padding: 0.4rem;
		width: 100%;
	}
	.choices {
		display: grid;
		gap: 0.4rem;
	}
</style>
