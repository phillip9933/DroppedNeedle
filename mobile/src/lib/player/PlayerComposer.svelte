<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { ArrowLeft, ArrowRight, Plus, GripVertical, Scaling, X } from '@lucide/svelte';
	import { available, defaults, sectionTitle, type Section } from '../boards/layout';
	import {
		playerWidgets,
		navigationFields,
		navigationPlacement,
		isNavigation,
		type NavigationId
	} from './layout';
	import PlayerView from '../PlayerView.svelte';
	import { sampleSession } from './samplePlayer';
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
	let list: HTMLDivElement;
	let headerEntries = $state<Section[]>(
		untrack(() => sections.filter((s) => s.placement).map((s) => ({ ...s })))
	);
	let draft = $derived([...flattenPlayerRows(rows), ...headerEntries]);

	let navPanel: HTMLDetailsElement;
	function editNav(id: NavigationId) {
		select('');
		navPanel.open = true;
		void tick().then(() =>
			navPanel
				.querySelector<HTMLSelectElement>(
					'[aria-label="' + navigationFields.find((a) => a.id === id)!.label + ' placement"]'
				)
				?.focus()
		);
	}
	function placeNav(id: NavigationId, placement: string) {
		headerEntries = headerEntries.filter((s) => s.id !== id);
		if (placement === 'canvas') {
			if (!rows.flat().some((s) => s.id === id)) add(id);
		} else {
			rows = rows.map((row) => row.filter((s) => s.id !== id)).filter((row) => row.length);
			headerEntries = [
				...headerEntries,
				{ id, title: '', preview: true, placement: placement as Section['placement'] }
			];
			if (selected === id) select('');
		}
		status = sectionTitle({ id, title: '', preview: true }) + ' placement updated.';
	}
	type Destination = { r: number; c: number; edge: 'before' | 'after' | 'left' | 'right' };
	let target = $state<Destination | null>(null),
		ghost = $state<{ x: number; y: number; name: string } | null>(null);
	function dropTarget(x: number, y: number): Destination | null {
		const element = document.elementFromPoint(x, y),
			row = element?.closest<HTMLElement>('[data-player-row]');
		if (!row || !list.contains(row)) return null;
		const r = Number(row.dataset.playerRow),
			box = row.getBoundingClientRect();
		const cols = [...row.querySelectorAll<HTMLElement>('[data-section-id]')];
		let c = cols.findIndex((cell) => x <= cell.getBoundingClientRect().right);
		if (c < 0) c = cols.length - 1;
		const cell = cols[c].getBoundingClientRect(),
			band = Math.min(22, box.height * 0.22);
		return {
			r,
			c,
			edge:
				y < box.top + band
					? 'before'
					: y > box.bottom - band
						? 'after'
						: x < cell.left + cell.width / 2
							? 'left'
							: 'right'
		};
	}
	function drop(id: string, dest: Destination) {
		const from = rows.findIndex((row) => row.some((s) => s.id === id));
		if (from < 0) return;
		const col = rows[from].findIndex((s) => s.id === id),
			next = rows.map((row) => [...row]),
			item = next[from][col];
		if (dest.edge === 'before' || dest.edge === 'after') {
			next[from].splice(col, 1);
			next.splice(dest.r + (dest.edge === 'after' ? 1 : 0), 0, [item]);
		} else if (dest.r !== from && next[dest.r].length === 3) {
			next[from][col] = next[dest.r][dest.c];
			next[dest.r][dest.c] = item;
		} else {
			const to = dest.c + (dest.edge === 'right' ? 1 : 0);
			next[from].splice(col, 1);
			next[dest.r].splice(to - (dest.r === from && col < to ? 1 : 0), 0, item);
		}
		rows = next.filter((row) => row.length);
		status = sectionTitle(item) + ' moved.';
	}
	function rowHeight(r: number) {
		return Math.max(0, ...rows[r].map((s) => s.minHeight ?? 0));
	}
	function setHeight(r: number, value: number) {
		if (!Number.isFinite(value)) return;
		const h = Math.max(0, Math.min(640, Math.round(value)));
		for (const cell of rows[r]) cell.minHeight = h || undefined;
	}
	let cancelGesture: (() => void) | undefined;
	onDestroy(() => cancelGesture?.());
	function pointer(e: PointerEvent, id: string, mode: 'move' | 'resize') {
		if (e.button !== 0 || !e.isPrimary) return;
		cancelGesture?.();
		e.preventDefault();
		e.stopPropagation();
		const handle = e.currentTarget as HTMLElement,
			pointerId = e.pointerId;
		const r = rows.findIndex((row) => row.some((s) => s.id === id)),
			item = rows[r]?.find((s) => s.id === id);
		if (!item) return;
		const row = list.querySelector<HTMLElement>('[data-player-row="' + r + '"]')!;
		const initialHeight = row.getBoundingClientRect().height,
			storedHeight = rows[r].map((s) => s.minHeight),
			initialWidth = item.width,
			initialContent = item.contentWidth,
			rowWidth = row.getBoundingClientRect().width;
		let x = e.clientX,
			y = e.clientY,
			frame = 0,
			moved = false;
		let scroll = list.parentElement;
		while (
			scroll &&
			!(
				scroll.scrollHeight > scroll.clientHeight &&
				['auto', 'scroll'].includes(getComputedStyle(scroll).overflowY)
			)
		)
			scroll = scroll.parentElement;
		const scroller = scroll ?? document.scrollingElement;
		function paint() {
			if (mode === 'move') {
				target = dropTarget(x, y);
				ghost = { x, y, name: sectionTitle(item!) };
			} else {
				if (rows[r].length === 1 && Math.abs(x - e.clientX) > 4)
					item!.contentWidth = Math.min(
						100,
						Math.max(20, Math.round((initialContent ?? 100) + ((x - e.clientX) / rowWidth) * 100))
					);
				else if (rows[r].length > 1 && Math.abs(x - e.clientX) > 10)
					item!.width = Math.min(
						3,
						Math.max(1, (initialWidth ?? 1) + Math.round((x - e.clientX) / 45))
					) as Section['width'];
				if (Math.abs(y - e.clientY) > 6) setHeight(r, initialHeight + y - e.clientY);
			}
		}
		function scrollFrame() {
			if (moved && mode === 'move' && scroller) {
				const box = scroll?.getBoundingClientRect(),
					top = box?.top ?? 0,
					bottom = box?.bottom ?? innerHeight;
				const delta = y < top + 60 ? -12 : y > bottom - 60 ? 12 : 0;
				if (delta) {
					scroller.scrollTop += delta;
					paint();
				}
			}
			frame = requestAnimationFrame(scrollFrame);
		}
		function move(p: PointerEvent) {
			if (p.pointerId !== pointerId) return;
			x = p.clientX;
			y = p.clientY;
			if (!moved && Math.hypot(x - e.clientX, y - e.clientY) < 5) return;
			moved = true;
			paint();
		}
		function finish(p?: PointerEvent) {
			if (p && p.pointerId !== pointerId) return;
			cancelGesture = undefined;
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', finish);
			handle.removeEventListener('pointercancel', finish);
			handle.removeEventListener('lostpointercapture', finish);
			cancelAnimationFrame(frame);
			if (p?.type === 'pointerup' && moved && mode === 'move') {
				const dest = dropTarget(p.clientX, p.clientY);
				if (dest) drop(id, dest);
			} else if (p?.type !== 'pointerup' && mode === 'resize') {
				item!.width = initialWidth;
				item!.contentWidth = initialContent;
				rows[r].forEach((s, c) => (s.minHeight = storedHeight[c]));
			}
			if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
			target = null;
			ghost = null;
		}
		cancelGesture = () => finish();
		handle.setPointerCapture(pointerId);
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', finish);
		handle.addEventListener('pointercancel', finish);
		handle.addEventListener('lostpointercapture', finish);
		frame = requestAnimationFrame(scrollFrame);
	}

	let templateInput = $state<HTMLTextAreaElement>();
	const rowIndex = $derived(rows.findIndex((row) => row.some((s) => s.id === selected)));
	const column = $derived(rows[rowIndex]?.findIndex((s) => s.id === selected) ?? -1);
	const field = $derived(rows[rowIndex]?.[column]);
	const used = $derived(new Set(rows.flat().map((s) => s.id)));
	const options = $derived(
		available('player').filter(
			(w) =>
				!isNavigation(w.id) &&
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
		if (isNavigation(item.id)) headerEntries = [...headerEntries, { ...item, placement: 'hidden' }];
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
			onsave(draft);
		} catch {
			error = 'Could not save this layout on the device. Your edits are still here.';
		}
	}
	function loadDraft(items: Section[], message: string) {
		rows = playerRows(items);
		headerEntries = items.filter((s) => s.placement);
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
	<p class="hint">
		Tap a field to edit. Drag its grip between fields or to the top or bottom of a row.
	</p>
	<div class="canvas" bind:this={list} aria-label="Sample player layout">
		{#snippet overlay(item: Section, r: number, c: number)}
			<button
				class="field"
				aria-label={'Customize ' + sectionTitle(item)}
				aria-expanded={selected === item.id}
				onclick={() => select(selected === item.id ? '' : item.id)}
			></button>
			{#if selected === item.id}<button
					class="grip"
					aria-label={'Drag ' + sectionTitle(item)}
					onpointerdown={(e) => pointer(e, item.id, 'move')}
					title="Drag field"><GripVertical size={18} /></button
				><button
					class="resize-corner"
					aria-label={'Resize ' + sectionTitle(item)}
					title="Resize field"
					onpointerdown={(e) => pointer(e, item.id, 'resize')}><Scaling size={17} /></button
				>{/if}
			{#if target?.r === r && (target.c === c || target.edge === 'before' || target.edge === 'after')}<span
					class="drop"
					data-edge={target.edge}
				></span>{/if}
		{/snippet}
		{#snippet inspector(r: number)}
			{#if r === rowIndex && field}
				<div
					class="inspector"
					hidden={!!ghost}
					role="group"
					aria-label={'Customize ' + sectionTitle(field)}
				>
					<div class="inspector-bar">
						<strong>{sectionTitle(field)}</strong><button
							class="tool"
							aria-label="Finish editing field"
							onclick={() => select('')}><X size={18} /></button
						>
					</div>
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
					{#if rows[r].length > 1}
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
								disabled={column === rows[r].length - 1}
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
									if (field) field.align = (e.currentTarget.value || undefined) as Section['align'];
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
					<div class="pair">
						<label
							>Element width (%)<input
								aria-label="Element width"
								min="20"
								max="100"
								type="number"
								step="1"
								value={field.contentWidth ?? 100}
								onchange={(e) => {
									if (field && Number.isFinite(e.currentTarget.valueAsNumber))
										field.contentWidth = Math.round(
											Math.min(100, Math.max(20, e.currentTarget.valueAsNumber))
										);
								}}
							/></label
						>
					</div>
					<div class="size-tools">
						<label
							>Minimum row height (px)<input
								aria-label="Minimum row height"
								type="number"
								min="0"
								max="640"
								step="1"
								value={rowHeight(r)}
								oninput={(e) => setHeight(r, e.currentTarget.valueAsNumber)}
							/></label
						><button
							class="secondary grip-resize"
							aria-label={'Drag to resize ' + sectionTitle(field)}
							onpointerdown={(e) => pointer(e, field!.id, 'resize')}
							><Scaling size={17} />Drag to resize</button
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
					<button
						class="text-button remove"
						aria-label={'Remove ' + sectionTitle(field)}
						onclick={() => remove(rowIndex, column)}>Remove field</button
					>
				</div>{/if}{/snippet}
		<PlayerView
			session={sampleSession}
			expanded={true}
			onexpand={() => {}}
			oncollapse={() => {}}
			onerror={() => {}}
			editor={{ sections: draft, selected, overlay, inspector, selectNavigation: editNav }}
		/>
		{#if !rows.length}<p>Add a field below to start your layout.</p>{/if}
	</div>
	{#if ghost}<div class="ghost" style:left={ghost.x + 'px'} style:top={ghost.y + 'px'}>
			{ghost.name}
		</div>{/if}
	<details class="navigation" bind:this={navPanel}>
		<summary>Header controls</summary>
		<div>
			{#each navigationFields as a (a.id)}<label
					>{a.label}<select
						aria-label={a.label + ' placement'}
						value={navigationPlacement(a.id, draft)}
						onchange={(e) => placeNav(a.id, e.currentTarget.value)}
						><option value="header-start">Header start</option><option value="header-end"
							>Header end</option
						><option value="canvas">Player layout</option><option value="hidden">Hidden</option
						></select
					></label
				>{/each}
		</div>
	</details>

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
		sections={draft}
		onload={(items) => loadDraft(items, 'Imported draft is ready to edit.')}
	/>
</div>

<style>
	.composer {
		max-width: 42rem;
		margin: auto;
	}
	.bar,
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
	.hint {
		font-size: 0.88rem;
		color: var(--muted);
	}
	.canvas {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.4rem;
		min-width: 0;
		background: var(--bg);
	}
	.field {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		min-height: 44px;
		z-index: 1;
		border-radius: inherit;
	}
	.inspector[hidden] {
		display: none;
	}
	.resize-corner {
		position: absolute;
		top: calc(100% + 3px);
		inset-inline-end: 0;
		z-index: 2;
		touch-action: none;
		cursor: nwse-resize;
		width: 44px;
		height: 44px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--raised);
		display: grid;
		place-items: center;
	}
	@container (max-width:95px) {
		.resize-corner {
			display: none;
		}
	}
	.field:focus-visible,
	.grip:focus-visible {
		outline: 2px solid var(--accent);
	}
	.grip {
		position: absolute;
		inset-inline-start: 0;
		top: calc(100% + 3px);
		width: 44px;
		height: 44px;
		z-index: 2;
		display: grid;
		place-items: center;
		color: var(--text);
		background: var(--raised);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		touch-action: none;
		cursor: grab;
	}
	.grip:active,
	.grip-resize:active {
		cursor: grabbing;
	}
	.tool {
		min-width: 44px;
		min-height: 44px;
		display: grid;
		place-items: center;
	}
	.drop {
		position: absolute;
		z-index: 3;
		pointer-events: none;
		background: var(--accent);
	}
	.drop[data-edge='before'],
	.drop[data-edge='after'] {
		height: 4px;
		left: 0;
		right: 0;
	}
	.drop[data-edge='before'] {
		top: 0;
	}
	.drop[data-edge='after'] {
		bottom: 0;
	}
	.drop[data-edge='left'],
	.drop[data-edge='right'] {
		width: 4px;
		top: 0;
		bottom: 0;
	}
	.drop[data-edge='left'] {
		left: 0;
	}
	.drop[data-edge='right'] {
		right: 0;
	}
	.ghost {
		position: fixed;
		pointer-events: none;
		z-index: 9;
		transform: translate(-50%, -120%);
		background: var(--raised);
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--accent);
		border-radius: var(--radius);
	}
	.inspector-bar,
	.size-tools {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.size-tools {
		flex-wrap: wrap;
		align-items: end;
	}
	.size-tools label {
		flex: 1;
	}
	.grip-resize {
		touch-action: none;
		cursor: nwse-resize;
	}
	.navigation {
		margin-block: var(--gap);
		border-bottom: 1px solid var(--line);
	}
	.navigation summary {
		cursor: pointer;
		font-weight: 600;
		padding: 0.7rem 0;
	}
	.navigation label {
		display: grid;
		gap: 0.2rem;
	}
	.navigation > div {
		display: grid;
		gap: 0.5rem;
		padding: 0 0 var(--gap);
	}
	.remove {
		justify-self: start;
	}

	.inspector {
		display: grid;
		gap: 0.65rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.65rem;
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
