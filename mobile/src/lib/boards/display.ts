import type { LibraryKind } from './filteredSections';

export type BoardDisplay = {
	layout: 'grid' | 'list';
	columns: number;
	listColumns: number;
	rows: number;
	density: 'compact' | 'normal' | 'spacious';
};
export type Preview = BoardDisplay & { limit: number; capacity: number; visibleColumns: number };

export function boardDisplay(
	id: string,
	value?: Partial<BoardDisplay> | null,
	kind?: LibraryKind
): BoardDisplay {
	const covers =
		kind === 'albums' ||
		/albums|recently-added|top_picks|discover_queue|releases|rediscover|anniversaries|essentials|because_you_listen_to/.test(
			id
		);
	return {
		layout:
			value?.layout === 'list' || value?.layout === 'grid'
				? value.layout
				: covers
					? 'grid'
					: 'list',
		columns: bounded(value?.columns, 2, 6),
		listColumns: bounded(value?.listColumns, 1, 6),
		rows: bounded(value?.rows, covers ? 2 : 3, 6),
		density:
			value?.density === 'compact' || value?.density === 'spacious' ? value.density : 'normal'
	};
}
function bounded(value: unknown, fallback: number, max: number) {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
		? value
		: fallback;
}

export function boardPreview(display: BoardDisplay, expanded = false): Preview {
	const visibleColumns = display.layout === 'grid' ? display.columns : display.listColumns;
	const capacity = visibleColumns * display.rows;
	return {
		...display,
		visibleColumns,
		limit: expanded ? Infinity : capacity,
		capacity
	};
}
