import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

export interface Theme {
	version: 1;
	name: string;
	colors: Record<ColorKey, string>;
	corners: number;
	spacing: number;
	typeface: 'sans' | 'serif' | 'system';
}

const colors = ['bg', 'surface', 'raised', 'text', 'muted', 'accent', 'on-accent', 'line'] as const;
type ColorKey = (typeof colors)[number];
const storageKey = 'dn.mobile.appearance.v1';

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
		colors: Object.fromEntries(colors.map((k) => [k, data.colors[k]])) as Theme['colors'],
		corners: data.corners,
		spacing: data.spacing,
		typeface: data.typeface
	};
}

export function restoreTheme(): Theme {
	try {
		return readTheme(localStorage.getItem(storageKey) ?? '');
	} catch {
		return studio;
	}
}

export function applyTheme(theme: Theme) {
	const root = document.documentElement;
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
	const rgb = theme.colors.bg
		.slice(1)
		.match(/../g)!
		.map((c) => parseInt(c, 16));
	root.style.colorScheme =
		rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 140 ? 'light' : 'dark';
	if (Capacitor.isNativePlatform()) {
		const style = root.style.colorScheme === 'light' ? SystemBarsStyle.Light : SystemBarsStyle.Dark;
		void SystemBars.setStyle({ style }).catch(() => {
			/* Older WebViews use the system default. */
		});
	}
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.bg);
}

export function saveTheme(theme: Theme) {
	localStorage.setItem(storageKey, JSON.stringify(theme));
	applyTheme(theme);
}
