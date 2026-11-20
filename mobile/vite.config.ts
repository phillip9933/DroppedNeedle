import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import postcss, { type Container } from 'postcss';

// Compile DN's own daisyUI and semantic colors into the native bundle. The mobile
// WebView needs the palette, without a web frontend build or runtime CSS parser.
function webPalettes() {
	const file = new URL('../frontend/src/theme.css', import.meta.url);
	const source = postcss.parse(readFileSync(file, 'utf8'), { from: file.pathname });
	const common: Record<string, string> = {};
	const palettes: Record<string, Record<string, string>> = {};
	function tokens(block: Container) {
		const values: Record<string, string> = {};
		block.walkDecls(/^--/, (d) => {
			values[d.prop] = d.value;
		});
		return values;
	}
	source.walkAtRules('plugin', (block) => {
		if (block.params !== '"daisyui/theme"') return;
		let mode = '';
		block.walkDecls('name', (d) => {
			mode = d.value.replace(/['"]/g, '');
		});
		if (mode) palettes[mode] = tokens(block);
	});
	source.walkRules((rule) => {
		if (rule.selectors.includes(':root')) Object.assign(common, tokens(rule));
		for (const name of Object.keys(palettes))
			if (rule.selectors.includes(`[data-theme='${name}']`))
				Object.assign(palettes[name], tokens(rule));
	});
	for (const mode of ['dark', 'light', 'midnight']) {
		if (!palettes[mode]?.['--color-primary'] || !palettes[mode]?.['--dn-action'])
			throw Error(`Missing DroppedNeedle palette: ${mode}`);
		palettes[mode] = { ...common, ...palettes[mode] };
	}
	return palettes;
}
export default defineConfig({
	plugins: [svelte()],
	base: './',
	define: { __DN_WEB_PALETTES__: JSON.stringify(webPalettes()) },
	esbuild: { tsconfigRaw: { compilerOptions: { target: 'ES2022' } } }
});
