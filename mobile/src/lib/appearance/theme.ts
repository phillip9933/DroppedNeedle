import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { androidAppearance } from './nativeAppearance';

export type Mode = components['schemas']['ThemeChoice'];
export type Palette = Exclude<Mode, 'system'>;
export type Selection = { mode: Mode } | { mode: 'custom'; theme: Theme };
export const labels: Record<Mode, string> = {
	dark: 'Dark',
	light: 'Light',
	midnight: 'Midnight',
	system: 'System'
};
declare const __DN_WEB_PALETTES__: Record<Palette, Record<string, string>>;
const palettes = __DN_WEB_PALETTES__;
export function albumSheetColor(mode: Palette) {
	return palettes[mode]['--dn-paper'];
}
export const roleKeys = [
	'--dn-title',
	'--dn-action',
	'--dn-action-content',
	'--dn-action-edge',
	'--dn-focus',
	'--dn-edge',
	'--color-info',
	'--color-info-content',
	'--color-success',
	'--color-success-content',
	'--color-warning',
	'--color-warning-content',
	'--color-error',
	'--color-error-content'
] as const;
export type RoleKey = (typeof roleKeys)[number];
export interface Theme {
	roles?: Partial<Record<RoleKey, string>>;
	base?: Palette;
	version: 1;
	name: string;
	colors: Record<ColorKey, string>;
	corners: number;
	spacing: number;
	typeface: 'sans' | 'serif' | 'system';
}

const colors = ['bg', 'surface', 'raised', 'text', 'muted', 'accent', 'on-accent', 'line'] as const;
export type ColorKey = (typeof colors)[number];
const storageKey = 'dn.mobile.appearance.v1';
const modeKey = 'dn.mobile.appearance.mode.v2';

export const studio: Theme = {
	version: 1,
	name: 'Studio',
	corners: 12,
	spacing: 16,
	typeface: 'sans',
	colors: {
		bg: '#131c20',
		surface: '#1b272c',
		raised: '#26373e',
		text: '#f3f6f1',
		muted: '#adbfbd',
		accent: '#b5ebc5',
		'on-accent': '#11251b',
		line: '#52645f'
	}
};
export const paper: Theme = {
	version: 1,
	name: 'Paper',
	corners: 6,
	spacing: 16,
	typeface: 'sans',
	colors: {
		bg: '#f8f5ed',
		surface: '#fffdf6',
		raised: '#eee9dc',
		text: '#201e19',
		muted: '#615c51',
		accent: '#754020',
		'on-accent': '#fffaee',
		line: '#a89d89'
	}
};
export const presets = [studio, paper];

export function readTheme(json: string): Theme {
	if (json.length > 4096) throw Error('Use a theme smaller than 4 KB.');
	const data = JSON.parse(json);
	if (
		data?.version !== 1 ||
		(data.base !== undefined && !['dark', 'light', 'midnight'].includes(data.base)) ||
		(data.roles !== undefined &&
			(typeof data.roles !== 'object' ||
				data.roles === null ||
				Array.isArray(data.roles) ||
				!Object.entries(data.roles).every(
					([key, value]) =>
						roleKeys.includes(key as RoleKey) &&
						typeof value === 'string' &&
						/^#[a-f\d]{6}$/i.test(value)
				))) ||
		typeof data.name !== 'string' ||
		!data.name.trim() ||
		data.name.length > 40 ||
		!colors.every(
			(k) => typeof data.colors?.[k] === 'string' && /^#[a-f\d]{6}$/i.test(data.colors[k])
		) ||
		!Number.isInteger(data.corners) ||
		data.corners < 0 ||
		data.corners > 24 ||
		!Number.isInteger(data.spacing) ||
		data.spacing < 8 ||
		data.spacing > 24 ||
		!['sans', 'serif', 'system'].includes(data.typeface)
	) {
		throw Error('Check the name, eight hex colors, corners (0–24), spacing (8–24), and typeface.');
	}
	return {
		version: 1,
		name: data.name.trim(),
		...(data.roles ? { roles: data.roles } : {}),
		...(data.base ? { base: data.base } : {}),
		colors: Object.fromEntries(colors.map((k) => [k, data.colors[k]])) as Theme['colors'],
		corners: data.corners,
		spacing: data.spacing,
		typeface: data.typeface
	};
}

