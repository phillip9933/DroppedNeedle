<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';
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
	context={entry && step !== 'files' ? entryTitle(entry) : entry?.artist_name || ''}
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
	{#if loading}<p role="status">Loading held files…</p>
	{:else if step === 'bulk'}
		<p>Ask DN to check up to 25 eligible files. Identified recordings can enter the library.</p>
		<button class="primary" disabled={saving} onclick={bulk}>Confirm recheck</button>
	{:else if !entry}
		{#if !taskId && recheckIds.length}<button
				class="secondary"
				onclick={() => {
					receipt = '';
					step = 'bulk';
				}}>Recheck held fingerprints</button
			>{/if}
		{#each entries as item (item.id)}
			<button class="entry" onclick={() => select(item)}
				><span
					><strong>{entryTitle(item)}</strong><small
						>{[item.artist_name, item.origin.replace('_', ' '), item.files.length + ' files']
							.filter(Boolean)
							.join(' · ')}</small
					></span
				><ChevronRight size={18} /></button
			>
		{:else}{#if !error}<p>No held files to review.</p>{/if}{/each}
		<button class="secondary" onclick={() => load(true)}>Refresh held files</button>
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
		<ul>
			{#each selectedFiles as file (file.id)}<li>{file.original_name}</li>{/each}
		</ul>
		<button class="primary" disabled={saving} onclick={confirm}
			>{saving ? 'Working…' : 'Confirm ' + actionNames[choice].toLowerCase()}</button
		>
	{:else if step === 'match'}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				void search();
			}}
		>
			<label
				>Album or artist<input
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
			<button class="secondary" disabled={term.trim().length < 2}>Search albums</button>
		</form>
		{#if searching}<p role="status">Searching albums…</p>
		{:else if searched && !matches.length}<p>No albums found.</p>{/if}
		{#each matches as album (album.musicbrainz_id)}
			<button
				class="entry"
				onclick={() => {
					selectedAlbum = album;
					step = 'confirm';
				}}
				><span
					><strong>{album.title}</strong><small
						>{[album.artist, album.year].filter(Boolean).join(' · ')}</small
					></span
				><ChevronRight size={18} /></button
			>
		{/each}
	{:else}
		{#if entry.state !== 'held'}<p role="status">DN is already handling these files.</p>{/if}
		<small
			>{entry.origin.replace('_', ' ')}{#if entry.expires_at}
				· Kept until {new Date(entry.expires_at).toLocaleString()}{/if}</small
		>
		{#if entry.next_retry_at}<p>
				Next automatic retry {new Date(entry.next_retry_at).toLocaleString()}
			</p>{/if}
		{#if entry.files.length > 1}<button
				class="text-button"
				onclick={() =>
					(checked = checked.length === entry!.files.length ? [] : entry!.files.map((f) => f.id))}
				>{checked.length === entry.files.length ? 'Clear selection' : 'Select all files'}</button
			>{/if}
		{#each entry.files as file (file.id)}
			<article>
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
				<p>{file.reason_text} {file.reason_action}</p>
				{#if file.duration_seconds || file.expected_duration_seconds}<small
						>{[
							file.duration_seconds && 'File length ' + Math.round(file.duration_seconds) + ' s',
							file.expected_duration_seconds &&
								'Expected ' + Math.round(file.expected_duration_seconds) + ' s'
						]
							.filter(Boolean)
							.join(' · ')}</small
					>{/if}
				{#if file.reason_detail}<small>{file.reason_detail}</small>{/if}
				{#if file.evidence_title || file.evidence_artist}<small
						>Identified as {[file.evidence_title, file.evidence_artist]
							.filter(Boolean)
							.join(' · ')}</small
					>{/if}
				<HeldAudition {session} fileId={file.id} name={file.track_title || file.original_name} />
			</article>
		{/each}
		{#if entry.state === 'held'}
			<h3>Actions for selected files ({files.length})</h3>
			<div class="actions">
				{#if curator(viewer) && entry.check_album_id && editionIds.length}<button
						class="secondary"
						onclick={() => {
							step = 'edition';
						}}>Check album edition</button
					>{/if}
				{#each Object.keys(actionNames) as key (key)}
					{@const action = key as HeldAction}
					{@const count = eligible(action).length}
					{#if count && (action !== 'get_from_album' || count === 1)}
						<button class="secondary" onclick={() => choose(action)}
							>{actionNames[action]} ({count})</button
						>
					{/if}
				{/each}
			</div>
		{/if}
	{/if}
</ReviewSheet>

<style>
	.entry {
		display: flex;
		width: 100%;
		min-height: 52px;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		text-align: start;
		padding: 0.65rem 0.3rem;
		border-bottom: 1px solid var(--line);
	}
	small {
		color: var(--muted);
		display: block;
		overflow-wrap: anywhere;
	}
	.entry span,
	article,
	li {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	article {
		border-bottom: 1px solid var(--line);
		padding: 0.5rem 0;
	}
	article p {
		margin: 0.3rem 0;
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 44px;
	}
	.pick input {
		width: 1.15rem;
		height: 1.15rem;
		flex: none;
	}
	form label {
		display: grid;
		gap: 0.3rem;
	}
	form input {
		width: 100%;
	}
	form button {
		margin: 0.5rem 0;
	}
	h3 {
		font-size: 1rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
</style>
