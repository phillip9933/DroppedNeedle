import { defineConfig } from '@playwright/test';

const port = Number(process.env.DN_MOBILE_TEST_PORT ?? 4187);
const baseURL = 'http://127.0.0.1:' + port;
// Playwright clears its results directory at startup. Keep each preview bundle outside it.
const bundle = 'node_modules/.cache/dn-mobile-journeys/' + port;
export default defineConfig({
	testDir: '.',
	outputDir: '../test-results/' + port,
	use: { baseURL, viewport: { width: 390, height: 844 }, hasTouch: true },
	webServer: {
		command: `pnpm exec vite build --outDir ${bundle} && pnpm exec vite preview --outDir ${bundle} --host 127.0.0.1 --port ${port} --strictPort`,
		cwd: '..',
		url: baseURL,
		timeout: 60_000
	}
});