export function savedCustom(): Theme | null {
	try {
		return readTheme(localStorage.getItem(storageKey) ?? '');
	} catch {
		return null;
	}
}
export function restoreTheme(): Selection {
	try {
		const mode = localStorage.getItem(modeKey);
		if (isMode(mode)) return { mode };
		const custom = savedCustom();
		if (custom) return { mode: 'custom', theme: custom };
	} catch {
		/* Storage may be unavailable on a new device. */
	}
	return { mode: 'dark' };
}
export function isMode(value: unknown): value is Mode {
	return typeof value === 'string' && Object.hasOwn(labels, value);
}
export const colorSources: Record<ColorKey, string> = {
	bg: '--color-base-100',
	surface: '--color-base-200',
	raised: '--color-neutral',
	text: '--color-base-content',
	muted: '--dn-muted',
	accent: '--color-primary',
	'on-accent': '--color-primary-content',
	line: '--dn-line'
};
const prefersLight = () => matchMedia('(prefers-color-scheme: light)');
function isLight(background: string) {
	const rgb = background
		.slice(1)
		.match(/../g)!
		.map((v) => parseInt(v, 16));
	return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 140;
}
function base(selection: Selection): Palette {
	if (selection.mode === 'system') return prefersLight().matches ? 'light' : 'dark';
	if (selection.mode === 'custom')
		return selection.theme.base ?? (isLight(selection.theme.colors.bg) ? 'light' : 'dark');
	return selection.mode;
}
export function asTheme(selection: Selection): Theme {
	if (selection.mode === 'custom') return selection.theme;
	const resolved = base(selection),
		tokens = palettes[resolved];
	return {
		version: 1,
		name: labels[resolved],
		base: resolved,
		corners: 12,
		spacing: 16,
		typeface: 'sans',
		colors: Object.fromEntries(
			colors.map((key) => [key, tokens[colorSources[key]]])
		) as Theme['colors']
	};
}
function paint(selection: Selection) {
	const mode = base(selection),
		theme = asTheme(selection),
		tokens = { ...palettes[mode] };
	const root = document.documentElement;
	if (selection.mode === 'custom') {
		for (const key of colors) tokens[colorSources[key]] = theme.colors[key];
		if (
			!theme.base ||
			theme.colors.accent !== palettes[mode]['--color-primary'] ||
			theme.colors['on-accent'] !== palettes[mode]['--color-primary-content']
		) {
			tokens['--dn-action'] = theme.colors.accent;
			tokens['--dn-action-content'] = theme.colors['on-accent'];
			tokens['--dn-action-edge'] = theme.colors.accent;
		}
		if (!theme.base || theme.colors.text !== palettes[mode]['--color-base-content'])
			tokens['--dn-title'] = theme.colors.text;
		if (!theme.base || theme.colors.line !== palettes[mode]['--dn-line'])
			tokens['--dn-edge'] = theme.colors.line;
		if (!theme.base || theme.colors.accent !== palettes[mode]['--color-primary'])
			tokens['--dn-focus'] = theme.colors.accent;
	}
	if (theme.roles) Object.assign(tokens, theme.roles);
	root.style.setProperty('--heading', tokens['--dn-title']);
	root.dataset.theme = mode;
	// The web album track list uses its page's stock with controls in Light or Midnight ink.
	root.dataset.paperSheet = selection.mode === 'custom' ? 'off' : 'on';
	const inner = palettes[mode === 'midnight' ? 'midnight' : 'light'];
	for (const key of colors) root.style.setProperty('--sheet-' + key, inner[colorSources[key]]);
	root.style.setProperty('--sheet-focus', inner['--dn-focus']);
	for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
	for (const key of colors) root.style.setProperty('--' + key, theme.colors[key]);
	root.style.setProperty('--radius', theme.corners + 'px');
	root.style.setProperty('--gap', theme.spacing + 'px');
	root.style.setProperty(
		'--font',
		{
			sans: 'Inter, system-ui, sans-serif',
			system: 'system-ui, sans-serif',
			serif: 'Georgia, serif'
		}[theme.typeface]
	);
	root.style.colorScheme = isLight(theme.colors.bg) ? 'light' : 'dark';
	if (Capacitor.isNativePlatform()) {
		const style = root.style.colorScheme === 'light' ? SystemBarsStyle.Light : SystemBarsStyle.Dark;
		// Capacitor sets the Android decor background while applying the icon style.
		void SystemBars.setStyle({ style })
			.then(() => {
				if (
					Capacitor.getPlatform() === 'android' &&
					root.style.getPropertyValue('--bg') === theme.colors.bg
				)
					return androidAppearance.setBackground({ color: theme.colors.bg });
			})
			.catch(() => {});
	}
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.bg);
}
let stopWatching: (() => void) | undefined;
export function applyTheme(selection: Selection) {
	stopWatching?.();
	stopWatching = undefined;
	paint(selection);
	if (selection.mode === 'system') {
		const media = prefersLight();
		const follow = () => paint(selection);
		media.addEventListener('change', follow);
		stopWatching = () => media.removeEventListener('change', follow);
	}
}
export function saveTheme(selection: Selection) {
	if (selection.mode === 'custom')
		localStorage.setItem(storageKey, JSON.stringify(selection.theme));
	localStorage.setItem(modeKey, selection.mode);
	applyTheme(selection);
}
