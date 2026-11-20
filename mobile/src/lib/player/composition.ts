import { trackToolFields } from './layout';
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
