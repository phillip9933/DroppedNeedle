import type { Section } from '../boards/layout';
import { expandLegacyTrack, isPlayerSlot, isPlayerText } from './composition';
import {
	playerMeasurements,
	validMeasurement,
	isNavigation,
	isPlayerIcon,
	playerFields,
	playerWidgets
} from './layout';

const format = 'droppedneedle-player-layout';
const keys = [
	'id',
	'title',
	'preview',
	'sameRow',
	'width',
	'align',
	'textSize',
	'template',
	'minHeight',
	'gap',
	'placement',
	'contentWidth',
	'padding',
	'vAlign',
	'icon',
	'iconSize',
	'showLabel',
	'maxLines',
	'reserveLines'
] as const satisfies readonly (keyof Section)[];
const knownIds = new Set<string>([...playerFields, ...playerWidgets].map((item) => item.id));
const maxBytes = 64 * 1024;
function fits(text: string) {
	return text.length <= maxBytes && new TextEncoder().encode(text).byteLength <= maxBytes;
}
function checkSize(text: string) {
	if (!fits(text)) throw Error('Use a layout no larger than 64 KiB.');
}
export function exportPlayerStyle(sections: Section[]) {
	// A layout can cross devices or accounts. Serialize only the composition fields.
	const fields = sections.map((s) =>
		Object.fromEntries(keys.filter((key) => s[key] !== undefined).map((key) => [key, s[key]]))
	);
	const layout = { format, version: 1, sections: fields };
	const readable = JSON.stringify(layout, null, 2);
	if (fits(readable)) return readable;
	const compact = JSON.stringify(layout);
	checkSize(compact);
	return compact;
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readSection(item: unknown, index: number): Section {
	const label = `Element ${index + 1}`;
	if (!record(item)) throw Error(`${label} must be an object.`);
	const {
		id,
		title,
		preview,
		sameRow,
		align,
		textSize,
		template,
		placement,
		vAlign,
		icon,
		showLabel,
		reserveLines
	} = item;
	if (typeof id !== 'string' || !(knownIds.has(id) || isPlayerText(id) || isPlayerSlot(id)))
		throw Error(`${label} has an unknown player element ID.`);
	if (Object.keys(item).some((key) => !keys.some((known) => known === key)))
		throw Error(`${label} has an unknown option.`);
	if (typeof title !== 'string' || title.length > 64)
		throw Error(`${label} needs a title of up to 64 characters.`);
	if (typeof preview !== 'boolean') throw Error(`${label} needs a true or false preview option.`);
	if (sameRow !== undefined && typeof sameRow !== 'boolean')
		throw Error(`${label} has an invalid row setting.`);
	const measurements: Partial<Pick<Section, (typeof playerMeasurements)[number]>> = {};
	for (const name of playerMeasurements) {
		const value = item[name];
		if (value === undefined) continue;
		if (!validMeasurement(name, value)) throw Error(`${label} has an invalid ${name}.`);
		measurements[name] = value;
	}
	if (icon !== undefined && !isPlayerIcon(icon)) throw Error(`${label} has an invalid icon.`);
	if (vAlign !== undefined && vAlign !== 'start' && vAlign !== 'center' && vAlign !== 'end')
		throw Error(`${label} has an invalid vertical alignment.`);
	if (showLabel !== undefined && typeof showLabel !== 'boolean')
		throw Error(`${label} has an invalid label setting.`);
	if (reserveLines !== undefined && typeof reserveLines !== 'boolean')
		throw Error(`${label} has an invalid line reservation.`);
	if (align !== undefined && align !== 'start' && align !== 'center' && align !== 'end')
		throw Error(`${label} has an invalid alignment.`);
	if (
		textSize !== undefined &&
		textSize !== 'small' &&
		textSize !== 'normal' &&
		textSize !== 'large'
	)
		throw Error(`${label} has an invalid text size.`);
	if (
		template !== undefined &&
		(!isPlayerText(id) || typeof template !== 'string' || template.length > 512)
	)
		throw Error(`${label} has an invalid custom text template.`);
	if (
		placement !== undefined &&
		placement !== 'header' &&
		(!isNavigation(id) ||
			(placement !== 'header-start' && placement !== 'header-end' && placement !== 'hidden'))
	)
		throw Error(`${label} has an invalid navigation placement.`);
	return {
		...measurements,
		...(vAlign === undefined ? {} : { vAlign }),
		...(icon === undefined ? {} : { icon }),
		...(showLabel === undefined ? {} : { showLabel }),
		...(reserveLines === undefined ? {} : { reserveLines }),
		...(placement === undefined ? {} : { placement }),
		id,
		title,
		preview,
		...(sameRow === undefined ? {} : { sameRow }),
		...(align === undefined ? {} : { align }),
		...(textSize === undefined ? {} : { textSize }),
		...(template === undefined ? {} : { template })
	};
}
export function importPlayerStyle(text: string): Section[] {
	checkSize(text);
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw Error('Enter valid layout JSON.');
	}
	if (
		!record(value) ||
		value.format !== format ||
		value.version !== 1 ||
		!Array.isArray(value.sections)
	)
		throw Error('Use a DroppedNeedle player layout in version 1 format.');
	if (Object.keys(value).some((key) => !['format', 'version', 'sections'].includes(key)))
		throw Error('The layout includes an unknown field.');
	const sections = value.sections.map(readSection);
	const seen = new Set<string>();
	for (const item of sections) {
		if (seen.has(item.id)) throw Error('Each player element needs its own ID.');
		seen.add(item.id);
	}
	return expandLegacyTrack(sections);
}
