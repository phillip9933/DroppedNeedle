import { navigationFields } from './layout';
export { isPlayerText } from './layout';
import type { Section } from '../boards/layout';

export const maxPlayerColumns = 6;
export function isPlayerSlot(id: string) {
	return /^player-slot-[1-9]\d*$/.test(id);
}
export function nextSlotId(sections: readonly Section[]) {
	const used = new Set(sections.map((s) => s.id));
	let index = 1;
	while (used.has('player-slot-' + index)) index++;
	return 'player-slot-' + index;
}

export function playerColumns(row: Section[]): Section[][] {
	const columns: Section[][] = [];
	for (const section of row) {
		const last = columns.at(-1);
		if (section.stack && last) last.push(section);
		else columns.push([section]);
	}
	return columns;
}
export function flattenColumns(columns: Section[][]): Section[] {
	return columns.flatMap((column) =>
		column.map((cell, i) => ({ ...cell, stack: i > 0 || undefined }))
	);
}
export function playerRows(sections: Section[]): Section[][] {
	const rows: Section[][] = [];
	let columns = 0;
	for (const section of sections) {
		if (section.placement) continue;
		const row = rows.at(-1);
		if (row && section.sameRow && (section.stack || columns < maxPlayerColumns)) {
			row.push(section);
			if (!section.stack) columns++;
		} else {
			rows.push([section]);
			columns = 1;
		}
	}
	return rows;
}
export function flattenPlayerRows(rows: Section[][]): Section[] {
	return rows.flatMap((row) => row.map((cell, i) => ({ ...cell, sameRow: i !== 0 })));
}
export function migratePlayerFields(sections: Section[]): Section[] {
	if (!sections.some((s) => s.id === 'player-menu' || s.id === 'player-tools')) return sections;
	const hasMore = sections.some((s) => s.id === 'player-more');
	const removed = (s: Section) => s.id === 'player-menu' || (hasMore && s.id === 'player-tools');
	const changes = new Map<Section, Partial<Section>>();
	const header = sections.filter((s) => s.placement === 'header');
	for (const row of [...playerRows(sections), header]) {
		let first = true;
		for (const column of playerColumns(row)) {
			const remaining = column.filter((s) => !removed(s));
			if (!remaining.length) continue;
			const lead = remaining[0],
				patch: Partial<Section> = {};
			if (lead !== column[0]) {
				patch.stack = false;
				patch.width = column[0].width;
			}
			if (first && row[0] !== lead && lead.sameRow) patch.sameRow = false;
			changes.set(lead, patch);
			first = false;
		}
	}
	const emptyHeader = header.length > 0 && header.every(removed);
	return sections.flatMap((s) => {
		if (emptyHeader && s === header[0])
			return [{ id: nextSlotId(sections), title: '', preview: true, placement: 'header' as const }];
		if (removed(s)) return [];
		return [{ ...s, ...changes.get(s), id: s.id === 'player-tools' ? 'player-more' : s.id }];
	});
}

function canvasCell(section: Section): Section {
	const cell = { ...section };
	delete cell.sameRow;
	delete cell.placement;
	return cell;
}
/** Old layouts omitted default navigation or recorded a side for each control separately. */
function legacyHeader(sections: Section[]): Section[] {
	const sides: Record<'header-start' | 'header-end', Section[]> = {
		'header-start': [],
		'header-end': []
	};
	for (const { id } of navigationFields) {
		const saved = sections.find((s) => s.id === id);
		// Older compositions that placed navigation explicitly keep their original columns.
		if (id === 'player-menu') continue;
		const side = saved ? saved.placement : id === 'player-close' ? 'header-start' : 'header-end';
		if (side === 'header-start' || side === 'header-end') {
			sides[side].push(canvasCell(saved ?? { id, title: '', preview: true }));
		}
	}
	return [
		...sides['header-start'],
		...(sections.some((s) => s.id === 'player-heading')
			? []
			: [
					{
						id: 'player-heading',
						title: '',
						preview: true,
						width: 2,
						align: 'center' as const,
						maxLines: 2
					}
				]),
		...sides['header-end']
	];
}

