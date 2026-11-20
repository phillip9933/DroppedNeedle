<script lang="ts">
	import { Upload } from '@lucide/svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { postJson, type Session } from '../connection';
	import { errorMessage, path } from './catalog';
	import PlaylistDialog from './PlaylistDialog.svelte';
	type S = components['schemas'];
	let {
		session,
		onimport,
		compact = false
	}: { session: Session; onimport: () => void; compact?: boolean } = $props();
	let open = $state(false),
		file = $state<File>(),
		name = $state(''),
		busy = $state(false),
		error = $state('');
	let report = $state<S['ImportPlaylistResponse']>();
	const reasons: Record<S['ImportUnmatchedReason'], string> = {
		names_nothing: 'No filename',
		no_match: 'No matching local file',
		duplicate: 'Duplicate entry'
	};
	function pick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		file = undefined;
		name = error = '';
		const choice = input.files?.[0];
		if (!choice) return;
		if (!/\.(csv|m3u8?)$/i.test(choice.name)) error = 'Choose an M3U, M3U8 or CSV file.';
		else if (choice.size > 2 * 1024 ** 2) error = 'Choose a file up to 2 MiB.';
		else {
			file = choice;
			name = choice.name.replace(/\.(csv|m3u8?)$/i, '').trim() || 'Imported playlist';
		}
	}
	async function submit() {
		if (!file || !name.trim() || busy || report) return;
		busy = true;
		error = '';
		try {
			const body: S['ImportPlaylistBody'] = {
				name: name.trim(),
				format: /\.csv$/i.test(file.name) ? 'csv' : 'm3u8',
				content: await file.text()
			};
			report = await postJson<S['ImportPlaylistResponse']>(
				session,
				path('/api/v3/playlists/import'),
				body
			);
			onimport();
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			busy = false;
		}
	}
	function start() {
		file = report = undefined;
		name = error = '';
		open = true;
	}
</script>

<button class="text-button" class:import-pill={compact} aria-label="Import playlist" onclick={start}
	><Upload size={18} />{compact ? 'Import' : 'Import playlist'}</button
>
{#if open}
	<PlaylistDialog
		title={report ? 'Playlist imported' : 'Import playlist'}
		onclose={() => (open = false)}
		{busy}
	>
		{#if report}
			<p>
				<strong>{report.name}</strong> · {report.matched}
				{report.matched === 1 ? 'track' : 'tracks'} added
			</p>
			{#if report.unmatched.length}<details>
					<summary>Unmatched entries ({report.unmatched.length})</summary>
					<ul>
						{#each report.unmatched.slice(0, 200) as row, i (i)}<li>
								<strong>{row.title || 'Untitled'}</strong>{row.artist ? ' · ' + row.artist : ''} · {reasons[
									row.reason
								]}
							</li>{/each}
					</ul>
					{#if report.unmatched.length > 200}<p>Showing the first 200 entries.</p>{/if}
				</details>{/if}
			{#if report.over_limit}<p>
					{report.over_limit} entries exceeded DN’s 10,000-entry import limit.
				</p>{/if}
			<button class="secondary" onclick={() => (open = false)}>Done</button>
		{:else}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<label
					>Playlist file<input
						type="file"
						accept=".m3u,.m3u8,.csv"
						disabled={busy}
						onchange={pick}
					/></label
				>
				{#if file}<label>Playlist name<input required bind:value={name} disabled={busy} /></label
					>{/if}
				<p>DN matches entries against files in your server’s library.</p>
				{#if error}<p role="alert">{error}</p>{/if}
				<div class="actions">
					<button class="secondary" type="button" disabled={busy} onclick={() => (open = false)}
						>Cancel</button
					><button class="primary" disabled={busy || !file || !name.trim()}
						>{busy ? 'Importing…' : 'Create from file'}</button
					>
				</div>
			</form>
		{/if}
	</PlaylistDialog>
{/if}
