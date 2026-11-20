import { expect, test, type Page } from '@playwright/test';
import {
	readPairing,
	recipient,
	sealToken
} from '../../frontend/src/routes/connect/mobile/handoff';

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const listeners = new Map<string, (event: { url: string }) => void>();
		const plugins: Record<string, string[]> = {
			App: ['getLaunchUrl', 'addListener', 'removeListener'],
			Browser: ['open'],
			SecureStorage: ['internalGetItem', 'internalSetItem', 'internalRemoveItem'],
			CapacitorHttp: ['request', 'get'],
			DNPlayer: ['getState', 'command', 'restore']
		};
		Object.assign(window, {
			androidBridge: {},
			deliverLink: (url: string) => listeners.get('appUrlOpen')?.({ url }),
			Capacitor: {
				PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({
					name,
					methods: methods.map((method) => ({
						name: method,
						rtype: method === 'addListener' ? 'callback' : 'promise'
					}))
				})),
				nativeCallback: (
					_plugin: string,
					_method: string,
					opts: { eventName: string },
					cb: (value: { url: string }) => void
				) => {
					listeners.set(opts.eventName, cb);
					return opts.eventName;
				},
				nativePromise: async (
					plugin: string,
					method: string,
					opts: Record<string, string> = {}
				) => {
					if (plugin === 'App') {
						if (method === 'removeListener') listeners.delete(opts.eventName);
						return undefined;
					}
					if (plugin === 'SecureStorage') {
						if (method === 'internalSetItem') sessionStorage.setItem(opts.prefixedKey, opts.data);
						if (method === 'internalRemoveItem') sessionStorage.removeItem(opts.prefixedKey);
						return { data: sessionStorage.getItem(opts.prefixedKey), success: true };
					}
					if (plugin === 'Browser') {
						sessionStorage.setItem('browser-url', opts.url);
						return;
					}
					if (plugin === 'DNPlayer')
						return {
							repeat: 'off',
							tracks: [],
							index: -1,
							playing: false,
							position: 0,
							duration: 0,
							error: null
						};
					if (plugin === 'CapacitorHttp') {
						let data;
						const stock = new URL(opts.url).hostname === 'stock.example';
						if (opts.url.endsWith('/auth/providers'))
							data = { local: stock, oidc: true, jellyfin: false, plex: false };
						else if (opts.url.endsWith('/mobile-pairing.json')) {
							if (stock)
								return {
									status: 200,
									headers: { 'Content-Type': 'text/html' },
									data: '<!doctype html><html><title>DroppedNeedle</title></html>'
								};
							data = { droppedneedle_mobile_pairing: 1 };
						} else if (opts.url.endsWith('/me')) {
							if (sessionStorage.getItem('hold-profile')) {
								await new Promise<void>((resolve) => {
									window.addEventListener('release-profile', () => resolve(), { once: true });
								});
							}
							if (!sessionStorage.getItem('reconnected')) throw new Error('Server unreachable.');
							data = { id: 'fixture-id', display_name: 'Listener' };
						} else if (opts.url.endsWith('/me/section-prefs'))
							data = { pages: { home: [], discover: [] } };
						else if (
							opts.method === 'GET' &&
							(opts.url.endsWith('/home') || opts.url.endsWith('/discover'))
						)
							data = { sections: [] };
						else if (opts.url.includes('/library/albums')) data = { items: [], next: null };
						else throw new Error('Unexpected test request.');
						return { status: 200, headers: { 'Content-Type': 'application/json' }, data };
					}
					throw new Error('Unexpected native call.');
				}
			}
		});
	});
});

test('Android explains how to enable OIDC pairing before asking for local credentials on a stock server', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Server address').fill('https://stock.example/music');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	const guidance = page.getByRole('paragraph').filter({ hasText: 'ask your administrator' });
	await expect(guidance).toContainText('single sign-on (OIDC)');
	await expect(guidance).toContainText('web frontend with mobile pairing');
	await expect(page.locator('input[type="password"]')).toHaveCount(0);
	await page.getByRole('button', { name: 'Open web player' }).click();
	expect(await page.evaluate(() => sessionStorage.getItem('browser-url'))).toBe(
		'https://stock.example/music/'
	);
	await page.getByRole('button', { name: 'Use DroppedNeedle password' }).click();
	await expect(page.getByLabel('DroppedNeedle username')).toBeVisible();
	await expect(page.getByLabel('DroppedNeedle password')).toBeVisible();
	await expect(guidance).toBeVisible();
});

async function deliverApproval(page: Page) {
	await page.goto('/');
	await page.getByLabel('Server address').fill('https://library.example/dn');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByRole('button', { name: 'Continue in browser' }).click();
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem('browser-url')))
		.not.toBeNull();
	const launched = await page.evaluate(() => sessionStorage.getItem('browser-url'));
	const pairing = readPairing(new URL(launched!).searchParams)!;
	const reply = await sealToken(pairing, await recipient(pairing), 'synthetic-device-session');
	await page.evaluate((url) => {
		(window as unknown as { deliverLink(url: string): void }).deliverLink(url);
	}, reply);
	return launched;
}

test('Android can finish a returned browser sign-in after the network and app restart', async ({
	page
}) => {
	const launched = await deliverApproval(page);
	await expect(page.getByRole('alert')).toContainText('Server unreachable.');
	await page.evaluate(() => sessionStorage.setItem('reconnected', '1'));
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
	expect(await page.evaluate(() => sessionStorage.getItem('browser-url'))).toBe(launched);
});

test('changing servers cancels profile verification already in flight', async ({ page }) => {
	await page.addInitScript(() => {
		sessionStorage.setItem('hold-profile', '1');
		sessionStorage.setItem('reconnected', '1');
	});
	await deliverApproval(page);
	await page.getByRole('button', { name: 'Change server' }).click();
	await expect(page.getByLabel('Server address')).toBeVisible();
	await page.evaluate(async () => {
		window.dispatchEvent(new Event('release-profile'));
		// The fixture bridge settles the request and storage calls in microtasks.
		await new Promise((resolve) => requestAnimationFrame(resolve));
	});
	await expect(page.getByLabel('Server address')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('Server address')).toBeVisible();
	expect(
		await page.evaluate(() => sessionStorage.getItem('capacitor-storage_dn.mobile.session'))
	).toBeNull();
});
