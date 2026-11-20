import type { Section } from '../boards/layout';
import {
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
		minHeight: like?.minHeight
	};
}

export function resizeColumns(rows: Section[][], index: number, count: number): Section[][] {
	if (!rows[index] || !Number.isInteger(count) || count < 1 || count > maxPlayerColumns)
		return rows;
	const next = rows.map((row) => [...row]);
	const row = next[index];
	while (row.length < count) row.push(emptyColumn(next.flat(), { ...row[0], width: undefined }));
	// Empty cells go first. Any music or controls that no longer fit stay in the following row.
	while (row.length > count) {
		const lastEmpty = row.map((cell) => isPlayerSlot(cell.id)).lastIndexOf(true);
		if (lastEmpty < 0) break;
		row.splice(lastEmpty, 1);
	}
	if (row.length > count) next.splice(index + 1, 0, row.splice(count));
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
	const expanded = rows.flatMap((row) => {
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
		return playerRows(result);
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
		minHeight: slot.minHeight
	};
	const next = extracted.rows
		.map((row) => {
			const same = row.some((s) => s.id === slotId);
			return row.flatMap((cell) => {
				if (cell.id === slotId) return [placed];
				if (previous && cell.id === previous.id) {
					// Repositioning within one row exchanges its feature and empty cell.
					return same ? [{ ...slot, width: cell.width, minHeight: cell.minHeight }] : [];
				}
				return [cell];
			});
		})
		.filter((row) => row.length);
	return { rows: next, id: placed.id };
}

export const transportFields = [
	'player-shuffle',
	'player-previous',
	'player-toggle',
	'player-next',
	'player-repeat'
];

export function fiveControlRow(rows: Section[][]): Section[][] {
	const at = rows.findIndex((row) =>
		row.some(
			(s) =>
				s.id === 'player-transport' || s.id === 'player-modes' || transportFields.includes(s.id)
		)
	);
	const slot = emptyColumn(rows.flat());
	const next = [...rows];
	next.splice(at < 0 ? next.length : at, 0, [slot]);
	let draft = resizeColumns(
		next,
		next.findIndex((row) => row[0].id === slot.id),
		transportFields.length
	);
	const slots = draft.find((row) => row[0].id === slot.id)!.map((s) => s.id);
	for (const [i, id] of transportFields.entries()) draft = fillColumn(draft, slots[i], id).rows;
	return draft;
}
