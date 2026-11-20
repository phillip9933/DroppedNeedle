import { parse } from 'postcss';
import {
	asTheme,
	colorSources,
	roleKeys,
	type Palette,
	type Theme,
	type ColorKey,
	type RoleKey
} from './theme';

export type PaletteReview = {
	theme: Theme;
	applied: { key: string; value: string }[];
	skipped: string[];
	otherModes: string[];
};
const valueKeys = new Map(
	Object.entries(colorSources).map(([key, varName]) => [varName, key as ColorKey])
);
const allowed = new Set([...valueKeys.keys(), ...roleKeys, '--radius-box']);

function selectorWeight(selector: string, base: Palette): number | null {
	if (selector === 'html') return 1;
	if (selector === ':root' || selector === '[data-theme]') return 10;
	const m = /^(html|:root)?\[data-theme(?:\s*=\s*(['"]?)(dark|light|midnight)\2)?\]$/.exec(
		selector
	);
	if (!m) return null;
	if (m[3] && m[3] !== base) return -1;
	return 10 + (m[1] === 'html' ? 1 : m[1] === ':root' ? 10 : 0);
}
function hex(value: string, context: CanvasRenderingContext2D): string | null {
	if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
	if (/^#[0-9a-f]{3}$/i.test(value))
		return (
			'#' +
			[...value.slice(1)]
				.map((c) => c + c)
				.join('')
				.toLowerCase()
		);
	// Only lexical color literals enter the canvas. A detached pixel converts wide-gamut
	// colors to sRGB; no selector, property, reference or sheet is handed to the browser.
	if (
		!/^(?:rgba?|hsla?|oklch|oklab|lab|lch)\([\d.%+,/\s\-a-z]+\)$/i.test(value) ||
		!CSS.supports('color', value)
	)
		return null;
	context.clearRect(0, 0, 1, 1);
	context.fillStyle = value;
	context.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
	if (a !== 255) return null;
	return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
function corners(value: string) {
	const match = /^(\d+(?:\.\d+)?|\.\d+)(px|rem)?$/i.exec(value);
	if (!match) return null;
	const n = Number(match[1]);
	if (n && !match[2]) return null;
	const pixels = n * (match[2]?.toLowerCase() === 'rem' ? 16 : 1);
	return Number.isInteger(pixels) && pixels >= 0 && pixels <= 24 ? pixels : null;
}
export function reviewPalette(css: string, base: Palette): PaletteReview {
	const theme = asTheme({ mode: base });
	theme.name = 'DN web palette';
	const applied: PaletteReview['applied'] = [],
		skipped = new Set<string>(),
		otherModes = new Set<string>();
	type Candidate = { value: string; important: boolean; weight: number };
	const candidates = new Map<string, Candidate>();
	// parse constructs a syntax tree and does no plugin, import, source-map or URL resolution.
	const sheet = parse(css, { from: undefined, map: false });
	for (const node of sheet.nodes) {
		if (node.type === 'comment') continue;
		if (node.type !== 'rule') {
			skipped.add(node.type === 'atrule' ? '@' + node.name : 'top-level declaration');
			continue;
		}
		let weight = -1;
		for (const selector of node.selectors) {
			const specificity = selectorWeight(selector, base);
			if (specificity === null) skipped.add(selector);
			else if (specificity < 0) otherModes.add(selector);
			else weight = Math.max(weight, specificity);
		}
		if (weight < 0) continue;
		for (const decl of node.nodes) {
			if (decl.type === 'comment') continue;
			if (decl.type !== 'decl') {
				skipped.add('nested rule');
				continue;
			}
			if (!allowed.has(decl.prop)) {
				skipped.add(decl.prop);
				continue;
			}
			const prev = candidates.get(decl.prop),
				important = !!decl.important;
			if (
				!prev ||
				(important && !prev.important) ||
				(important === prev.important && weight >= prev.weight)
			)
				candidates.set(decl.prop, { value: decl.value.trim(), important, weight });
		}
	}
	const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	if (!context) throw Error('This device could not convert web colors.');
	for (const [key, { value }] of candidates) {
		if (key === '--radius-box') {
			const px = corners(value);
			if (px === null) skipped.add(key + ' (unsupported value)');
			else {
				theme.corners = px;
				applied.push({ key, value: px + 'px' });
			}
			continue;
		}
		const color = hex(value, context);
		if (!color) {
			skipped.add(key + ' (unsupported value)');
			continue;
		}
		const mobileKey = valueKeys.get(key);
		if (mobileKey) theme.colors[mobileKey] = color;
		else {
			theme.roles ??= {};
			theme.roles[key as RoleKey] = color;
		}
		applied.push({ key, value: color });
	}
	return { theme, applied, skipped: [...skipped], otherModes: [...otherModes] };
}
