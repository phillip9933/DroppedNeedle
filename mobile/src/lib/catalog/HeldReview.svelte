<script lang="ts">
	import { uiText } from '../i18n';
	import { onMount } from 'svelte';
	import {
		ArrowDownToLine,
		ChevronRight,
		Disc3,
		FileAudio,
		FileInput,
		Fingerprint,
		FolderOpen,
		Link2,
		RefreshCw,
		Replace,
		Search,
		Trash2,
		TriangleAlert
	} from '@lucide/svelte';
	import { type Session } from '../connection';
	import { errorMessage } from './catalog';
	import type { Viewer } from './requestActions';
	import {
		actionNames,
		actOnHeld,
		curator,
		entryTitle,
		heldEntries,
		matchAlbums,
		recheckEntries,
		offered,
		type HeldAction,
		type HeldEntry,
		type HeldFile,
		type MatchAlbum
	} from './heldReview';
	import ReviewSheet from './ReviewSheet.svelte';
	import HeldAudition from './HeldAudition.svelte';
	import HeldEditionCheck from './HeldEditionCheck.svelte';
	let {
		session,
		viewer,
		taskId,
		title = '',
		onclose
	}: {
		session: Session;
		viewer: Viewer;
		taskId?: string;
		title?: string;
		onclose: () => void;
	} = $props();
	let entries = $state<HeldEntry[]>([]),
		current = $state<number | null>(null),
		checked = $state<number[]>([]);
	let step = $state<'files' | 'match' | 'confirm' | 'edition' | 'bulk'>('files'),
		choice = $state<HeldAction>('import'),
		selectedAlbum = $state<MatchAlbum | null>(null);
	let term = $state(''),
		matches = $state<MatchAlbum[]>([]),
		searched = $state(false),
		searching = $state(false),
		sequence = 0;
	let error = $state(''),
		receipt = $state(''),
		loading = $state(true),
		saving = $state(false),
		alive = true;
	let editionBusy = $state(false);
	const entry = $derived(entries.find((item) => item.id === current));
	const files = $derived((entry?.files || []).filter((f) => checked.includes(f.id)));
	const editionIds = $derived(
		files.filter((f) => f.reason === 'album_needs_check').map((f) => f.id)
	);
	const eligible = (action: HeldAction) =>
		entry ? files.filter((f) => offered(entry!, f, action, viewer)) : [];
	const recheckIds = $derived(
		entries.filter((e) => e.files.some((f) => offered(e, f, 'recheck', viewer))).map((e) => e.id)
	);
	const selectedFiles = $derived(eligible(choice));
	const origins = { download: 'Download', upload: 'Upload', import_folder: 'Import folder' };
	const actionIcons = {
		import: FileInput,
		retry: RefreshCw,
		use_this_version: Replace,
		use_this_file: FileAudio,
		recheck: Fingerprint,
		get_from_album: ArrowDownToLine,
		discard: Trash2,
		match: Link2
	};
	const confirmTitles: Record<HeldAction, string> = {
		import: 'Import selected files?',
		retry: 'Retry the import?',
		use_this_version: 'Replace the library version?',
		use_this_file: 'Replace the library file?',
		recheck: 'Recheck fingerprints?',
		get_from_album: 'Request from the album?',
		discard: 'Discard selected files?',
		match: 'Confirm album match'
	};
	const rootTitle = $derived(title ? 'Held files for ' + title : 'Held files');
	const context = $derived.by(() => {
		if (!entry) return '';
		if (step === 'files')
			return [entry.artist_name, origins[entry.origin]].filter(Boolean).join(' · ');
		if (step === 'edition')
			return [entryTitle(entry), entry.artist_name].filter(Boolean).join(' · ');
		return entryTitle(entry);
	});
	const heading = $derived(
		step === 'bulk'
			? 'Recheck held fingerprints?'
			: step === 'confirm'
				? confirmTitles[choice]
				: step === 'match'
					? 'Match to an album'
					: step === 'edition'
						? 'Check album edition'
						: entry
							? entryTitle(entry)
							: rootTitle
	);
	function select(item: HeldEntry) {
		current = item.id;
		checked = item.files.map((f) => f.id);
		step = 'files';
		error = '';
	}
	function back() {
		if (saving || editionBusy) return;
		error = '';
		if (step === 'bulk') {
			step = 'files';
			return;
		}
		if (step === 'confirm') {
			step = choice === 'match' ? 'match' : 'files';
			return;
		}
		if (step === 'match' || step === 'edition') {
			step = 'files';
			sequence++;
			searching = false;
			return;
		}
		if (entry && (!taskId || entries.length > 1)) {
			current = null;
			return;
		}
		onclose();
	}
	async function load(initial = false) {
		loading = true;
		error = '';
		try {
			const response = await heldEntries(session, viewer, taskId);
			if (!alive) return;
			entries = response.entries
				.map((item) => ({
					...item,
					files: item.files
						.filter((f) => !taskId || f.source_task_id === taskId)
						.sort(
							(a, b) =>
								(a.disc_number ?? 1) - (b.disc_number ?? 1) ||
								(a.track_number ?? 0) - (b.track_number ?? 0) ||
								a.id - b.id
						)
				}))
				.filter((item) => item.files.length);
			const fresh = entries.find((item) => item.id === current);
			if (fresh) checked = checked.filter((id) => fresh.files.some((f) => f.id === id));
			else if (initial && taskId && entries.length === 1) select(entries[0]);
			else current = null;
		} catch (e) {
			if (alive) {
				entries = [];
				current = null;
				error = errorMessage(e);
			}
		} finally {
			if (alive) loading = false;
		}
	}
	function toggle(file: HeldFile) {
		checked = checked.includes(file.id)
			? checked.filter((id) => id !== file.id)
			: [...checked, file.id];
		receipt = '';
	}
	function choose(action: HeldAction) {
		choice = action;
		selectedAlbum = null;
		error = '';
		receipt = '';
		if (action === 'match' && entry) {
			step = 'match';
			term = entryTitle(entry);
			matches = [];
			searched = false;
			void search();
		} else step = 'confirm';
	}
	async function search() {
		const seq = ++sequence;
		matches = [];
		searched = false;
		error = '';
		if (term.trim().length < 2) {
			searching = false;
			return;
		}
		searching = true;
		try {
			const result = await matchAlbums(session, term);
			if (seq === sequence && alive) {
				matches = result;
				searched = true;
			}
		} catch (e) {
			if (seq === sequence && alive) error = errorMessage(e);
		} finally {
			if (seq === sequence && alive) searching = false;
		}
	}
	async function confirm() {
		if (!entry || !selectedFiles.length || saving) return;
		saving = true;
		error = '';
		try {
			const result = await actOnHeld(
				session,
				viewer,
				entry,
				selectedFiles,
				choice,
				selectedAlbum ?? undefined
			);
			if (alive) {
				receipt = result;
				step = 'files';
				await load();
			}
		} catch (e) {
			if (alive) {
				step = 'files';
				await load();
				error = errorMessage(e);
			}
		} finally {
			if (alive) saving = false;
		}
	}
	async function bulk() {
		if (saving || taskId || !recheckIds.length) return;
		saving = true;
		try {
			const result = await recheckEntries(session, recheckIds);
			if (alive) {
				receipt = result;
				step = 'files';
				await load();
			}
		} catch (e) {
			if (alive) {
				step = 'files';
				await load();
				error = errorMessage(e);
			}
		} finally {
			if (alive) saving = false;
		}
	}

	function effect(action: HeldAction) {
		switch (action) {
			case 'use_this_file':
			case 'use_this_version':
				return 'Replace the current library copy with the held file. DN moves the previous copy to the recycle bin.';
			case 'discard':
				return entry?.origin === 'import_folder'
					? 'Permanently delete these original files from the import folder.'
					: 'Delete the selected held copies. DN can resume automatic download retries.';
			case 'match':
				return (
					'Import the selected files as ' +
					selectedAlbum?.title +
					(selectedAlbum?.artist ? ' by ' + selectedAlbum.artist : '') +
					'.'
				);
			case 'recheck':
				return 'Ask DN to identify these files again. Matches can enter the library.';
			case 'get_from_album':
				return 'Ask DN to fetch this recording from its album.';
			case 'retry':
				return 'Ask DN to try importing these files again.';
			default:
				return 'Import the selected files despite the check that held them. DN still compares them with your current copies.';
		}
	}
	onMount(() => {
		void load(true);
		return () => {
			alive = false;
			sequence++;
		};
	});
