<script lang="ts">
	import { uiText } from '../i18n';
	import { sectionTitle, type Section } from '../boards/layout';
	import { readLayoutFile, saveLayoutFile } from './layoutFiles';
	import { isPlayerGrid, GRID_COLUMNS, GRID_ROWS } from './grid';
	import { playerCanvas } from './composition';
	import { exportPlayerStyle, importPlayerStyle } from './playerStyle';
	let { sections, onload }: { sections: Section[]; onload: (sections: Section[]) => void } =
		$props();
	let open = $state(false),
		mode = $state<'export' | 'import'>('export'),
		input = $state(''),
		review = $state<Section[] | null>(null),
		error = $state(''),
		notice = $state('');
	let output = $state<HTMLTextAreaElement>();
	let chooser = $state<HTMLInputElement>();
	let saving = $state(false);
	let operation = 0;
	const exported = $derived.by(() => {
		if (!open || mode !== 'export') return { text: '', error: '' };
		try {
			return { text: exportPlayerStyle(sections), error: '' };
		} catch (cause) {
			return {
				text: '',
				error: cause instanceof Error ? cause.message : 'Could not export the layout.'
			};
		}
	});
	function tabs(next: typeof mode) {
		operation++;
		mode = next;
		error = notice = '';
		review = null;
	}
	function select() {
		if (!output) return;
		error = '';
		output.focus();
		output.select();
		output.setSelectionRange(0, output.value.length);
		notice = 'Layout text selected.';
	}
	async function copy() {
		error = '';
		try {
			await navigator.clipboard.writeText(exported.text);
			if (open && mode === 'export') notice = 'Layout copied.';
		} catch {
			if (!output || !open || mode !== 'export') return;
			select();
			notice = 'Layout text selected. Use your device’s Copy command.';
		}
	}
	function update(text: string) {
		operation++;
		input = text;
		review = null;
		error = notice = '';
	}
	function preview() {
		error = notice = '';
		try {
			review = importPlayerStyle(input);
		} catch (cause) {
			review = null;
			error = cause instanceof Error ? cause.message : 'Could not read the layout.';
		}
	}
	async function saveFile() {
		if (saving) return;
		const ticket = ++operation;
		saving = true;
		error = notice = '';
		try {
			const result = await saveLayoutFile(exported.text);
			if (ticket === operation && open)
				notice =
					result === 'saved'
						? 'Layout file saved.'
						: result === 'download'
							? 'Layout download started.'
							: 'Save cancelled.';
		} catch (cause) {
			if (ticket === operation && open)
				error = cause instanceof Error ? cause.message : 'Could not save the layout file.';
		} finally {
			saving = false;
		}
	}
	async function chooseFile(inputElement: HTMLInputElement) {
		const file = inputElement.files?.[0];
		inputElement.value = '';
		if (!file) return;
		update('');
		const ticket = operation;
		try {
			const text = await readLayoutFile(file);
			if (ticket !== operation || !open) return;
			input = text;
			preview();
		} catch (cause) {
			if (ticket === operation && open)
				error = cause instanceof Error ? cause.message : 'Could not open the layout file.';
		}
	}
	function load() {
		if (review === null) return;
		onload(review);
		review = null;
		input = '';
		notice = 'Layout loaded into the editor. Save the layout to keep it.';
	}
</script>

<details
	class="settings-disclosure"
	data-surface="panel"
	bind:open
	data-part="player-layout-sharing"
>
	<summary>{uiText('Share player layout')}</summary>
	{#if open}<div
			class="settings-tabs"
			data-surface="panel"
			role="group"
			aria-label={uiText('Layout transfer')}
		>
			<button type="button" aria-pressed={mode === 'export'} onclick={() => tabs('export')}
				>{uiText('Export')}</button
			><button type="button" aria-pressed={mode === 'import'} onclick={() => tabs('import')}
				>{uiText('Import')}</button
			>
		</div>
		{#if mode === 'export'}
			{#if exported.error}<p role="alert">{exported.error}</p>{:else}<label
					>{uiText('Current layout JSON')}<textarea
						bind:this={output}
						rows="5"
						readonly
						spellcheck="false"
						value={exported.text}
					></textarea></label
				>
				<div class="settings-actions">
					<button type="button" class="secondary" disabled={saving} onclick={saveFile}
						>{uiText('Save layout file')}</button
					>
					<button type="button" class="secondary" onclick={copy}>{uiText('Copy layout')}</button
					><button type="button" class="text-button" onclick={select}
						>{uiText('Select text')}</button
					>
				</div>{/if}
		{:else}
			<input
				hidden
				bind:this={chooser}
				type="file"
				accept=".json,application/json"
				aria-label={uiText('Layout JSON file')}
				onchange={(e) => chooseFile(e.currentTarget)}
			/>
			<button type="button" class="secondary" onclick={() => chooser?.click()}
				>{uiText('Choose layout file')}</button
			>
			<label
				>{uiText('Shared layout JSON')}<textarea
					rows="5"
					spellcheck="false"
					value={input}
					oninput={(e) => update(e.currentTarget.value)}
				></textarea></label
			><button type="button" class="secondary" disabled={!input.trim()} onclick={preview}
				>{uiText('Review imported layout')}</button
			>
			{#if review !== null}{@const hasHeader = review.some((s) => s.placement)}{@const canvas =
					playerCanvas(review)}{@const rows = hasHeader ? canvas : canvas.slice(1)}{@const count =
					rows.flat().length}
				<div class="review">
					{#if isPlayerGrid(review)}
						<p>
							{GRID_COLUMNS} × {GRID_ROWS} · {review.length}
							{uiText(review.length === 1 ? 'element' : 'elements')}
						</p>
						<ol>
							{#each [...review].sort((a, b) => a.grid!.y - b.grid!.y || a.grid!.x - b.grid!.x) as tile (tile.id)}
								<li>
									{sectionTitle(tile)} · {uiText('Column')}
									{tile.grid!.x + 1}, {uiText('Row')}
									{tile.grid!.y + 1} · {tile.grid!.w} × {tile.grid!.h}
								</li>
							{/each}
						</ol>
					{:else}<p>
							{rows.length}
							{rows.length === 1 ? uiText('row') : uiText('rows')} · {count}
							{count === 1 ? uiText('element') : uiText('elements')}
						</p>
						{#if rows.length}<ol>
								{#each rows as row, i (row[0].id)}<li>
										{#if i === 0 && hasHeader}<strong>{uiText('Header')}</strong> ·
										{/if}{row.map(sectionTitle).join(' · ')}
									</li>{/each}
							</ol>{:else}<p>{uiText('This layout has no player elements.')}</p>{/if}{/if}<button
						type="button"
						class="secondary"
						onclick={load}>{uiText('Load into editor')}</button
					>
				</div>{/if}
		{/if}{#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">
				{notice}
			</p>{/if}{/if}
</details>

<style>
	label {
		display: grid;
		gap: 0.25rem;
		margin-block: 0.5rem;
	}
	textarea {
		width: 100%;
		font-family: ui-monospace, monospace;
		resize: vertical;
	}
	.review {
		margin-block: var(--gap);
		overflow-wrap: anywhere;
	}
	.review p,
	.review ol {
		margin-block: 0.35rem;
	}
</style>