// Row zero is the header. Keep body positions and old exports intact until a listener changes it.
export function playerCanvas(sections: Section[]): Section[][] {
	sections = migratePlayerFields(sections);
	const header = sections.filter((s) => s.placement === 'header').map(canvasCell);
	const first = header.length
		? flattenColumns(playerColumns(header).slice(0, maxPlayerColumns))
		: legacyHeader(sections);
	return [
		first.length ? first : [{ id: nextSlotId(sections), title: '', preview: true }],
		...playerRows(
			flattenPlayerRows([flattenColumns(playerColumns(header).slice(maxPlayerColumns))])
		),
		...playerRows(sections)
	];
}
export function packPlayerCanvas(rows: Section[][], hidden: Section[]): Section[] {
	const body = flattenPlayerRows(rows.slice(1));
	const placed = new Set(rows.flat().map((s) => s.id));
	const extras = hidden.filter((s) => !placed.has(s.id));
	const header = rows[0].map(canvasCell);
	const old = legacyHeader([...body, ...extras]);
	const same =
		header.length === old.length &&
		header.every((cell, i) => {
			const keys = new Set([...Object.keys(cell), ...Object.keys(old[i])] as (keyof Section)[]);
			return [...keys].every((key) => cell[key] === old[i][key]);
		});
	return [
		...body,
		...(same ? [] : header.map((s) => ({ ...s, placement: 'header' as const }))),
		...extras
	];
}
// Leave enough space for tap targets before adding the requested gap on a narrow phone.
export function playerRowGap(row: Section[], header: boolean): string {
	const count = playerColumns(row).length;
	if (count < 2) return '0px';
	const gaps = row.flatMap((s) => (s.gap === undefined ? [] : [s.gap]));
	const desired = gaps.length
		? Math.max(...gaps) + 'px'
		: header || row.every((s) => s.padding === 0)
			? '0px'
			: 'min(var(--gap),3vw)';
	return `max(0px,min(${desired},calc((100% - ${count * 44}px) / ${count - 1})))`;
}
export function rowName(r: number) {
	return r === 0 ? 'Header' : 'Row ' + r;
}

const parts: Record<string, string[]> = {
	'player-track': ['player-title', 'player-artist', 'player-album'],
	'player-transport': ['player-previous', 'player-toggle', 'player-next'],
	'player-modes': ['player-repeat', 'player-shuffle'],
	'player-timeline': ['player-seek', 'player-elapsed', 'player-duration', 'player-remaining']
};

export function splitAvailable(id: string) {
	return Object.hasOwn(parts, id);
}
export function splitPlayerSection(section: Section): Section[] {
	const ids = parts[section.id];
	if (!ids) return [section];
	return ids
		.filter((id) => {
			if (id === 'player-elapsed') return section.showElapsed ?? section.preview;
			if (id === 'player-duration') return section.showDuration ?? section.preview;
			if (id === 'player-remaining') return section.showRemaining ?? false;
			return id !== 'player-album' || section.preview;
		})
		.map((id, i) => ({
			id,
			title: i === 0 ? section.title : '',
			...(id === 'player-seek'
				? {
						seekStyle: section.seekStyle,
						showElapsed: false,
						showDuration: false,
						showRemaining: false
					}
				: {}),
			...(i === 0
				? {
						stack: section.stack,
						labelName: section.labelName,
						labelPosition: section.labelPosition
					}
				: {}),
			preview: section.preview,
			width: section.width,
			align: section.align,
			textSize: section.textSize,
			minHeight: section.minHeight,
			gap: section.gap,
			contentWidth: section.contentWidth,
			padding: section.padding ?? (section.id === 'player-track' ? 0 : undefined),
			vAlign: section.vAlign,
			maxLines: section.maxLines,
			reserveLines: section.reserveLines,
			iconSize: section.iconSize,
			showLabel: section.showLabel,
			sameRow:
				i === 0
					? section.sameRow
					: section.id === 'player-timeline'
						? id === 'player-duration' || id === 'player-remaining'
						: section.id !== 'player-track'
		}));
}

/** Keep explicitly grouped, titled or already composed layouts intact. Plain legacy metadata
 * can become independent rows without losing adjacent columns, duplicate fields or a custom heading. */
export function expandLegacyTrack(sections: Section[]): Section[] {
	if (sections.some((s) => s.grid)) return sections;
	sections = migratePlayerFields(sections).map((field) =>
		field.id === 'player-timeline' && !field.preview
			? {
					...field,
					showElapsed: field.showElapsed ?? false,
					showDuration: field.showDuration ?? false
				}
			: field
	);
	const group = sections.find((s) => s.id === 'player-track');
	if (
		!group ||
		group.title ||
		group.placement ||
		group.minHeight ||
		group.padding ||
		group.showLabel ||
		group.labelName ||
		group.icon ||
		group.seekStyle ||
		sections.some((s) => ['player-title', 'player-artist', 'player-album'].includes(s.id))
	)
		return sections;
	const row = playerRows(sections).find((r) => r.includes(group));
	return row?.length === 1
		? sections.flatMap((s) => (s === group ? splitPlayerSection(s) : [s]))
		: sections;
}

export function nextTextId(sections: Section[]) {
	const used = new Set(sections.map((s) => s.id));
	if (!used.has('player-text')) return 'player-text';
	let index = 2;
	while (used.has('player-text-' + index)) index++;
	return 'player-text-' + index;
}
export const playerTokens = [
	'title',
	'artist',
	'album',
	'elapsed',
	'duration',
	'remaining',
	'position',
	'count'
] as const;
export const defaultPlayerText = '{title} · {artist}';
export function formatPlayerText(template: string | undefined, values: Record<string, string>) {
	return (template ?? defaultPlayerText).replace(/\{(\w+)\}/g, (token, key: string) =>
		playerTokens.some((t) => t === key) && Object.hasOwn(values, key) ? values[key] : token
	);
}
