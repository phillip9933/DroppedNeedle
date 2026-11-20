import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	plugins: [svelte()],
	base: './',
	esbuild: { tsconfigRaw: { compilerOptions: { target: 'ES2022' } } }
});
