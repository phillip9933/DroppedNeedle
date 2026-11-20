<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { ArrowLeft, ArrowRight, Eye, Plus, GripVertical, Scaling } from '@lucide/svelte';
	import { defaults, sectionTitle, type Section } from '../boards/layout';
	import { playerWidgets, isNavigation } from './layout';
	import PlayerView from '../PlayerView.svelte';
	import { sampleSession } from './samplePlayer';
	import PlayerStyleTransfer from './PlayerStyleTransfer.svelte';
	import PlayerSlotPicker from './PlayerSlotPicker.svelte';
	import PlayerCellAppearance from './PlayerCellAppearance.svelte';
	import PlayerRowInspector from './PlayerRowInspector.svelte';
	import {
		emptyColumn,
		resizeColumns,
		fillColumn,
		fiveControlRow,
		retainHeader
	} from './composerRows';
	import {
		defaultPlayerText,
		flattenPlayerRows,
		isPlayerText,
		isPlayerSlot,
		maxPlayerColumns,
		playerRows,
		playerCanvas,
		packPlayerCanvas,
		rowName,
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
	let rows = $state<Section[][]>(untrack(() => playerCanvas(sections.map((s) => ({ ...s })))));
	let selected = $state(''),
		rowAnchor = $state(''),
		error = $state(''),
		status = $state('');
	let swapTarget = $state<number | null>(null),
		placementOpen = $state(false);
	let list: HTMLDivElement;
	let hidden = $state<Section[]>(
		untrack(() => sections.filter((s) => s.placement === 'hidden').map((s) => ({ ...s })))
	);
	let draft = $derived(packPlayerCanvas(rows, hidden));

	type Destination = { r: number; c: number; edge: 'before' | 'after' | 'left' | 'right' };
	let target = $state<Destination | null>(null),
		ghost = $state<{ x: number; y: number; name: string } | null>(null);
	function dropTarget(x: number, y: number): Destination | null {
		const element = document.elementFromPoint(x, y);
		const row =
			element?.closest<HTMLElement>('[data-layout-row]') ??
			element
				?.closest<HTMLElement>('[data-edit-row]')
				?.parentElement?.querySelector<HTMLElement>('[data-layout-row]');
		if (!row || !list.contains(row)) return null;
		const r = Number(row.dataset.layoutRow),
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
		} else if (isPlayerSlot(next[dest.r][dest.c].id) && !isPlayerSlot(id)) {
			moveIntoSlot(id, next[dest.r][dest.c].id);
			return;
		} else if (dest.r !== from && next[dest.r].length === maxPlayerColumns) {
			next[from][col] = next[dest.r][dest.c];
			next[dest.r][dest.c] = item;
		} else {
			const to = dest.c + (dest.edge === 'right' ? 1 : 0);
			next[from].splice(col, 1);
			next[dest.r].splice(to - (dest.r === from && col < to ? 1 : 0), 0, item);
		}
		rows = retainHeader(next);
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
	let suppressClick = false;
	let cancelGesture: (() => void) | undefined;
	onDestroy(() => cancelGesture?.());
	function pointer(e: PointerEvent, id: string, mode: 'move' | 'resize' | 'row') {
		if (e.button !== 0 || !e.isPrimary) return;
		cancelGesture?.();
		e.stopPropagation();
		const handle = e.currentTarget as HTMLElement,
			pointerId = e.pointerId;
		const r = rows.findIndex((row) => row.some((s) => s.id === id)),
			item = rows[r]?.find((s) => s.id === id);
		if (!item) return;
		const row = list.querySelector<HTMLElement>('[data-layout-row="' + r + '"]')!;
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
			if (mode !== 'resize') {
				target = dropTarget(x, y);
				if (target && mode === 'row') target.edge = target.r < r ? 'before' : 'after';
				ghost = { x, y, name: mode === 'row' ? rowName(r) : sectionTitle(item!) };
			} else {
				if (rows[r].length === 1 && Math.abs(x - e.clientX) > 4)
					item!.contentWidth = Math.min(
						100,
						Math.max(20, Math.round((initialContent ?? 100) + ((x - e.clientX) / rowWidth) * 100))
					);
				else if (rows[r].length > 1 && Math.abs(x - e.clientX) > 10)
					item!.width = Math.min(
						12,
						Math.max(1, (initialWidth ?? 1) + Math.round((x - e.clientX) / 24))
					) as Section['width'];
				if (Math.abs(y - e.clientY) > 6) setHeight(r, initialHeight + y - e.clientY);
			}
		}
		function scrollFrame() {
			if (moved && mode !== 'resize' && scroller) {
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
			if (p?.type === 'pointerup' && moved) {
				// A completed drag must not also open whichever editor is under the release.
				suppressClick = true;
				window.setTimeout(() => {
					suppressClick = false;
				}, 0);
			}
			if (p?.type === 'pointerup' && moved && mode !== 'resize') {
				const dest = dropTarget(p.clientX, p.clientY);
				if (dest && mode === 'row') moveRow(r, dest.r);
				else if (dest) drop(id, dest);
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
	const editingRow = $derived(
		rowAnchor ? rows.findIndex((row) => row.some((s) => s.id === rowAnchor)) : -1
	);

	let measured = $state<Record<string, number>>({});
	$effect(() => {
		const r = editingRow >= 0 ? editingRow : rowIndex;
		const ids = rows[r]?.map((s) => s.id);
		if (!ids?.length) {
			measured = {};
			return;
		}
		let stopped = false;
		let observer: ResizeObserver | undefined;
		void tick().then(() => {
			if (stopped) return;
			const grid = list?.querySelector<HTMLElement>('[data-layout-row="' + r + '"]');
			if (!grid) return;
			const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-section-id]'));
			const measure = () => {
				const widths = cells.map((c) => c.getBoundingClientRect().width),
					total = widths.reduce((sum, w) => sum + w, 0);
				if (total > 0)
					measured = Object.fromEntries(
						cells.map((c, i) => [c.dataset.sectionId!, (100 * widths[i]) / total])
					);
			};
			measure();
			observer = new ResizeObserver(measure);
			cells.forEach((c) => observer!.observe(c));
		});
		return () => {
			stopped = true;
			observer?.disconnect();
		};
	});

	const widget = $derived(playerWidgets.find((w) => w.id === field?.id));

	function select(id: string) {
		if (selected !== id) placementOpen = false;
		selected = id;
		rowAnchor = '';
		swapTarget = null;
		error = '';
	}
	let prior = $state<{ scroll: number; row?: string }>();
	const mainScroll = () => list.closest('main');
	let previewOpen = $state(false),
		previewScroll = 0;
	let previewButton = $state<HTMLButtonElement>(),
		returnButton = $state<HTMLButtonElement>();
	async function showPreview() {
		cancelGesture?.();
		const main = mainScroll();
		previewScroll = main?.scrollTop ?? 0;
		previewOpen = true;
		await tick();
		main?.scrollTo(0, 0);
		returnButton?.focus({ preventScroll: true });
	}
	async function closePreview() {
		previewOpen = false;
		await tick();
		mainScroll()?.scrollTo(0, previewScroll);
		previewButton?.focus({ preventScroll: true });
	}
	async function focusField(id: string, scroll?: number) {
		await tick();
		const el = list?.querySelector<HTMLButtonElement>(
			'[data-section-id="' + CSS.escape(id) + '"] .field'
		);
		restoreFocus(el, scroll);
	}
	function restoreFocus(el: HTMLElement | null, scroll?: number) {
		const main = mainScroll();
		if (!el || !main) return;
		if (scroll !== undefined) main.scrollTo(0, scroll);
		el.focus({ preventScroll: true });
		const view = main.getBoundingClientRect(),
			box = el.getBoundingClientRect();
		if (box.bottom <= view.top + 80 || box.top >= view.bottom)
			el.scrollIntoView({ block: 'center' });
	}
	async function focusPanel() {
		await tick();
		const panel = list?.querySelector<HTMLElement>('[data-inspector]');
		panel?.focus({ preventScroll: true });
		const main = mainScroll();
		if (panel && main) {
			const box = main.getBoundingClientRect(),
				top = panel.getBoundingClientRect().top;
			if (top < box.top + 96 || top > box.bottom - 140)
				main.scrollTop += top - box.top - Math.min(180, box.height * 0.32);
		}
	}
	function openField(id: string, fromRow = false) {
		if (suppressClick) return;
		if (id === selected) {
			finishField();
			return;
		}
		prior = { scroll: mainScroll()?.scrollTop ?? 0, row: fromRow ? rowAnchor : undefined };
		select(id);
		void focusPanel();
	}
	async function finishField() {
		const id = selected,
			previous = prior;
		prior = undefined;
		select('');
		if (previous?.row && rows.some((row) => row.some((s) => s.id === previous.row))) {
			rowAnchor = previous.row;
			await tick();
			restoreFocus(
				list.querySelector<HTMLButtonElement>('[data-edit-column="' + CSS.escape(id) + '"]'),
				previous.scroll
			);
		} else if (id) await focusField(id, previous?.scroll);
	}
	let rowScroll = 0;
	async function finishRow(r: number) {
		select('');
		await tick();
		restoreFocus(list.querySelector<HTMLButtonElement>('[data-edit-row="' + r + '"]'), rowScroll);
	}
	function finishInspector() {
		if (selected) void finishField();
		else if (editingRow >= 0) void finishRow(editingRow);
	}
	onMount(() => {
		function back(event: Event) {
			if (document.querySelector('dialog[open]')) return;
			if (previewOpen) {
				event.preventDefault();
				void closePreview();
			} else if (selected || editingRow >= 0) {
				event.preventDefault();
				finishInspector();
			}
		}
		window.addEventListener('dn-back', back);
		return () => window.removeEventListener('dn-back', back);
	});
	function editRow(r: number, focus = true) {
		if (suppressClick) return;
		prior = undefined;
		if (focus) rowScroll = mainScroll()?.scrollTop ?? 0;
		select('');
		rowAnchor = rows[r]?.[0].id ?? '';
		if (focus) void focusPanel();
	}
	async function addRow() {
		rows = [...rows, [emptyColumn(rows.flat())]];
		editRow(rows.length - 1, false);
		status = 'Row added.';
		await tick();
		const marker = list.querySelector<HTMLElement>('[data-edit-row="' + (rows.length - 1) + '"]');
		marker?.scrollIntoView({ block: 'nearest' });
		rowScroll = mainScroll()?.scrollTop ?? 0;
		list.querySelector<HTMLSelectElement>('[data-inspector] select')?.focus();
	}
	function changeColumns(r: number, n: number) {
		rows = resizeColumns(rows, r, n);
		editRow(r, false);
		status = rowName(r) + ' now has ' + rows[r].length + ' columns.';
	}
	function chooseFeature(id: string) {
		if (!field || !isPlayerSlot(field.id)) return;
		const choice = fillColumn(
			rows,
			field.id,
			id,
			hidden.find((h) => h.id === id)
		);
		if (isNavigation(id)) hidden = hidden.filter((h) => h.id !== id);
		rows = choice.rows;
		const row = rows.find((r) => r.some((s) => s.id === choice.id))!;
		if (prior?.row && !row.some((s) => s.id === prior!.row)) prior.row = row[0].id;
		select(choice.id);
		status = sectionTitle(row.find((s) => s.id === choice.id)!) + ' placed.';
		if (isPlayerText(choice.id)) void focusPanel();
		else void finishField();
	}
	function moveIntoSlot(id: string, slot: string) {
		const source = rows.flat().find((s) => s.id === id);
		const dest = rows.flat().find((s) => s.id === slot);
		if (!source || !dest) return;
		rows = retainHeader(
			rows.map((row) => {
				const same = row.some((s) => s.id === slot);
				return row.flatMap((s) =>
					s.id === slot
						? [{ ...source, width: dest.width, minHeight: dest.minHeight, gap: dest.gap }]
						: s.id === id
							? same
								? [{ ...dest, width: source.width, minHeight: source.minHeight, gap: source.gap }]
								: []
							: [s]
				);
			})
		);
		status = sectionTitle(source) + ' moved.';
		void focusField(id);
	}
	function clearColumn(r: number, c: number) {
		const current = rows[r][c],
			slot = emptyColumn(rows.flat(), current);
		rows = rows.map((row, i) => (i === r ? row.map((s, j) => (j === c ? slot : s)) : row));
		if (isNavigation(current.id)) hidden = [...hidden, { ...current, placement: 'hidden' }];
		select(slot.id);
		status = 'Column cleared.';
	}
	function removeRow(r: number) {
		hidden = [
			...hidden,
			...rows[r]
				.filter((s) => isNavigation(s.id))
				.map((s) => ({ ...s, placement: 'hidden' as const }))
		];
		rows = retainHeader(rows.map((row, i) => (i === r ? [] : row)));
		select('');
		status = r === 0 ? 'Header cleared.' : 'Row removed.';
		void finishRow(Math.min(r, rows.length - 1));
	}
	function standardControls() {
		rows = fiveControlRow(rows);
		select('');
		status = 'Five playback controls arranged in one row.';
		void focusField('player-toggle');
	}
	function remove(r: number, c: number) {
		const item = rows[r][c];
		rows = retainHeader(rows.map((row, i) => (i === r ? row.filter((_, j) => j !== c) : row)));
		if (isNavigation(item.id)) hidden = [...hidden, { ...item, placement: 'hidden' }];
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
		const to = value === 'new' ? rows.length : Number(value) + 1;
		if (to === rowIndex) return;
		const slot = rows[to]?.find((s) => isPlayerSlot(s.id));
		if (slot) {
			moveIntoSlot(field.id, slot.id);
			return;
		}
		if (rows[to]?.length === maxPlayerColumns) {
			swapTarget = to;
			return;
		}
		const moved = field;
		const next = rows.map((row) => [...row]);
		next[rowIndex].splice(column, 1);
		if (to === next.length) next.push([moved]);
		else next[to].push(moved);
		rows = retainHeader(next);
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
		rows = retainHeader(playerRows(flat));
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
		rows = playerCanvas(items);
		hidden = items.filter((s) => s.placement === 'hidden');
		select('');
		status = message;
	}
</script>

<div class="composer" data-part="layout-editor" hidden={previewOpen}>
	<div class="bar">
		<button class="text-button" onclick={onback}>Cancel</button>
		{#if selected || editingRow >= 0}<button
				class="text-button inspector-done"
				onclick={finishInspector}
				><ArrowLeft size={16} /> {prior?.row ? 'Back to row' : 'Back to layout'}</button
			>{/if}
		<button class="add-row secondary" onclick={addRow}><Plus size={17} />Add row</button>
		<button
			class="secondary preview-action"
			aria-label="Preview layout"
			onclick={showPreview}
			bind:this={previewButton}><Eye size={17} aria-hidden="true" /> Preview</button
		>
		<button class="primary" aria-label="Save layout" onclick={save}
			>Save<span class="save-suffix"> layout</span></button
		>
	</div>
	<h1>Edit Now Playing</h1>
	{#if error}<p role="alert">{error}</p>{/if}
	<p class="sr-only" role="status">{status}</p>
	<p class="hint">
		Drag the handles to move rows or features. Tap a feature to edit it, or an empty column to add
		one.
	</p>

	<div class="canvas" bind:this={list} aria-label="Sample player layout">
		{#snippet rowControls(r: number)}
			<button
				class="row-marker"
				data-layout-drag
				data-edit-row={r}
				aria-label={'Edit ' + rowName(r).toLowerCase()}
				aria-expanded={editingRow === r}
				onclick={() => {
					if (!suppressClick) {
						if (editingRow === r) void finishRow(r);
						else editRow(r);
					}
				}}
				onpointerdown={(e) => pointer(e, rows[r][0].id, 'row')}
			>
				<GripVertical size={15} /><strong>{rowName(r)}</strong><span
					>{rows[r].length} {rows[r].length === 1 ? 'column' : 'columns'}</span
				>
			</button>
		{/snippet}
		{#snippet overlay(item: Section, r: number, c: number)}
			{#if isPlayerSlot(item.id)}
				<button
					class="field empty"
					aria-label={'Add feature to ' + rowName(r).toLowerCase() + ', column ' + (c + 1)}
					aria-expanded={selected === item.id}
					onclick={() => openField(item.id)}
				>
					<Plus size={19} />
				</button>
			{:else}
				<button
					class="field filled"
					data-layout-drag
					aria-label={'Customize ' + sectionTitle(item)}
					aria-expanded={selected === item.id}
					onclick={() => openField(item.id)}
					onpointerdown={(e) => pointer(e, item.id, 'move')}
					><span class="grip" data-layout-drag aria-hidden="true" title="Drag to move"
						><GripVertical size={16} /></span
					></button
				>
			{/if}
			{#if selected === item.id && !isPlayerSlot(item.id)}<button
					class="resize-corner"
					data-layout-drag
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
			{#if editingRow === r}
				<PlayerRowInspector
					{measured}
					{rows}
					{r}
					close={() => void finishRow(r)}
					resize={(n) => changeColumns(r, n)}
					setWidth={(c, n) => (rows[r][c].width = n)}
					select={(id) => openField(id, true)}
					gap={rows[r][0].gap}
					setGap={(n) => {
						for (const cell of rows[r]) cell.gap = n;
					}}
					move={(to) => moveRow(r, to)}
					height={rowHeight(r)}
					setHeight={(n) => setHeight(r, n)}
					remove={() => removeRow(r)}
				/>
			{:else if r === rowIndex && field && isPlayerSlot(field.id)}
				{#key field.id}<PlayerSlotPicker
						{r}
						c={column}
						{rows}
						choose={chooseFeature}
						close={finishField}
					/>{/key}
			{:else if r === rowIndex && field}
				<div
					class="inspector"
					data-inspector
					tabindex="-1"
					hidden={!!ghost}
					role="group"
					aria-label={'Customize ' + sectionTitle(field)}
				>
					<div class="inspector-bar">
						<strong>{sectionTitle(field)}</strong><button
							class="tool"
							aria-label="Finish editing field"
							onclick={finishField}>Done</button
						>
					</div>
					<PlayerCellAppearance
						{field}
						change={(patch) => {
							if (field) Object.assign(field, patch);
						}}
					/>
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
					{#if widget}<label class="check"
							><input type="checkbox" bind:checked={field.preview} />{widget.option}</label
						>{/if}
					{#if rows[r].length > 1}
						<label
							>Column width<select
								aria-label="Column width"
								value={field.width ?? 1}
								onchange={(e) => {
									if (field) field.width = Number(e.currentTarget.value);
								}}
							>
								{#each Array.from({ length: 12 }, (_, i) => i + 1) as w (w)}<option value={w}
										>{w} {w === 1 ? 'share' : 'shares'}</option
									>{/each}
							</select>{#if measured[field.id] !== undefined}<small
									>{Math.round(measured[field.id])}% of the visible columns</small
								>{/if}</label
						>
					{/if}
					<details class="advanced" bind:open={placementOpen}>
						<summary>Placement and sizing</summary>
						<div>
							<label
								>Section title<input
									maxlength="64"
									placeholder={sectionTitle({ ...field, title: '' })}
									bind:value={field.title}
								/></label
							>
							<div class="pair">
								<label
									>Move to row<select
										aria-label="Move to row"
										value={(swapTarget ?? rowIndex) - 1}
										onchange={(e) => moveField(e.currentTarget.value)}
									>
										{#each rows as dest, i (i)}<option value={i - 1}
												>{rowName(i)}{dest.length === maxPlayerColumns && i !== rowIndex
													? ' (full)'
													: ''}</option
											>{/each}
										<option value="new">New row</option>
									</select></label
								>
								<label
									>Row position<select
										aria-label="Position"
										value={rowIndex - 1}
										onchange={(e) => moveRow(rowIndex, Number(e.currentTarget.value) + 1)}
									>
										{#each rows.keys() as i (i)}<option value={i - 1}>{rowName(i)}</option>{/each}
									</select></label
								>
							</div>
							{#if swapTarget !== null && rows[swapTarget]}
								<label
									>Swap with<select
										aria-label="Swap with"
										value=""
										onchange={(e) => swapWith(Number(e.currentTarget.value))}
										><option value="" disabled>Choose a field in {rowName(swapTarget)}</option
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
						</div>
					</details>
					{#if splitAvailable(field.id)}<button
							class="secondary split"
							aria-label={'Split ' + sectionTitle(field)}
							onclick={split}>Split into separate fields</button
						>{/if}
					<div class="field-actions">
						<button class="secondary" onclick={() => clearColumn(rowIndex, column)}
							>Clear column</button
						>
						<button
							class="text-button remove"
							aria-label={'Remove ' + sectionTitle(field)}
							onclick={() => remove(rowIndex, column)}
						>
							{rows[r].length === 1 ? 'Remove row' : 'Remove column'}
						</button>
					</div>
				</div>{/if}{/snippet}
		<PlayerView
			session={sampleSession}
			expanded={true}
			onexpand={() => {}}
			oncollapse={() => {}}
			onerror={() => {}}
			editor={{
				sections: draft,
				selected,
				overlay,
				rowControls,
				inspector
			}}
		/>
		{#if !rows.length}<p>Add a row to start your layout.</p>{/if}
	</div>
	{#if ghost}<div class="ghost" style:left={ghost.x + 'px'} style:top={ghost.y + 'px'}>
			{ghost.name}
		</div>{/if}

	<div class="presets">
		<button class="secondary" onclick={standardControls}>Arrange five playback controls</button>
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
{#if previewOpen}
	<div class="composer" data-part="layout-preview">
		<div class="bar">
			<button class="text-button" onclick={closePreview} bind:this={returnButton}
				><ArrowLeft size={18} aria-hidden="true" /> Back to editing</button
			>
		</div>
		<div class="preview-body">
			<PlayerView
				session={sampleSession}
				expanded={true}
				onexpand={() => {}}
				oncollapse={() => {}}
				onerror={() => {}}
				editor={{ sections: draft }}
			/>
		</div>
	</div>
{/if}

<style>
	.preview-body {
		margin-inline: calc(-1 * var(--gap));
	}
	.preview-body :global(.compact-header) {
		top: calc(44px + 0.5rem);
	}
	.preview-action {
		gap: 0.25rem;
	}
	.row-marker {
		touch-action: none;
		cursor: grab;
		min-height: 44px;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		text-align: start;
		color: var(--muted);
		font-size: 0.81rem;
	}
	.row-marker strong {
		color: var(--text);
	}
	.row-marker span {
		margin-inline-start: auto;
	}
	.add-row {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}
	.field.filled,
	.field.empty {
		display: grid;
		place-items: center;
		border: 0;
		background: transparent;
		padding: 0;
		min-width: 0;
		color: var(--text);
	}
	.field.filled {
		align-items: start;
		justify-items: end;
	}
	.field.empty {
		color: var(--accent);
	}
	.field-actions {
		flex-wrap: wrap;
	}

	.composer {
		max-width: 42rem;
		margin: auto;
	}
	.bar,
	.field-actions,
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
		isolation: isolate;
		z-index: 12;
		background: var(--bg);
		padding: 0.25rem 0;
	}
	.bar {
		gap: 0.25rem;
	}
	.bar button {
		white-space: nowrap;
		min-width: 0;
		padding-inline: clamp(0.45rem, 2vw, 0.85rem);
		flex-shrink: 0;
	}
	.canvas {
		position: relative;
		isolation: isolate;
		z-index: 0;
	}
	.advanced {
		border-block: 1px solid var(--line);
	}
	.advanced summary {
		cursor: pointer;
		line-height: 44px;
		font-weight: 600;
	}
	.advanced[open] > div {
		display: grid;
		gap: 0.55rem;
		padding-bottom: 0.5rem;
	}
	@media (max-width: 420px) {
		.bar {
			margin-inline: calc(-1 * var(--gap));
			padding-inline: var(--gap);
		}
		[data-part='layout-editor'] .bar {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
		.bar button {
			padding-inline: 0.15rem;
		}
		.bar .add-row :global(svg),
		.bar .preview-action :global(svg),
		.save-suffix {
			display: none;
		}
		.canvas {
			margin-inline: calc(2px - var(--gap));
			padding-inline: 0.25rem;
		}
		.canvas :global(.now.sample) {
			padding-inline: 0.25rem;
		}
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
	.canvas :global([data-inspector]) {
		scroll-margin-block-start: 6rem;
	}
	.canvas :global([data-inspector]:focus:not(:focus-visible)) {
		outline: none;
	}
	.inspector[hidden] {
		display: none;
	}
	.resize-corner {
		position: absolute;
		bottom: 0;
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
	.field:focus-visible {
		outline: 2px solid var(--accent);
	}
	.grip {
		position: absolute;
		inset-inline-end: 0;
		top: 0;
		width: 44px;
		height: 44px;
		z-index: 2;
		display: grid;
		align-items: start;
		justify-items: end;
		padding: 2px;
		color: var(--muted);
		background: transparent;
		touch-action: none;
		cursor: grab;
	}
	.grip :global(svg) {
		background: var(--bg);
		border-radius: 3px;
	}
	.field.filled {
		touch-action: pan-y;
	}
	.inspector-done {
		grid-column: 1 / -1;
		justify-self: start;
	}
	.bar:has(.inspector-done) {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		row-gap: 0;
	}
	.bar .inspector-done {
		grid-row: 2;
		min-height: 44px;
	}
	.bar > .add-row {
		justify-self: center;
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
	.add-row {
		min-height: 44px;
	}
	.tokens button {
		padding: 0.3rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		font-size: 0.85rem;
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
