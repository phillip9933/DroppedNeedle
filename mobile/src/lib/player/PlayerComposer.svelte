<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Plus, X } from '@lucide/svelte';
	import { available, defaults, sectionTitle, type Section } from '../boards/layout';
	import { playerWidgets } from './layout';
	import PlayerStyleTransfer from './PlayerStyleTransfer.svelte';
	import {
		defaultPlayerText,
		flattenPlayerRows,
		isPlayerText,
		nextTextId,
		playerRows,
		playerTokens,
		sideBySidePlayer,
		splitAvailable,
		splitPlayerSection
	} from './composition';

	let {
		sections,
		onback,
		onsave
	}: {
		sections: Section[];
		onback: () => void;
		onsave: (sections: Section[]) => void;
	} = $props();
	let rows = $state<Section[][]>(untrack(() => playerRows(sections.map((s) => ({ ...s })))));
	let selected = $state(''),
		query = $state(''),
		error = $state(''),
		status = $state('');
	let swapTarget = $state<number | null>(null);
	let list: HTMLOListElement;
	let templateInput = $state<HTMLTextAreaElement>();
	const rowIndex = $derived(rows.findIndex((row) => row.some((s) => s.id === selected)));
	const column = $derived(rows[rowIndex]?.findIndex((s) => s.id === selected) ?? -1);
	const field = $derived(rows[rowIndex]?.[column]);
	const used = $derived(new Set(rows.flat().map((s) => s.id)));
	const options = $derived(
		available('player').filter(
			(w) =>
				(isPlayerText(w.id) || !used.has(w.id)) &&
				w.label.toLowerCase().includes(query.trim().toLowerCase())
		)
	);
	const widget = $derived(playerWidgets.find((w) => w.id === field?.id));

	function select(id: string) {
		selected = id;
		swapTarget = null;
		error = '';
	}
	async function focusField(id: string) {
		await tick();
		list
			?.querySelector<HTMLButtonElement>('[data-section-id="' + CSS.escape(id) + '"] .field')
			?.focus();
	}
	function add(id: string) {
		const item: Section = {
			id: isPlayerText(id) ? nextTextId(rows.flat()) : id,
			title: '',
			preview: playerWidgets.find((w) => w.id === id)?.enabled ?? true
		};
		rows = [...rows, [item]];
		select(item.id);
		status = sectionTitle(item) + ' added in row ' + rows.length + '.';
		void focusField(item.id);
	}
	function remove(r: number, c: number) {
		const item = rows[r][c];
		rows = rows
			.map((row, i) => (i === r ? row.filter((_, j) => j !== c) : row))
			.filter((row) => row.length);
		if (item.id === selected) select('');
		status = sectionTitle(item) + ' removed.';
		const next = rows[r]?.[Math.min(c, rows[r].length - 1)] ?? rows.at(-1)?.at(-1);
		if (next) void focusField(next.id);
	}
	function moveRow(from: number, to: number) {
		if (to < 0 || to >= rows.length || from === to) return;
		const next = [...rows];
		next.splice(to, 0, ...next.splice(from, 1));
		rows = next;
		swapTarget = null;
		status = 'Row moved to position ' + (to + 1) + '.';
	}
	function shift(step: number) {
		if (!field) return;
		const target = column + step,
			row = [...rows[rowIndex]];
		if (target < 0 || target >= row.length) return;
		row.splice(target, 0, ...row.splice(column, 1));
		rows = rows.map((value, i) => (i === rowIndex ? row : value));
		swapTarget = null;
		status = sectionTitle(field) + ' moved to column ' + (target + 1) + '.';
	}
	function moveField(value: string) {
		if (!field) return;
		swapTarget = null;
		const to = value === 'new' ? rows.length : Number(value);
		if (to === rowIndex) return;
		if (rows[to]?.length === 3) {
			swapTarget = to;
			return;
		}
		const moved = field;
		const next = rows.map((row) => [...row]);
		next[rowIndex].splice(column, 1);
		if (to === next.length) next.push([moved]);
		else next[to].push(moved);
		rows = next.filter((row) => row.length);
		status =
			sectionTitle(moved) +
			' moved to row ' +
			(rows.findIndex((row) => row.includes(moved)) + 1) +
			'.';
		void focusField(moved.id);
	}
	function swapWith(col: number) {
		if (!field || swapTarget === null || !rows[swapTarget]?.[col]) return;
		const moved = field,
			next = rows.map((row) => [...row]);
		next[rowIndex][column] = next[swapTarget][col];
		next[swapTarget][col] = moved;
		rows = next;
		status =
			sectionTitle(moved) + ' moved to row ' + (swapTarget + 1) + ', column ' + (col + 1) + '.';
		swapTarget = null;
		void focusField(moved.id);
	}
	function split() {
		if (!field) return;
		const flat = flattenPlayerRows(rows),
			at = flat.findIndex((s) => s.id === selected),
			original = flat[at];
		const parts = splitPlayerSection(original).filter((s) => !used.has(s.id));
		if (!parts.length) {
			remove(rowIndex, column);
			return;
		}
		parts[0].sameRow = original.sameRow;
		flat.splice(at, 1, ...parts);
		rows = playerRows(flat);
		select(parts[0].id);
		status = sectionTitle(original) + ' split into separate fields.';
		void focusField(selected);
	}
	async function insertToken(token: string) {
		if (!field || !templateInput) return;
		const input = templateInput,
			value = field.template ?? defaultPlayerText,
			text = '{' + token + '}';
		const start = input.selectionStart,
			end = input.selectionEnd;
		if (value.length - (end - start) + text.length > 512) return;
		field.template = value.slice(0, start) + text + value.slice(end);
		await tick();
		input.focus();
		input.setSelectionRange(start + text.length, start + text.length);
	}
	function save() {
		try {
			onsave(flattenPlayerRows(rows));
		} catch {
			error = 'Could not save this layout on the device. Your edits are still here.';
		}
	}
	function loadDraft(items: Section[], message: string) {
		rows = playerRows(items);
		select('');
		query = '';
		status = message;
	}
