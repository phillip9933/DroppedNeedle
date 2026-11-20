import { navigationFields, trackToolFields } from './layout';
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

// A missing sameRow starts a fresh row, including every section from the original phone layout.
export function playerRows(sections: Section[]): Section[][] {
	const rows: Section[][] = [];
	for (const section of sections) {
		if (section.placement) continue;
		const previous = rows.at(-1);
		if (section.sameRow && previous && previous.length < maxPlayerColumns) previous.push(section);
		else rows.push([section]);
	}
	return rows;
}

export function flattenPlayerRows(rows: Section[][]): Section[] {
	return rows.flatMap((row) =>
		row.map((section, index) => ({ ...section, sameRow: index % maxPlayerColumns !== 0 }))
	);
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
	const header = sections.filter((s) => s.placement === 'header').map(canvasCell);
	const first = header.length ? header.slice(0, maxPlayerColumns) : legacyHeader(sections);
	return [
		first.length ? first : [{ id: nextSlotId(sections), title: '', preview: true }],
		...playerRows(flattenPlayerRows([header.slice(maxPlayerColumns)])),
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
	if (row.length < 2) return '0px';
	const gaps = row.flatMap((s) => (s.gap === undefined ? [] : [s.gap]));
	const desired = gaps.length
		? Math.max(...gaps) + 'px'
		: header || row.every((s) => s.padding === 0)
			? '0px'
			: 'min(var(--gap),3vw)';
	return `max(0px,min(${desired},calc((100% - ${row.length * 44}px) / ${row.length - 1})))`;
}
export function rowName(r: number) {
	return r === 0 ? 'Header' : 'Row ' + r;
}

const parts: Record<string, string[]> = {
	'player-track': ['player-title', 'player-artist', 'player-album'],
	'player-transport': ['player-previous', 'player-toggle', 'player-next'],
	'player-modes': ['player-repeat', 'player-shuffle'],
	'player-tools': trackToolFields.map((w) => w.id),
	'player-timeline': ['player-seek', 'player-elapsed', 'player-duration']
};

export function splitAvailable(id: string) {
	return Object.hasOwn(parts, id);
}
export function splitPlayerSection(section: Section): Section[] {
	const ids = parts[section.id];
	if (!ids) return [section];
	return ids
		.filter(
			(id) => !['player-album', 'player-elapsed', 'player-duration'].includes(id) || section.preview
		)
		.map((id, i) => ({
			id,
			title: i === 0 ? section.title : '',
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
						? id === 'player-duration'
						: section.id === 'player-tools'
							? id === 'player-playlist'
							: section.id !== 'player-track'
		}));
}

/** Keep explicitly grouped, titled or already composed layouts intact. Plain legacy metadata
 * can become independent rows without losing adjacent columns, duplicate fields or a custom heading. */
export function expandLegacyTrack(sections: Section[]): Section[] {
	const group = sections.find((s) => s.id === 'player-track');
	if (
		!group ||
		group.title ||
		group.placement ||
		group.minHeight ||
		group.padding ||
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

export function sideBySidePlayer(): Section[] {
	const cell = (id: string, options: Partial<Section> = {}): Section => ({
		id,
		title: '',
		preview: true,
		...options
	});
	return flattenPlayerRows([
		[cell('player-artwork')],
		[
			cell('player-title', { width: 2 }),
			cell('player-duration', { align: 'end', textSize: 'small' })
		],
		[cell('player-artist'), cell('player-album', { align: 'end' })],
		[cell('player-timeline', { preview: false })],
		[
			cell('player-previous', { align: 'center' }),
			cell('player-toggle', { align: 'center' }),
			cell('player-next', { align: 'center' })
		],
		[cell('player-lyrics', { preview: false })],
		[cell('player-tools', { preview: false })]
	]);
}
