import { defineConfig } from '@playwright/test';

const port = Number(process.env.DN_MOBILE_TEST_PORT ?? 4187);
const baseURL = 'http://127.0.0.1:' + port;
// Keep concurrently running fixture servers on the bundle each one built.
const bundle = 'test-results/bundles/' + port;
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