</script>

<div class="composer" data-part="layout-editor">
	<div class="bar">
		<button class="text-button" onclick={onback}>Cancel</button><button
			class="primary"
			onclick={save}>Save layout</button
		>
	</div>
	<h1>Edit Now Playing</h1>
	{#if error}<p role="alert">{error}</p>{/if}
	<p class="sr-only" role="status">{status}</p>
	<h2>Player layout</h2>
	{#if !rows.length}<p>Add a field below to start your layout.</p>{/if}
	<ol class="rows" bind:this={list} aria-label="Player layout rows">
		{#each rows as row, r (row
			.map((s) => s.id)
			.sort()
			.join('/'))}
			<li class="row" data-player-row={r}>
				<div class="rowbar">
					<h3>Row {r + 1}</h3>
					<button
						class="tool"
						aria-label={'Move row ' + (r + 1) + ' up'}
						disabled={r === 0}
						onclick={() => moveRow(r, r - 1)}><ArrowUp size={17} /></button
					>
					<button
						class="tool"
						aria-label={'Move row ' + (r + 1) + ' down'}
						disabled={r === rows.length - 1}
						onclick={() => moveRow(r, r + 1)}><ArrowDown size={17} /></button
					>
				</div>
				<div
					class="grid"
					style:grid-template-columns={row
						.map((s) => 'minmax(46px,' + (s.width ?? 1) + 'fr)')
						.join(' ')}
				>
					{#each row as item, c (item.id)}
						{@const label = sectionTitle(item)}
						<div
							class="cell"
							class:solo={row.length === 1}
							class:current={selected === item.id}
							data-section-id={item.id}
						>
							<button
								class="field"
								aria-label={'Customize ' + label}
								aria-expanded={selected === item.id}
								style:text-align={item.align ?? 'start'}
								data-size={item.textSize ?? 'normal'}
								onclick={() => select(selected === item.id ? '' : item.id)}>{label}</button
							>
							<button
								class="tool remove"
								aria-label={'Remove ' + label}
								onclick={() => remove(r, c)}><X size={16} /></button
							>
						</div>
					{/each}
				</div>
				{#if r === rowIndex && field}
					<div class="inspector" role="group" aria-label={'Customize ' + sectionTitle(field)}>
						<label
							>Section title<input
								maxlength="64"
								placeholder={sectionTitle({ ...field, title: '' })}
								bind:value={field.title}
							/></label
						>
						{#if isPlayerText(field.id)}
							<label
								>Text template<textarea
									bind:this={templateInput}
									maxlength="512"
									rows="2"
									value={field.template ?? defaultPlayerText}
									oninput={(e) => {
										if (field) field.template = e.currentTarget.value;
									}}
								></textarea></label
							>
							<div class="tokens" role="group" aria-label="Insert track information">
								{#each playerTokens as token (token)}<button
										aria-label={'Insert {' + token + '}'}
										onclick={() => insertToken(token)}>{'{' + token + '}'}</button
									>{/each}
							</div>
						{/if}
						<div class="pair">
							<label
								>Move to row<select
									aria-label="Move to row"
									value={swapTarget ?? rowIndex}
									onchange={(e) => moveField(e.currentTarget.value)}
								>
									{#each rows as dest, i (i)}<option value={i}
											>Row {i + 1}{dest.length === 3 && i !== rowIndex ? ' (full)' : ''}</option
										>{/each}
									<option value="new">New row</option>
								</select></label
							>
							<label
								>Row position<select
									aria-label="Position"
									value={rowIndex}
									onchange={(e) => moveRow(rowIndex, Number(e.currentTarget.value))}
								>
									{#each rows.keys() as i (i)}<option value={i}>{i + 1}</option>{/each}
								</select></label
							>
						</div>
						{#if swapTarget !== null && rows[swapTarget]}
							<label
								>Swap with<select
									aria-label="Swap with"
									value=""
									onchange={(e) => swapWith(Number(e.currentTarget.value))}
									><option value="" disabled>Choose a field in row {swapTarget + 1}</option
									>{#each rows[swapTarget] as partner, i (partner.id)}<option value={i}
											>{sectionTitle(partner)}</option
										>{/each}</select
								></label
							>
						{/if}
						{#if row.length > 1}
							<div class="moves">
								<button
									class="secondary"
									aria-label={'Move ' + sectionTitle(field) + ' left'}
									disabled={column === 0}
									onclick={() => shift(-1)}><ArrowLeft size={16} />Left</button
								>
								<button
									class="secondary"
									aria-label={'Move ' + sectionTitle(field) + ' right'}
									disabled={column === row.length - 1}
									onclick={() => shift(1)}>Right<ArrowRight size={16} /></button
								>
							</div>
						{/if}
						<div class="pair">
							<label
								>Column width<select
									aria-label="Column width"
									value={field.width ?? 1}
									onchange={(e) => {
										if (field) field.width = Number(e.currentTarget.value) as Section['width'];
									}}
								>
									<option value="1">1 share</option><option value="2">2 shares</option><option
										value="3">3 shares</option
									>
								</select></label
							>
							<label
								>Alignment<select
									aria-label="Alignment"
									value={field.align ?? ''}
									onchange={(e) => {
										if (field)
											field.align = (e.currentTarget.value || undefined) as Section['align'];
									}}
								>
									<option value="">Default</option><option value="start">Start</option><option
										value="center">Center</option
									><option value="end">End</option>
								</select></label
							>
							<label
								>Text size<select
									aria-label="Text size"
									value={field.textSize ?? 'normal'}
									onchange={(e) => {
										if (field) field.textSize = e.currentTarget.value as Section['textSize'];
									}}
								>
									<option value="small">Small</option><option value="normal">Normal</option><option
										value="large">Large</option
									>
								</select></label
							>
						</div>
						{#if widget}<label class="check"
								><input type="checkbox" bind:checked={field.preview} />{widget.option}</label
							>{/if}
						{#if splitAvailable(field.id)}<button
								class="secondary split"
								aria-label={'Split ' + sectionTitle(field)}
								onclick={split}>Split into separate fields</button
							>{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ol>
	<h2>Add fields</h2>
	<input
		type="search"
		placeholder="Find a section"
		aria-label="Find a section"
		bind:value={query}
	/>
	{#each options as option (option.id)}<button
			class="add"
			aria-label={'Add ' + option.label}
			onclick={() => add(option.id)}><span>{option.label}</span><Plus size={17} /></button
		>{:else}<p>No matching fields.</p>{/each}
	<div class="presets">
		<button
			class="secondary"
			onclick={() => loadDraft(sideBySidePlayer(), 'Side-by-side draft is ready to edit.')}
			>Try side-by-side layout</button
		>
		<button
			class="text-button"
			onclick={() => loadDraft(defaults('player'), 'Default layout restored to the draft.')}
			>Restore default layout</button
		>
	</div>
	<PlayerStyleTransfer
		sections={flattenPlayerRows(rows)}
		onload={(items) => loadDraft(items, 'Imported draft is ready to edit.')}
	/>
</div>

<style>
	.composer {
		max-width: 42rem;
		margin: auto;
	}
	.bar,
	.rowbar,
	.add,
	.check,
	.moves,
	.tokens {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.bar {
		justify-content: space-between;
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--bg);
		padding: 0.25rem 0;
	}
	.rows {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.65rem;
	}
	.row {
		padding: 0.25rem 0.5rem 0.5rem;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: var(--radius);
		min-width: 0;
	}
	.rowbar h3 {
		flex: 1;
		margin: 0;
		font-size: 0.88rem;
	}
	.tool {
		min-width: 44px;
		min-height: 44px;
		display: grid;
		place-items: center;
	}
	.tool:disabled {
		opacity: 0.36;
	}
	.grid {
		display: grid;
		gap: 0.35rem;
	}
	.cell {
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--bg);
		display: flex;
		flex-direction: column;
		align-items: stretch;
	}
	.cell.solo {
		flex-direction: row;
	}
	.cell.current {
		outline: 2px solid var(--text);
		outline-offset: -2px;
	}
	.field {
		flex: 1;
		min-width: 0;
		min-height: 44px;
		padding: 0.4rem;
		overflow-wrap: anywhere;
		font-weight: 600;
	}
	.field[data-size='small'] {
		font-size: 0.85rem;
	}
	.field[data-size='large'] {
		font-size: 1.2rem;
	}
	.remove {
		align-self: flex-end;
		color: var(--muted);
	}
	.inspector {
		display: grid;
		gap: 0.65rem;
		border-top: 1px solid var(--line);
		padding: 0.6rem 0 0.15rem;
		margin-top: 0.7rem;
	}
	.inspector label {
		display: grid;
		gap: 0.15rem;
		font-size: 0.9rem;
		min-width: 0;
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 7rem), 1fr));
		gap: 0.45rem;
	}
	.composer input:not([type='checkbox']),
	.composer select,
	.composer textarea {
		width: 100%;
		min-width: 0;
		min-height: 44px;
	}
	.inspector .check {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 44px;
	}
	.tokens,
	.moves {
		flex-wrap: wrap;
	}
	.tokens button,
	.add {
		min-height: 44px;
	}
	.tokens button {
		padding: 0.3rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		font-size: 0.85rem;
	}
	.add {
		width: 100%;
		justify-content: space-between;
		padding: 0.35rem 0.1rem;
		text-align: start;
		border-bottom: 1px solid var(--line);
	}
	.split {
		justify-self: start;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: var(--gap);
	}
</style>
