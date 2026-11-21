<script lang="ts">
	import { uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import {
		ArrowLeft,
		ArrowRight,
		Eye,
		Plus,
		GripVertical,
		Scaling,
		Undo2,
		Redo2
	} from '@lucide/svelte';
	import { defaults, sectionTitle, type Section } from '../boards/layout';
	import { playerWidgets, isNavigation } from './layout';
	import PlayerView from '../PlayerView.svelte';
	import { sampleSession } from './samplePlayer';
	import PlayerStyleTransfer from './PlayerStyleTransfer.svelte';
	import type { PlayerDraft } from './playerDraft';
	import PlayerSlotPicker from './PlayerSlotPicker.svelte';
	import PlayerCellAppearance from './PlayerCellAppearance.svelte';
	import PlayerRowInspector from './PlayerRowInspector.svelte';
	import {
		emptyColumn,
		resizeColumns,
		fillColumn,
		addSubrow,
		placeField,
		removeField,
		swapFields,
		type DropEdge,
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
		playerColumns,
		splitAvailable,
		splitPlayerSection
	} from './composition';

	let {
		recovery,
		onback,
		onsave
	}: {
		recovery: PlayerDraft;

		onback: () => void;
		onsave: (sections: Section[]) => void;
	} = $props();
	const initial = untrack(() => recovery.initial);
	let rows = $state<Section[][]>(playerCanvas(initial.map((section) => ({ ...section }))));
	let recoveryIssue = $state('');
	let leaving = $state(false);
	let selected = $state(''),
		rowAnchor = $state(''),
		error = $state(''),
		status = $state('');
	let swapTarget = $state<number | null>(null),
		placementOpen = $state(false);
	let list = $state<HTMLDivElement>(null!);
	let hidden = $state<Section[]>(
		initial.filter((s) => s.placement === 'hidden').map((s) => ({ ...s }))
	);
	let draft = $derived(packPlayerCanvas(rows, hidden));
	const historyLimit = 31;
	let snapshots = $state.raw<string[]>([]);
	let cursor = $state(-1),
		resizing = $state(false);
	let typingIn: Element | null = null;
	$effect(() => {
		if (resizing || leaving) return;
		let active = true;
		void recovery.remember(draft).then((issue) => {
			if (active) recoveryIssue = issue;
		});
		return () => {
			active = false;
		};
	});
	function resetEditGroup() {
		typingIn = null;
	}
	$effect(() => {
		if (resizing) return;
		const snapshot = JSON.stringify([rows, hidden]);
		untrack(() => {
			if (snapshots[cursor] === snapshot) return;
			const input = document.activeElement;
			const group = input?.matches(
				'textarea, input:not([type]), input[type="text"], input[type="range"], input[type="number"]'
			)
				? input
				: null;
			const continued =
				group && group === typingIn && cursor === snapshots.length - 1 && cursor > 0;
			const before = snapshots.slice(0, continued ? cursor : cursor + 1);
			if (before.at(-1) !== snapshot) before.push(snapshot);
			snapshots = before.slice(-historyLimit);
			cursor = snapshots.length - 1;
			typingIn = group;
		});
	});
	function travel(step: -1 | 1) {
		const next = cursor + step;
		if (!snapshots[next] || resizing || previewOpen) return;
		const [restoredRows, restoredHidden]: [Section[][], Section[]] = JSON.parse(snapshots[next]);
		cursor = next;
		rows = restoredRows;
		hidden = restoredHidden;
		resetEditGroup();
		const exists = (id: string) => restoredRows.some((row) => row.some((cell) => cell.id === id));
		if ((selected && !exists(selected)) || (rowAnchor && !exists(rowAnchor))) {
			select('');
			prior = undefined;
		}
		swapTarget = null;
		status = step < 0 ? 'Layout edit undone.' : 'Layout edit restored.';
	}

	type Destination = { r: number; c: number; edge: DropEdge };
	let target = $state<Destination | null>(null),
		ghost = $state<{ x: number; y: number; name: string } | null>(null);
	function dropTarget(x: number, y: number): Destination | null {
		const element = document.elementFromPoint(x, y);
		const marker = element?.closest<HTMLElement>('[data-edit-row]');
		const row = marker
			? list.querySelector<HTMLElement>('[data-layout-row="' + marker.dataset.editRow + '"]')
			: element?.closest<HTMLElement>('[data-layout-row]');
		if (!row || !list.contains(row)) return null;
		const r = Number(row.dataset.layoutRow),
			box = row.getBoundingClientRect();
		const cols = [...row.querySelectorAll<HTMLElement>('[data-section-id]')];
		const hit = element?.closest<HTMLElement>('[data-section-id]');
		const c = hit
			? cols.indexOf(hit)
			: cols.findIndex((el) => {
					const rect = el.getBoundingClientRect();
					return x <= rect.right && y <= rect.bottom;
				});
		if (!cols.length) return null;
		const i = c < 0 ? cols.length - 1 : c,
			cell = cols[i].getBoundingClientRect(),
			localY = (y - cell.top) / Math.max(1, cell.height),
			localX = (x - cell.left) / Math.max(1, cell.width);
		const edge: DropEdge =
			y < box.top + 3
				? 'before'
				: y > box.bottom - 3
					? 'after'
					: localY < 0.3
						? 'above'
						: localY > 0.7
							? 'below'
							: localX < 0.5
								? 'left'
								: 'right';
		return { r, c: i, edge };
	}
	function drop(id: string, dest: Destination) {
		const item = rows[dest.r]?.[dest.c];
		if (!item || id === item.id) return;
		if (isPlayerSlot(item.id) && !isPlayerSlot(id)) {
			moveIntoSlot(id, item.id);
			return;
		}
		rows = placeField(rows, id, item.id, dest.edge);
		status = 'Field moved.';
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
	type Point = { clientX: number; clientY: number };
	function startGesture(e: PointerEvent | TouchEvent, id: string, mode: 'move' | 'resize' | 'row') {
		const pointer = 'pointerId' in e ? e : null;
		const touch = 'changedTouches' in e ? e.changedTouches[0] : null;
		if (pointer && (!pointer.isPrimary || pointer.button !== 0 || pointer.pointerType === 'touch'))
			return;
		if ('touches' in e && e.touches.length !== 1) {
			cancelGesture?.();
			return;
		}
		const start = touch ?? pointer;
		if (!start) return;
		const originX = start.clientX,
			originY = start.clientY;
		cancelGesture?.();
		e.stopPropagation();
		const handle = e.currentTarget as HTMLElement;
		const listeners = new AbortController();
		const options = { capture: true, signal: listeners.signal };

		const r = rows.findIndex((row) => row.some((s) => s.id === id)),
			item = rows[r]?.find((s) => s.id === id);
		if (!item) return;
		resizing = mode === 'resize';
		const row = list.querySelector<HTMLElement>('[data-layout-row="' + r + '"]')!;
		const fit = Number(getComputedStyle(row).getPropertyValue('--player-fit')) || 1,
			initialHeight = row.getBoundingClientRect().height / fit,
			storedHeight = rows[r].map((s) => s.minHeight);
		let armed = false;
		let hold = 0;
		function blockMenu(event: Event) {
			event.preventDefault();
		}

		let x = originX,
			y = originY,
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
				if (Math.abs(y - originY) > 6) setHeight(r, initialHeight + (y - originY) / fit);
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
		function move(point: Point, event: Event) {
			x = point.clientX;
			y = point.clientY;
			const delta = Math.hypot(x - originX, y - originY);
			if (!armed) {
				if (delta > 8) finish();
				return;
			}
			if (touch && event.cancelable) event.preventDefault();
			if (!moved && delta < 5) return;
			moved = true;
			paint();
		}
		function finish(release?: Point) {
			// WebView can coalesce all motion into the final touchend coordinate.
			if (
				release &&
				armed &&
				Math.hypot(release.clientX - originX, release.clientY - originY) >= 5
			) {
				x = release.clientX;
				y = release.clientY;
				moved = true;
				if (mode === 'resize') paint();
			}
			cancelGesture = undefined;
			clearTimeout(hold);
			listeners.abort();
			cancelAnimationFrame(frame);
			if (release && moved) {
				// A compatibility click after a drag must not open the inspector.
				suppressClick = true;
				setTimeout(() => {
					suppressClick = false;
				}, 0);
				if (mode !== 'resize') {
					const dest = dropTarget(release.clientX, release.clientY);
					if (dest && mode === 'row') moveRow(r, dest.r);
					else if (dest) drop(id, dest);
				}
			} else if (!release && mode === 'resize') {
				rows[r]?.forEach((s, c) => (s.minHeight = storedHeight[c]));
			}
			if (pointer && handle.hasPointerCapture(pointer.pointerId))
				handle.releasePointerCapture(pointer.pointerId);
			resizing = false;
			target = null;
			ghost = null;
		}
		const cancel = () => finish();
		cancelGesture = cancel;
		handle.addEventListener('contextmenu', blockMenu, options);
		handle.addEventListener('dragstart', blockMenu, options);
		window.addEventListener('blur', cancel, { signal: listeners.signal });
		document.addEventListener(
			'visibilitychange',
			() => {
				if (document.hidden) cancel();
			},
			options
		);
		if (touch) {
			// Android WebView can cancel its pointer stream while the pressed finger remains down.
			const changed = (event: TouchEvent) =>
				Array.from(event.changedTouches).find((t) => t.identifier === touch.identifier);
			document.addEventListener(
				'touchstart',
				(event) => {
					if (event.touches.length > 1) cancel();
				},
				{ ...options, passive: true }
			);
			document.addEventListener(
				'touchmove',
				(event) => {
					const point = changed(event);
					if (event.touches.length !== 1) cancel();
					else if (point) move(point, event);
				},
				{ ...options, passive: false }
			);
			document.addEventListener(
				'touchend',
				(event) => {
					const point = changed(event);
					if (!point) return;
					if (armed && event.cancelable) event.preventDefault();
					finish(point);
				},
				{ ...options, passive: false }
			);
			document.addEventListener(
				'touchcancel',
				(event) => {
					if (changed(event)) cancel();
				},
				options
			);
		} else if (pointer) {
			handle.setPointerCapture(pointer.pointerId);
			handle.addEventListener(
				'pointermove',
				(event) => {
					if (event.pointerId === pointer.pointerId) move(event, event);
				},
				options
			);
			handle.addEventListener(
				'pointerup',
				(event) => {
					if (event.pointerId === pointer.pointerId) finish(event);
				},
				options
			);
			const cancelled = (event: PointerEvent) => {
				if (event.pointerId === pointer.pointerId) cancel();
			};
			handle.addEventListener('pointercancel', cancelled, options);
			handle.addEventListener('lostpointercapture', cancelled, options);
		}
		hold = window.setTimeout(() => {
			armed = true;
			if (mode !== 'resize')
				ghost = { x, y, name: mode === 'row' ? rowName(r) : sectionTitle(item) };
		}, 380);
		frame = requestAnimationFrame(scrollFrame);
	}

	let templateInput = $state<HTMLTextAreaElement>();
	const rowIndex = $derived(rows.findIndex((row) => row.some((s) => s.id === selected)));
	const column = $derived(rows[rowIndex]?.findIndex((s) => s.id === selected) ?? -1);
	const field = $derived(rows[rowIndex]?.[column]);
	const fieldColumns = $derived(playerColumns(rows[rowIndex] ?? []));
	const indexInRow = $derived(fieldColumns.findIndex((col) => col.some((s) => s.id === selected)));
	const fieldColumn = $derived(fieldColumns[indexInRow] ?? []);
	const indexInColumn = $derived(fieldColumn.findIndex((s) => s.id === selected));
	const used = $derived(new Set(rows.flat().map((s) => s.id)));
	const editingRow = $derived(
		rowAnchor ? rows.findIndex((row) => row.some((s) => s.id === rowAnchor)) : -1
	);

	let measured = $state<Record<string, number>>({});
	$effect(() => {
		const r = editingRow >= 0 ? editingRow : rowIndex;
		const ids = playerColumns(rows[r] ?? []).map((col) => col[0].id);
		if (!ids.length) {
			measured = {};
			return;
		}
		let stopped = false;
		let observer: ResizeObserver | undefined;
		void tick().then(() => {
			if (stopped) return;
			const grid = list?.querySelector<HTMLElement>('[data-layout-row="' + r + '"]');
			if (!grid) return;
			const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-section-id]')).filter(
				(el) => ids.includes(el.dataset.sectionId!)
			);
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
	function openDialog(dialog: HTMLDialogElement) {
		dialog.showModal();
	}
	function fitPreview(stage: HTMLElement) {
		const player = stage.firstElementChild as HTMLElement;
		function measure() {
			if (!player.offsetHeight || !player.offsetWidth) return;
			const scale = Math.min(
				1,
				stage.clientHeight / player.offsetHeight,
				stage.clientWidth / player.offsetWidth
			);
			stage.style.setProperty('--preview-scale', String(scale));
		}
		const observer = new ResizeObserver(measure);
		observer.observe(stage);
		observer.observe(player);
		measure();
		return {
			destroy() {
				observer.disconnect();
			}
		};
	}
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
		const main = mainScroll();
		main?.scrollTo(0, previewScroll);
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
			if (previewOpen) {
				event.preventDefault();
				void closePreview();
			} else if (document.querySelector('dialog[open]')) return;
			else if (selected || editingRow >= 0) {
				event.preventDefault();
				finishInspector();
			} else {
				event.preventDefault();
				void cancel();
			}
		}
		window.addEventListener('dn-back', back);
		function shortcut(event: KeyboardEvent) {
			if (
				event.defaultPrevented ||
				previewOpen ||
				(!event.ctrlKey && !event.metaKey) ||
				event.altKey ||
				document.querySelector('dialog[open]')
			)
				return;
			if (
				event.target instanceof Element &&
				event.target.closest(
					'input, textarea, select, [data-inline-choice], [contenteditable="true"]'
				)
			)
				return;
			const key = event.key.toLowerCase();
			if (key !== 'z' && key !== 'y') return;
			event.preventDefault();
			travel(key === 'y' || event.shiftKey ? 1 : -1);
		}
		window.addEventListener('keydown', shortcut);
		return () => {
			window.removeEventListener('dn-back', back);
			window.removeEventListener('keydown', shortcut);
		};
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
		status = rowName(r) + ' now has ' + playerColumns(rows[r]).length + ' columns.';
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
		const swapped = swapFields(rows, id, slot);
		const from = swapped.findIndex((row) => row.some((s) => s.id === slot)),
			to = swapped.findIndex((row) => row.some((s) => s.id === id));
		if (from !== to) swapped[from] = removeField(swapped[from], slot);
		rows = retainHeader(swapped);
		status = sectionTitle(source) + ' moved.';
		void focusField(id);
	}
	function clearColumn(r: number, c: number) {
		const current = rows[r][c],
			slot = { ...emptyColumn(rows.flat(), current), stack: current.stack };
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
	function remove(r: number, c: number) {
		const item = rows[r][c];
		rows = retainHeader(rows.map((row, i) => (i === r ? removeField(row, item.id) : row)));
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
	function shift(step: number, vertical = false) {
		if (!field) return;
		const nextColumn = fieldColumns[indexInRow + step];
		const target = vertical
			? fieldColumn[indexInColumn + step]
			: nextColumn?.[Math.min(indexInColumn, nextColumn.length - 1)];
		if (!target) return;
		const name = sectionTitle(field);
		rows = swapFields(rows, field.id, target.id);
		swapTarget = null;
		status =
			name +
			(vertical
				? ' moved to subrow ' + (indexInColumn + step + 1)
				: ' moved to column ' + (indexInRow + step + 1)) +
			'.';
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
		if (rows[to] && playerColumns(rows[to]).length === maxPlayerColumns) {
			swapTarget = to;
			return;
		}
		const moved = field;
		const next = rows.map((row) => [...row]);
		next[rowIndex] = removeField(next[rowIndex], moved.id);
		if (to === next.length) next.push([{ ...moved, stack: undefined }]);
		else next[to].push({ ...moved, stack: undefined });
		rows = retainHeader(next);
		status =
			sectionTitle(moved) +
			' moved to row ' +
			(rows.findIndex((row) => row.some((item) => item.id === moved.id)) + 1) +
			'.';
		void focusField(moved.id);
	}
	function swapWith(col: number) {
		if (!field || swapTarget === null || !rows[swapTarget]?.[col]) return;
		const moved = field,
			next = rows.map((row) => [...row]);
		rows = swapFields(rows, moved.id, next[swapTarget][col].id);
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
		if (leaving) return;
		leaving = true;
		try {
			onsave(draft);
		} catch {
			leaving = false;
			error = 'Could not save this layout on the device. Your edits are still here.';
			return;
		}
		// A later open validates its draft against the layout that was just saved.
		void recovery.clear().catch(() => {});
		onback();
	}
	async function cancel() {
		if (leaving) return;
		leaving = true;
		try {
			await recovery.clear();
			onback();
		} catch {
			leaving = false;
			error = 'Could not discard the recovery copy. Try Cancel again.';
		}
	}
	function loadDraft(items: Section[], message: string) {
		rows = playerCanvas(items);
		hidden = items.filter((s) => s.placement === 'hidden');
		select('');
		status = message;
	}
</script>

<div
	class="composer"
	data-part="layout-editor"
	hidden={previewOpen}
	inert={leaving}
	onfocusout={resetEditGroup}
	onpointerdowncapture={resetEditGroup}
>
	<div class="bar">
		<button class="text-button" onclick={cancel}>{uiText('Cancel')}</button>
		{#if selected || editingRow >= 0}<button
				class="text-button inspector-done"
				onclick={finishInspector}
				><ArrowLeft size={16} />
				{prior?.row ? uiText('Back to row') : uiText('Back to layout')}</button
			>{/if}
		<button class="add-row secondary" onclick={addRow}><Plus size={17} />{uiText('Add row')}</button
		>
		<button
			class="secondary preview-action"
			aria-label={uiText('Preview current draft')}
			onclick={showPreview}
			bind:this={previewButton}><Eye size={17} aria-hidden="true" /> {uiText('Preview')}</button
		>
		<button class="primary" aria-label={uiText('Save layout')} onclick={save}
			>{uiText('Save')}<span class="save-suffix"> {uiText('layout')}</span></button
		>
	</div>
	<div class="editor-heading">
		<h1>{uiText('Edit Now Playing')}</h1>
		{#if snapshots.length > 1}
			<div class="history" role="group" aria-label={uiText('Layout history')}>
				<button
					class="icon-button"
					title={uiText('Undo')}
					aria-label={uiText('Undo layout edit')}
					disabled={cursor < 1}
					onclick={() => travel(-1)}><Undo2 size={19} /></button
				>
				<button
					class="icon-button"
					title={uiText('Redo')}
					aria-label={uiText('Redo layout edit')}
					disabled={cursor >= snapshots.length - 1}
					onclick={() => travel(1)}><Redo2 size={19} /></button
				>
			</div>
		{/if}
	</div>
	{#if error}<p role="alert">{error}</p>{/if}
	{#if recoveryIssue}<p role="status">{recoveryIssue}</p>
	{:else if recovery.recovered}<p class="hint" role="status">
			{uiText('Recovered your unsaved layout.')}
		</p>{/if}
	<p class="sr-only" role="status">{status}</p>
	<p class="hint">{uiText('Tap a field to edit it. Press and hold to move a row or field.')}</p>

	<div class="canvas" bind:this={list} aria-label={uiText('Sample player layout')}>
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
				ontouchstart={(e) => startGesture(e, rows[r][0].id, 'row')}
				onpointerdown={(e) => startGesture(e, rows[r][0].id, 'row')}
			>
				<GripVertical size={15} /><strong>{rowName(r)}</strong><span
					>{playerColumns(rows[r]).length}
					{playerColumns(rows[r]).length === 1 ? uiText('column') : uiText('columns')}</span
				>
			</button>
		{/snippet}
		{#snippet overlay(item: Section, r: number, c: number)}
			{#if isPlayerSlot(item.id)}
				<button
					class="field empty"
					aria-label={'Add feature to ' +
						rowName(r).toLowerCase() +
						', column ' +
						(playerColumns(rows[r]).findIndex((col) => col.some((cell) => cell.id === item.id)) +
							1) +
						(item.stack
							? ', subrow ' +
								(playerColumns(rows[r])
									.find((col) => col.some((cell) => cell.id === item.id))!
									.findIndex((cell) => cell.id === item.id) +
									1)
							: '')}
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
					ontouchstart={(e) => startGesture(e, item.id, 'move')}
					onpointerdown={(e) => startGesture(e, item.id, 'move')}
					><span class="grip" data-layout-drag aria-hidden="true" title={uiText('Drag to move')}
						><GripVertical size={16} /></span
					></button
				>
			{/if}
			{#if selected === item.id && !isPlayerSlot(item.id)}<button
					class="resize-corner"
					data-layout-drag
					aria-label={'Resize ' + sectionTitle(item)}
					title={uiText('Resize field')}
					ontouchstart={(e) => startGesture(e, item.id, 'resize')}
					onpointerdown={(e) => startGesture(e, item.id, 'resize')}><Scaling size={17} /></button
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
					setWidth={(c, n) => {
						for (const cell of playerColumns(rows[r])[c]) cell.width = n;
					}}
					addStack={(c) => {
						rows = addSubrow(rows, r, c);
						openField(playerColumns(rows[r])[c].at(-1)!.id, true);
					}}
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
						c={playerColumns(rows[r]).findIndex((col) => col.some((cell) => cell.id === field.id))}
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
							aria-label={uiText('Finish editing field')}
							onclick={finishField}>{uiText('Done')}</button
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
							>{uiText('Text template')}<textarea
								bind:this={templateInput}
								maxlength="512"
								rows="2"
								value={field.template ?? defaultPlayerText}
								oninput={(e) => {
									if (field) field.template = e.currentTarget.value;
								}}
							></textarea></label
						>
						<div class="tokens" role="group" aria-label={uiText('Insert track information')}>
							{#each playerTokens as token (token)}<button
									aria-label={'Insert {' + token + '}'}
									onclick={() => insertToken(token)}>{'{' + token + '}'}</button
								>{/each}
						</div>
					{/if}
					{#if widget?.option && field.id !== 'player-timeline'}<label class="check"
							><input type="checkbox" bind:checked={field.preview} />{widget.option}</label
						>{/if}
					<details class="advanced" bind:open={placementOpen}>
						<summary>{uiText('Placement and sizing')}</summary>
						<div>
							<label
								>{uiText('Section title')}<input
									maxlength="64"
									placeholder={sectionTitle({ ...field, title: '' })}
									bind:value={field.title}
								/></label
							>
							{#if rows.flat().length > 1}<label
									>{uiText('Stack below')}<InlineChoice selected="" label={uiText('Stack below')}
										><select
											value=""
											onchange={(e) => {
												if (field && e.currentTarget.value)
													rows = placeField(rows, field.id, e.currentTarget.value, 'below');
											}}
											><option value="">{uiText('Choose a field')}</option
											>{#each rows as group, ri (group[0].id)}{#each group.filter((s) => s.id !== field?.id && !isPlayerSlot(s.id)) as sibling (sibling.id)}<option
														value={sibling.id}>{rowName(ri)} · {sectionTitle(sibling)}</option
													>{/each}{/each}</select
										></InlineChoice
									></label
								>{/if}
							<div class="pair">
								<label
									>{uiText('Move to row')}<InlineChoice
										selected={(swapTarget ?? rowIndex) - 1}
										label={uiText('Move to row')}
										><select
											value={(swapTarget ?? rowIndex) - 1}
											onchange={(e) => moveField(e.currentTarget.value)}
										>
											{#each rows as dest, i (i)}<option value={i - 1}
													>{rowName(i)}{playerColumns(dest).length === maxPlayerColumns &&
													i !== rowIndex
														? uiText(' (full)')
														: ''}</option
												>{/each}
											<option value="new">{uiText('New row')}</option>
										</select></InlineChoice
									></label
								>
								<label
									>{uiText('Row position')}<InlineChoice
										selected={rowIndex - 1}
										label={uiText('Position')}
										><select
											value={rowIndex - 1}
											onchange={(e) => moveRow(rowIndex, Number(e.currentTarget.value) + 1)}
										>
											{#each rows.keys() as i (i)}<option value={i - 1}>{rowName(i)}</option>{/each}
										</select></InlineChoice
									></label
								>
							</div>
							{#if swapTarget !== null && rows[swapTarget]}
								<label
									>{uiText('Swap with')}<InlineChoice selected="" label={uiText('Swap with')}
										><select value="" onchange={(e) => swapWith(Number(e.currentTarget.value))}
											><option value="" disabled
												>{uiText('Choose a field in')} {rowName(swapTarget)}</option
											>{#each rows[swapTarget] as partner, i (partner.id)}<option value={i}
													>{sectionTitle(partner)}</option
												>{/each}</select
										></InlineChoice
									></label
								>
							{/if}
							{#if fieldColumns.length > 1}
								<div class="moves">
									<button
										class="secondary"
										aria-label={'Move ' + sectionTitle(field) + ' left'}
										disabled={indexInRow === 0}
										onclick={() => shift(-1)}><ArrowLeft size={16} />{uiText('Left')}</button
									>
									<button
										class="secondary"
										aria-label={'Move ' + sectionTitle(field) + ' right'}
										disabled={indexInRow === fieldColumns.length - 1}
										onclick={() => shift(1)}>{uiText('Right')}<ArrowRight size={16} /></button
									>
								</div>
							{/if}
							{#if fieldColumn.length > 1}
								<div class="moves">
									<button
										class="secondary"
										aria-label={'Move ' + sectionTitle(field) + ' up'}
										disabled={indexInColumn === 0}
										onclick={() => shift(-1, true)}>{uiText('Move up')}</button
									>
									<button
										class="secondary"
										aria-label={'Move ' + sectionTitle(field) + ' down'}
										disabled={indexInColumn === fieldColumn.length - 1}
										onclick={() => shift(1, true)}>{uiText('Move down')}</button
									>
								</div>
							{/if}
							<div class="size-tools">
								<label
									>{uiText('Minimum row height (px)')}<input
										aria-label={uiText('Minimum row height')}
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
									ontouchstart={(e) => startGesture(e, field!.id, 'resize')}
									onpointerdown={(e) => startGesture(e, field!.id, 'resize')}
									><Scaling size={17} />{uiText('Drag to resize')}</button
								>
							</div>
						</div>
					</details>
					{#if splitAvailable(field.id)}<button
							class="secondary split"
							aria-label={'Split ' + sectionTitle(field)}
							onclick={split}>{uiText('Split into separate fields')}</button
						>{/if}
					<div class="field-actions">
						<button class="secondary" onclick={() => clearColumn(rowIndex, column)}
							>{fieldColumn.length > 1 ? uiText('Clear field') : uiText('Clear column')}</button
						>
						<button
							class="text-button remove"
							aria-label={'Remove ' + sectionTitle(field)}
							onclick={() => remove(rowIndex, column)}
						>
							{fieldColumn.length > 1
								? uiText('Remove field')
								: rows[r].length === 1
									? uiText('Remove row')
									: uiText('Remove column')}
						</button>
					</div>
				</div>{/if}{/snippet}
		<div class="row-shortcuts">{uiText('Edit player rows')}</div>
		<div class="row-strip" aria-label={uiText('Edit player rows')}>
			{#each rows as group, r (group[0].id)}{@render rowControls(r)}{/each}
		</div>
		<div class="preview-frame">
			<PlayerView
				session={sampleSession}
				expanded={true}
				onexpand={() => {}}
				oncollapse={() => {}}
				onerror={() => {}}
				editor={{
					sections: draft,
					selected,
					overlay
				}}
			/>
		</div>
		{#if editingRow >= 0}{@render inspector(editingRow)}{:else if rowIndex >= 0}{@render inspector(
				rowIndex
			)}{/if}
		{#if !rows.length}<p>{uiText('Add a row to start your layout.')}</p>{/if}
	</div>
	{#if ghost}<div class="ghost" style:left={ghost.x + 'px'} style:top={ghost.y + 'px'}>
			{ghost.name}
		</div>{/if}

	<div class="presets">
		<button
			class="text-button"
			onclick={() => loadDraft(defaults('player'), 'Default layout restored to the draft.')}
			>{uiText('Restore default layout')}</button
		>
	</div>
	<PlayerStyleTransfer
		sections={draft}
		onload={(items) => loadDraft(items, 'Imported draft is ready to edit.')}
	/>
</div>
{#if previewOpen}
	<dialog
		class="composer"
		data-part="layout-preview"
		aria-label={uiText('Player layout preview')}
		use:openDialog
		oncancel={(event) => {
			event.preventDefault();
			void closePreview();
		}}
	>
		<div class="bar">
			<button class="text-button" onclick={closePreview} bind:this={returnButton}
				><ArrowLeft size={18} aria-hidden="true" /> {uiText('Back to editing')}</button
			>
		</div>
		<div class="preview-body" use:fitPreview>
			<PlayerView
				session={sampleSession}
				expanded={true}
				onexpand={() => {}}
				oncollapse={() => {}}
				onerror={() => {}}
				editor={{ sections: draft }}
			/>
		</div>
	</dialog>
{/if}

<style>
	.editor-heading,
	.history {
		display: flex;
		align-items: center;
	}
	.editor-heading {
		justify-content: space-between;
		gap: 0.25rem;
	}
	.editor-heading h1 {
		margin-block: 0.65rem;
	}
	.history {
		flex: none;
	}
	.history button {
		width: 44px;
		height: 44px;
	}
	dialog[data-part='layout-preview'] {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100dvh;
		max-width: none;
		max-height: none;
		margin: 0;
		border: 0;
		box-sizing: border-box;
		padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
		background: var(--bg);
		color: var(--text);
		overflow: hidden;
	}
	dialog[data-part='layout-preview'][open] {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
	}
	dialog .bar {
		position: relative;
		margin: 0 auto;
		padding-inline: var(--gap);
		width: min(100%, 32rem);
	}
	.preview-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		justify-items: center;
		min-height: 0;
		overflow: hidden;
	}
	.preview-body :global([data-part='draft-player']) {
		margin: 0;
		transform-origin: top center;
		transform: scale(var(--preview-scale, 1));
	}
	.preview-action {
		gap: 0.25rem;
	}
	[data-layout-drag],
	[data-layout-drag] :global(*),
	.grip-resize {
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		-webkit-user-drag: none;
	}
	.row-marker {
		touch-action: pan-y;
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
		--player-viewport-height: calc(100dvh - env(safe-area-inset-top));
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
		touch-action: pan-y;
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
		touch-action: pan-y;
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
	.drop[data-edge='after'],
	.drop[data-edge='above'],
	.drop[data-edge='below'] {
		height: 4px;
		left: 0;
		right: 0;
	}
	.drop[data-edge='before'],
	.drop[data-edge='above'] {
		top: 0;
	}
	.drop[data-edge='after'],
	.drop[data-edge='below'] {
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
		touch-action: pan-y;
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
	.drop[data-edge='above'],
	.drop[data-edge='below'] {
		left: 0;
		right: 0;
		height: 4px;
	}
	.drop[data-edge='above'] {
		top: 0;
	}
	.drop[data-edge='below'] {
		bottom: 0;
	}
	.row-shortcuts {
		font-size: 0.8rem;
		color: var(--muted);
		margin: 0.35rem 0 0.15rem;
	}
	.row-strip {
		display: flex;
		gap: 0.3rem;
		overflow-x: auto;
		max-width: 100%;
		margin-bottom: 0.3rem;
	}
	.row-strip .row-marker {
		width: auto;
		min-width: 58px;
		flex: none;
		padding: 0.25rem 0.4rem;
		justify-content: center;
	}
	.row-strip .row-marker span {
		display: none;
	}
	:global(main:has([data-part='layout-editor'])) {
		overflow-anchor: none;
	}
	.preview-frame {
		position: relative;
		left: 50%;
		transform: translateX(-50%);
		height: var(--player-viewport-height);
		width: min(32rem, calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right)));
		min-height: 0;
		overflow: hidden;
	}
	.preview-frame :global([data-part='sample-player']) {
		height: 100%;
		max-height: 100%;
		min-height: 0;
		margin: 0 auto;
	}
</style>
