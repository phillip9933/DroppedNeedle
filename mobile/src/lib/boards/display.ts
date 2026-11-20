export type BoardDisplay = {
	layout: 'grid' | 'list';
	columns: number;
	listColumns: number;
	columnSize: 'small' | 'medium' | 'large';
	rows: number;
	density: 'compact' | 'normal' | 'spacious';
};
export type Preview = BoardDisplay & { limit: number; capacity: number; visibleColumns: number };

export function boardDisplay(id: string, value?: Partial<BoardDisplay> | null): BoardDisplay {
	const covers =
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
		columns: bounded(value?.columns, 4, 6),
		listColumns: bounded(value?.listColumns, 1, 6),
		columnSize:
			value?.columnSize === 'small' || value?.columnSize === 'large' ? value.columnSize : 'medium',
		rows: bounded(value?.rows, covers ? 1 : 3, 6),
		density:
			value?.density === 'compact' || value?.density === 'spacious' ? value.density : 'normal'
	};
}
function bounded(value: unknown, fallback: number, max: number) {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
		? value
		: fallback;
}

export function measurePreview(display: BoardDisplay, width: number, expanded = false): Preview {
	const grid = display.layout === 'grid';
	const min = (
		grid ? { small: 92, medium: 126, large: 176 } : { small: 156, medium: 216, large: 288 }
	)[display.columnSize];
	const max = grid ? display.columns : display.listColumns;
	const gap = { compact: 6, normal: 10, spacious: 16 }[display.density];
	const visibleColumns = Math.max(1, Math.min(max, Math.floor((width + gap) / (min + gap))));
	return {
		...display,
		visibleColumns,
		limit: expanded ? Infinity : visibleColumns * display.rows,
		capacity: max * display.rows
	};
}