</script>

<ReviewSheet
	title={heading}
	{context}
	backLabel={step === 'confirm'
		? 'Back to review'
		: entry && !taskId
			? 'Back to held files'
			: 'Back'}
	onback={back}
	busy={saving || editionBusy}
>
	{#if receipt}<p role="status">{receipt}</p>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
	{#if loading}<p role="status">{uiText('Loading held files…')}</p>
	{:else if step === 'bulk'}
		<p>
			{uiText(
				'Ask DN to check up to 25 eligible files. Identified recordings can enter the library.'
			)}
		</p>
		<button class="primary" disabled={saving} onclick={bulk}>{uiText('Confirm recheck')}</button>
	{:else if !entry}
		{#if entries.length}
			<div class="settings-list" data-surface="panel">
				{#each entries as item (item.id)}
					<button class="settings-entry" onclick={() => select(item)}>
						<FolderOpen size={20} aria-hidden="true" />
						<span
							><strong>{entryTitle(item)}</strong>
							<small class="review-meta"
								>{[
									item.artist_name,
									origins[item.origin],
									item.files.length + (item.files.length === 1 ? ' file' : ' files')
								]
									.filter(Boolean)
									.join(' · ')}</small
							></span
						>
						<ChevronRight size={18} aria-hidden="true" />
					</button>
				{/each}
			</div>
		{:else if !error}<p>{uiText('No held files to review.')}</p>{/if}
		<div class="settings-actions">
			{#if !taskId && recheckIds.length}<button
					class="secondary"
					onclick={() => {
						receipt = '';
						step = 'bulk';
					}}
					><Fingerprint size={18} aria-hidden="true" />{uiText('Recheck held fingerprints')}</button
				>{/if}
			<button class="text-button" onclick={() => load(true)}
				><RefreshCw size={17} aria-hidden="true" />{uiText('Refresh held files')}</button
			>
		</div>
	{:else if step === 'edition'}
		<HeldEditionCheck
			{session}
			{entry}
			fileIds={editionIds}
			onbusy={(v: boolean) => {
				editionBusy = v;
			}}
			ondone={(result) => {
				receipt = result;
				step = 'files';
				void load();
			}}
		/>
	{:else if step === 'confirm'}
		<p>{effect(choice)}</p>
		<ul class="review-files">
			{#each selectedFiles as file (file.id)}<li>{file.original_name}</li>{/each}
		</ul>
		<button
			class="primary"
			class:destructive={choice === 'discard'}
			disabled={saving}
			onclick={confirm}
			>{saving ? uiText('Working…') : 'Confirm ' + actionNames[choice].toLowerCase()}</button
		>
	{:else if step === 'match'}
		<form
			class="settings-panel"
			data-surface="panel"
			onsubmit={(e) => {
				e.preventDefault();
				void search();
			}}
		>
			<label
				>{uiText('Album or artist')}<input
					type="search"
					bind:value={term}
					oninput={() => {
						sequence++;
						matches = [];
						searched = false;
						searching = false;
					}}
				/></label
			>
			<button class="secondary" disabled={term.trim().length < 2}
				><Search size={18} aria-hidden="true" />{uiText('Search albums')}</button
			>
		</form>
		{#if searching}<p role="status">{uiText('Searching albums…')}</p>
		{:else if searched && !matches.length}<p>{uiText('No albums found.')}</p>{/if}
		{#if matches.length}
			<div class="settings-list" data-surface="panel">
				{#each matches as album (album.musicbrainz_id)}
					<button
						class="settings-entry"
						onclick={() => {
							selectedAlbum = album;
							step = 'confirm';
						}}
					>
						<Disc3 size={20} aria-hidden="true" />
						<span
							><strong>{album.title}</strong><small class="review-meta"
								>{[album.artist, album.year].filter(Boolean).join(' · ')}</small
							></span
						>
						<ChevronRight size={18} aria-hidden="true" />
					</button>
				{/each}
			</div>
		{/if}
	{:else}
		{#if entry.state !== 'held'}<p role="status">
				{uiText('DN is already handling these files.')}
			</p>{/if}
		{#if entry.expires_at || entry.next_retry_at}<div class="review-meta">
				{#if entry.expires_at}{uiText('Kept until')}
					{new Date(entry.expires_at).toLocaleString()}{/if}
				{#if entry.next_retry_at}<div>
						{uiText('Next automatic retry')}
						{new Date(entry.next_retry_at).toLocaleString()}
					</div>{/if}
			</div>{/if}
		<section class="review-section" aria-label={uiText('Files to review')}>
			<div class="files-heading">
				<h3 class="review-heading">{uiText('Files to review')}</h3>
				{#if entry.files.length > 1}<button
						class="text-button"
						onclick={() =>
							(checked =
								checked.length === entry!.files.length ? [] : entry!.files.map((f) => f.id))}
						>{checked.length === entry.files.length
							? uiText('Clear selection')
							: uiText('Select all files')}</button
					>{/if}
			</div>
			<div class="settings-list" data-surface="panel">
				{#each entry.files as file (file.id)}
					<article class="held-file">
						<label class="pick"
							><input
								type="checkbox"
								checked={checked.includes(file.id)}
								onchange={() => toggle(file)}
							/><strong>{file.track_title || file.original_name}</strong></label
						>
						{#if file.track_title && file.original_name !== file.track_title}<small
								>{file.original_name}</small
							>{/if}
						{#if file.reason_text || file.reason_action}<p class="hold-reason">
								<TriangleAlert size={16} aria-hidden="true" /><span
									>{file.reason_text} {file.reason_action}</span
								>
							</p>{/if}
						{#if file.duration_seconds || file.expected_duration_seconds}<small
								>{[
									file.duration_seconds &&
										'File length ' + Math.round(file.duration_seconds) + ' s',
									file.expected_duration_seconds &&
										'Expected ' + Math.round(file.expected_duration_seconds) + ' s'
								]
									.filter(Boolean)
									.join(' · ')}</small
							>{/if}
						{#if file.reason_detail}<small>{file.reason_detail}</small>{/if}
						{#if file.evidence_title || file.evidence_artist}<small
								>{uiText('Identified as')}
								{[file.evidence_title, file.evidence_artist].filter(Boolean).join(' · ')}</small
							>{/if}
						<HeldAudition
							{session}
							fileId={file.id}
							name={file.track_title || file.original_name}
						/>
					</article>
				{/each}
			</div>
		</section>
		{#if entry.state === 'held'}
			<section class="review-section" aria-label={uiText('File actions')}>
				<h3 class="review-heading">
					{uiText('Actions for selected files')} <span class="review-count">{files.length}</span>
				</h3>
				{#if files.length}
					<div class="settings-list" data-surface="panel">
						{#if curator(viewer) && entry.check_album_id && editionIds.length}<button
								class="settings-entry"
								onclick={() => (step = 'edition')}
								><Disc3 size={18} aria-hidden="true" /><span>{uiText('Check album edition')}</span
								><ChevronRight size={16} aria-hidden="true" /></button
							>{/if}
						{#each Object.keys(actionNames) as key (key)}
							{@const action = key as HeldAction}
							{@const count = eligible(action).length}
							{@const Icon = actionIcons[action]}
							{#if count && (action !== 'get_from_album' || count === 1)}
								<button
									class="settings-entry"
									class:discard={action === 'discard'}
									onclick={() => choose(action)}
								>
									<Icon size={18} aria-hidden="true" /><span>{actionNames[action]} ({count})</span
									><ChevronRight size={16} aria-hidden="true" />
								</button>
							{/if}
						{/each}
					</div>
				{:else}<small class="review-meta">{uiText('Select a file to see its actions.')}</small>{/if}
			</section>
		{/if}
	{/if}
</ReviewSheet>

<style>
	.files-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0 0.6rem;
	}
	.held-file {
		padding: 0.55rem var(--gap);
	}
	.held-file > small {
		display: block;
		color: var(--muted);
		font-size: 0.87rem;
		line-height: 1.45;
	}
	.hold-reason {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		margin: 0.35rem 0;
	}
	.hold-reason :global(svg) {
		margin-top: 0.2em;
		color: color-mix(in srgb, var(--color-warning) 60%, var(--text));
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-height: 44px;
		cursor: pointer;
	}
	.pick strong {
		font-weight: 600;
	}
	.pick input {
		width: 1.1rem;
		height: 1.1rem;
		padding: 0;
		margin: 0;
		accent-color: var(--accent);
		flex: none;
	}
	form input {
		width: 100%;
		min-width: 0;
	}
	form button {
		justify-self: start;
	}
	.discard > :global(svg:first-child) {
		color: color-mix(in srgb, var(--color-error) 65%, var(--text));
	}
	.destructive {
		--action-fill: var(--color-error);
		--dn-action: var(--color-error);
		--dn-action-edge: var(--color-error);
		--dn-action-content: var(--color-error-content);
	}
</style>
