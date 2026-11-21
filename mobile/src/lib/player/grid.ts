import type { Section } from '../boards/layout';
import { isPlayerSlot, playerCanvas, playerColumns } from './composition';

export const GRID_COLUMNS = 15;
export const GRID_ROWS = 20;
export type GridRect = { x: number; y: number; w: number; h: number };
export type GridSection = Section & { grid: GridRect };

export function validGridRect(value: unknown): value is GridRect {
	if (!value || typeof value !== 'object') return false;
	const { x, y, w, h } = value as GridRect;
	return (
		[x, y, w, h].every(Number.isInteger) &&
		x >= 0 &&
		y >= 0 &&
		w > 0 &&
		h > 0 &&
		x + w <= GRID_COLUMNS &&
		y + h <= GRID_ROWS
	);
}

export function gridFits(box: GridRect, sections: readonly Section[], ignoreId?: string): boolean {
	return (
		validGridRect(box) &&
		!sections.some(
			({ id, grid }) =>
				id !== ignoreId &&
				grid &&
				box.x < grid.x + grid.w &&
				grid.x < box.x + box.w &&
				box.y < grid.y + grid.h &&
				grid.y < box.y + box.h
		)
	);
}

export function isPlayerGrid(sections: Section[]): sections is GridSection[] {
	return (
		sections.length > 0 &&
		sections.every((s, i) => validGridRect(s.grid) && gridFits(s.grid, sections.slice(0, i)))
	);
}

export function emptyGridSpace(sections: readonly Section[], w = 1, h = 1): GridRect | undefined {
	if (!validGridRect({ x: 0, y: 0, w, h })) return;
	for (let y = 0; y <= GRID_ROWS - h; y++) {
		for (let x = 0; x <= GRID_COLUMNS - w; x++) {
			const box = { x, y, w, h };
			if (gridFits(box, sections)) return box;
		}
	}
}

export function gridIconSize(id: string): number {
	return id === 'player-toggle' ? 34 : 22;
}

// Keep the five transport buttons equal and leave an available tile in the utility row.
export function defaultGridLayout(): GridSection[] {
	const tile = (
		name: string,
		x: number,
		y: number,
		w: number,
		h: number,
		options: Partial<Section> = {}
	): GridSection => ({
		id: 'player-' + name,
		title: '',
		preview: true,
		...options,
		grid: { x, y, w, h }
	});
	return [
		tile('artwork', 0, 0, 15, 9),
		tile('title', 0, 9, 12, 1, { padding: 3, maxLines: 1 }),
		tile('artist', 0, 10, 12, 1, { padding: 3, maxLines: 1 }),
		tile('favorite', 12, 9, 3, 2, { padding: 4 }),
		tile('album', 0, 11, 9, 1, { padding: 3, maxLines: 1 }),
		tile('quality', 9, 11, 6, 1, { padding: 3 }),
		tile('timeline', 0, 12, 15, 3, { padding: 3 }),
		...['shuffle', 'previous', 'toggle', 'next', 'repeat'].map((id, i) =>
			tile(id, i * 3, 15, 3, 3, { padding: 4 })
		),
		...['lyrics', 'output', 'queue', 'more'].map((id, i) =>
			tile(id, [0, 3, 9, 12][i], 18, 3, 2, { padding: 4 })
		)
	];
}

// Allocate integer grid spans proportionally, reserving a cell for every visible field.
function spans(total: number, weights: number[], minimum = weights.map(() => 1)): number[] {
	const space = total - minimum.reduce((a, b) => a + b, 0);
	const sum = weights.reduce((a, b) => a + b, 0);
	const exact = weights.map((weight) => (weight / sum) * space);
	const result = exact.map((v, i) => minimum[i] + Math.floor(v));
	const byRemainder = exact
		.map((v, i) => ({ i, fraction: v - Math.floor(v) }))
		.sort((a, b) => b.fraction - a.fraction);
	const remainder = total - result.reduce((a, b) => a + b, 0);
	for (const { i } of byRemainder.slice(0, remainder)) result[i]++;
	return result;
}

function place(section: Section, grid: GridRect): GridSection {
	const placed = { ...section, grid };
	delete placed.sameRow;
	delete placed.stack;
	delete placed.placement;
	return placed;
}

export function toPlayerGrid(sections: Section[]): GridSection[] {
	if (isPlayerGrid(sections)) return sections.map((s) => ({ ...s, grid: { ...s.grid } }));
	const rows = playerCanvas(sections).map(playerColumns);
	const minimum = rows.map((cols) => Math.max(...cols.map((cells) => cells.length)));
	if (minimum.reduce((sum, n) => sum + n, 0) > GRID_ROWS) {
		// Even very tall old layouts can retain their fields, in the original reading order.
		const fields = rows.flat(2);
		if (fields.length > GRID_COLUMNS * GRID_ROWS)
			throw Error('This layout has more items than the player grid can hold.');
		const columns = Math.ceil(fields.length / GRID_ROWS);
		const widths = spans(GRID_COLUMNS, Array(columns).fill(1));
		return fields.map((s, i) => {
			const c = i % columns;
			return place(s, {
				x: widths.slice(0, c).reduce((sum, w) => sum + w, 0),
				y: Math.floor(i / columns),
				w: widths[c],
				h: 1
			});
		});
	}
	const heights = spans(
		GRID_ROWS,
		rows.map((cols) => {
			const fields = cols.flat();
			const natural = fields.some((s) => s.id === 'player-artwork') ? 360 : 44;
			return Math.max(natural, ...fields.map((s) => s.minHeight ?? 0));
		}),
		minimum
	);
	const grid: GridSection[] = [];
	let y = 0;
	rows.forEach((cols, r) => {
		const widths = spans(
			GRID_COLUMNS,
			cols.map((cells) => cells[0].width ?? 1)
		);
		let x = 0;
		cols.forEach((cells, c) => {
			const subHeights = spans(
				heights[r],
				cells.map((s) => (s.id === 'player-artwork' ? 8 : 1))
			);
			let subY = y;
			cells.forEach((s, i) => {
				grid.push(place(s, { x, y: subY, w: widths[c], h: subHeights[i] }));
				subY += subHeights[i];
			});
			x += widths[c];
		});
		y += heights[r];
	});
	return grid;
}

export function editablePlayerGrid(sections: Section[]) {
	return toPlayerGrid(sections).filter((section) => !isPlayerSlot(section.id));
}

export function emptyPlayerTile(): GridSection {
	return { id: 'player-slot-1', title: '', preview: true, grid: { x: 0, y: 0, w: 1, h: 1 } };
}
