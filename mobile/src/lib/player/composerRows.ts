import type { Section } from '../boards/layout';
import {
	flattenColumns,
	playerColumns,
	flattenPlayerRows,
	isPlayerSlot,
	isPlayerText,
	maxPlayerColumns,
	nextSlotId,
	nextTextId,
	playerRows,
	splitAvailable,
	splitPlayerSection
} from './composition';
import { playerWidgets } from './layout';

export function emptyColumn(used: Section[], like?: Section): Section {
	return {
		id: nextSlotId(used),
		title: '',
		preview: true,
		width: like?.width,
		minHeight: like?.minHeight,
		gap: like?.gap
	};
}

export function retainHeader(rows: Section[][]): Section[][] {
	return [
		rows[0]?.length ? rows[0] : [emptyColumn(rows.flat())],
		...rows.slice(1).filter((r) => r.length)
	];
}

export function resizeColumns(rows: Section[][], index: number, count: number): Section[][] {
	if (!rows[index] || !Number.isInteger(count) || count < 1 || count > maxPlayerColumns)
		return rows;
	const next = rows.map((row) => [...row]);
	const columns = playerColumns(next[index]);
	while (columns.length < count)
		columns.push([
			emptyColumn(next.flat().concat(columns.flat()), { ...rows[index][0], width: undefined })
		]);
	while (columns.length > count) {
		const empty = columns.map((col) => col.every((s) => isPlayerSlot(s.id))).lastIndexOf(true);
		if (empty < 0) break;
		columns.splice(empty, 1);
	}
	if (columns.length > count) next.splice(index + 1, 0, flattenColumns(columns.splice(count)));
	next[index] = flattenColumns(columns);
	return next;
}

export function newField(id: string, sections: Section[]): Section {
	return {
		id: isPlayerText(id) ? nextTextId(sections) : id,
		title: '',
		preview: playerWidgets.find((w) => w.id === id)?.enabled ?? true
	};
}

// Extract a feature from a legacy grouped widget without duplicating its independently placed siblings.
function ungroup(rows: Section[][], wanted: string): { rows: Section[][]; part?: Section } {
	const existing = new Set(rows.flat().map((s) => s.id));
	let part: Section | undefined;
	const expanded = rows.flatMap((row, r) => {
		const result = flattenPlayerRows([row]).flatMap((cell) => {
			if (!splitAvailable(cell.id)) return [cell];
			const parts = splitPlayerSection(cell);
			const match = parts.find((p) => p.id === wanted);
			if (!match) return [cell];
			part = match;
			const keep = parts.filter((p) => p.id !== wanted && !existing.has(p.id));
			if (keep.length) keep[0].sameRow = cell.sameRow;
			return keep;
		});
		return !result.length && r === 0 ? [[]] : playerRows(result);
	});
	return { rows: expanded, part };
}

export function fillColumn(
	rows: Section[][],
	slotId: string,
	option: string,
	header?: Section
): { rows: Section[][]; id: string } {
	const slot = rows.flat().find((s) => s.id === slotId);
	if (!slot || !isPlayerSlot(slot.id)) return { rows, id: slotId };
	const repeatedText = isPlayerText(option);
	const previous = repeatedText ? undefined : rows.flat().find((s) => s.id === option);
	const extracted = repeatedText ? { rows, part: undefined } : ungroup(rows, option);
	const origin = previous ?? extracted.part ?? header ?? newField(option, rows.flat());
	const placed: Section = {
		...origin,
		placement: undefined,
		width: slot.width,
		minHeight: slot.minHeight,
		gap: slot.gap
	};
	const next = extracted.rows.map((row) => {
		const same = row.some((s) => s.id === slotId);
		return flattenColumns(
			playerColumns(row).map((col) =>
				col.flatMap((cell) => {
					if (cell.id === slotId) return [placed];
					if (previous && cell.id === previous.id)
						return same && col.length === 1
							? [{ ...slot, width: cell.width, minHeight: cell.minHeight }]
							: [];
					return [cell];
				})
			)
		);
	});
	return { rows: retainHeader(next), id: placed.id };
}

export function removeField(row: Section[], id: string): Section[] {
	return flattenColumns(
		playerColumns(row).map((col) => {
			const filtered = col.filter((s) => s.id !== id);
			if (filtered.length && filtered[0] !== col[0])
				filtered[0] = { ...filtered[0], width: col[0].width };
			return filtered;
		})
	);
}
export function swapFields(rows: Section[][], a: string, b: string): Section[][] {
	const cells = rows.flat(),
		left = cells.find((s) => s.id === a),
		right = cells.find((s) => s.id === b);
	if (!left || !right) return rows;
	return rows.map((row) =>
		row.map((slot) => {
			const item = slot.id === a ? right : slot.id === b ? left : undefined;
			return item
				? {
						...item,
						stack: slot.stack,
						width: slot.width,
						minHeight: slot.minHeight,
						gap: slot.gap
					}
				: slot;
		})
	);
}
export type DropEdge = 'left' | 'right' | 'above' | 'below' | 'before' | 'after';
export function placeField(
	rows: Section[][],
	id: string,
	target: string,
	edge: DropEdge
): Section[][] {
	if (id === target) return rows;
	const item = rows.flat().find((s) => s.id === id);
	if (!item) return rows;
	const r = rows.findIndex((row) => row.some((s) => s.id === target));
	if (r < 0) return rows;
	const next = rows.map((row) => removeField(row, id));
	const groups = playerColumns(next[r]),
		c = groups.findIndex((col) => col.some((s) => s.id === target));
	const moved = { ...item, stack: undefined };
	if (edge === 'before' || edge === 'after')
		next.splice(r + (edge === 'after' ? 1 : 0), 0, [moved]);
	else {
		if (edge === 'above' || edge === 'below') {
			const j = groups[c].findIndex((s) => s.id === target);
			moved.width = groups[c][0].width;
			groups[c].splice(j + (edge === 'below' ? 1 : 0), 0, moved);
		} else {
			if (groups.length >= maxPlayerColumns) return swapFields(rows, id, target);
			groups.splice(c + (edge === 'right' ? 1 : 0), 0, [moved]);
		}
		next[r] = flattenColumns(groups);
	}
	return retainHeader(next);
}
export function addSubrow(rows: Section[][], r: number, c: number): Section[][] {
	const groups = playerColumns(rows[r]);
	if (!groups[c]) return rows;
	groups[c].push(emptyColumn(rows.flat(), groups[c][0]));
	return rows.map((row, index) => (index === r ? flattenColumns(groups) : row));
}
