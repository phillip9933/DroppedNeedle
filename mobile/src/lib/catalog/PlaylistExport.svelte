<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { Session } from '../connection';
	import { errorMessage } from './catalog';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import {
		prepareExport,
		exportPrefix,
		keepExportPrefix,
		readExportPrefix,
		type ExportFormat,
		type PreparedExport
	} from './playlistExport';
	let {
		session,
		playlist,
		onclose,
		onsaved
	}: {
		session: Session;
		playlist: { id: string; name: string };
		onclose: () => void;
		onsaved: (message: string) => void;
	} = $props();
	let format = $state<ExportFormat>('m3u8'),
		prefix = $state(untrack(() => readExportPrefix(session))),
		busy = $state(false),
		issue = $state(''),
		file = $state.raw<PreparedExport>();
	let work: AbortController | undefined;
	onDestroy(() => {
		work?.abort();
		file?.discard();
	});
	function cancel() {
		work?.abort();
		file?.discard();
		onclose();
	}
	async function submit() {
		if (busy) return;
		issue = '';
		busy = true;
		const controller = work ?? new AbortController();
		work = controller;
		try {
			const trimmed = exportPrefix(prefix);
			if (!file) {
				file = await prepareExport(session, playlist, format, trimmed, controller.signal);
				if (file.choose) return;
			}
			const result = await file.save();
			controller.signal.throwIfAborted();
			if (result === 'cancelled') {
				onclose();
				return;
			}
			keepExportPrefix(session, trimmed);
			const summary =
				file.skipped === null
					? 'DN’s skipped-track count is unavailable.'
					: file.skipped === 0
						? 'No tracks skipped.'
						: file.skipped.toLocaleString() +
							' ' +
							(file.skipped === 1 ? 'track skipped' : 'tracks skipped') +
							' because DN had no exportable file.';
			onsaved(
				(result === 'download' ? 'Download started for ' : 'Saved ') +
					file.filename +
					'. ' +
					summary
			);
		} catch (cause) {
			if (!controller.signal.aborted) {
				file?.discard();
				file = undefined;
				issue = errorMessage(cause);
			}
		} finally {
			busy = false;
		}
	}
</script>

<PlaylistDialog title="Export playlist" onclose={cancel}>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void submit();
		}}
	>
		{#if file && file.choose}<p>{file.filename}</p>
		{:else}<label
				>File format<select bind:value={format} disabled={busy}
					><option value="m3u8">M3U8 playlist</option><option value="csv">CSV spreadsheet</option
					></select
				></label
			>
			<label
				>Path prefix (optional)<input
					bind:value={prefix}
					disabled={busy}
					placeholder="Music/"
					autocomplete="off"
				/></label
			>
			<small>DN uses paths relative to its music library. The prefix goes before each path.</small
			>{/if}
		{#if issue}<p role="alert">{issue}</p>{/if}
		{#if busy}<p role="status">{file ? 'Saving playlist…' : 'Preparing playlist…'}</p>{/if}
		<div class="actions">
			<button type="button" class="secondary" onclick={cancel}>Cancel</button><button
				type="submit"
				class="primary"
				disabled={busy}>{file?.choose ? 'Choose destination' : 'Export file'}</button
			>
		</div>
	</form>
</PlaylistDialog>

<style>
	form {
		display: grid;
		gap: 0.75rem;
	}
	label {
		display: grid;
		gap: 0.3rem;
	}
	small {
		color: var(--muted);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
</style>
