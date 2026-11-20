import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4187';
export default defineConfig({
	testDir: '.',
	outputDir: '../test-results',
	use: { baseURL, viewport: { width: 390, height: 844 }, hasTouch: true },
	webServer: {
		command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4187 --strictPort',
		cwd: '..',
		url: baseURL,
		timeout: 60_000
	}
});
