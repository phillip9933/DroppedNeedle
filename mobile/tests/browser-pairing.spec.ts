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
			DNDrawer: ['setMenuEdge'],
			DNOffline: [
				'snapshot',
				'options',
				'historySettings',
				'setOfflineHistory',
				'discardOfflineHistory',
				'addListener',
				'removeListener',
				'cancelAutomatic'
			],
			DNPlayer: [
				'getState',
				'command',
				'restore',
				'outputState',
				'googleCast',
				'findOutputs',
				'castTo',
				'stopCasting'
			]
		};
		Object.assign(window, {
			androidBridge: {},
			deliverLink: (url: string) => listeners.get('appUrlOpen')?.({ url }),
			pressAndroidBack: () => listeners.get('backButton')?.({ url: '' }),
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
					if (plugin === 'DNDrawer' && method === 'setMenuEdge') {
						sessionStorage.setItem('menu-edge', String(opts.enabled));
						return;
					}
					if (plugin === 'SecureStorage') {
						if (method === 'internalSetItem') sessionStorage.setItem(opts.prefixedKey, opts.data);
						if (method === 'internalRemoveItem') sessionStorage.removeItem(opts.prefixedKey);
						return { data: sessionStorage.getItem(opts.prefixedKey), success: true };
					}
					if (plugin === 'DNOffline') {
						const options = {
							offlineOnly: sessionStorage.getItem('offline-only') === '1',
							autoDownload: 'off',
							downloadMiB: 512,
							autoCache: false,
							cacheMiB: 512,
							unmeteredOnly: true
						};
						if (method === 'options') return options;
						if (method === 'snapshot') return { items: [], options };
						if (
							['historySettings', 'setOfflineHistory', 'discardOfflineHistory'].includes(method)
						) {
							if (
								opts.serverUrl !== 'https://library.example/dn' ||
								opts.userId !== 'fixture-id' ||
								'token' in opts
							)
								throw Error('Unexpected offline history account');
							if (method === 'setOfflineHistory')
								sessionStorage.setItem('history-enabled', String(opts.enabled));
							if (method === 'discardOfflineHistory')
								sessionStorage.setItem('history-pending', '0');
							return {
								enabled: sessionStorage.getItem('history-enabled') !== 'false',
								pending: Number(sessionStorage.getItem('history-pending') ?? 2)
							};
						}
						return;
					}
					if (plugin === 'Browser') {
						sessionStorage.setItem('browser-url', opts.url);
						return;
					}
					if (plugin === 'DNPlayer') {
						if (method === 'command' && opts.action === 'toggle')
							sessionStorage.setItem('toggled-playback', '1');
						if (method === 'findOutputs') {
							sessionStorage.setItem('cast-search', 'yes');
							return { devices: [{ id: 'mock-renderer', name: 'Fixture receiver' }] };
						}
						if (method === 'castTo') {
							if (Object.keys(opts).join() !== 'id' || opts.id !== 'mock-renderer')
								throw Error('Invalid receiver');
							sessionStorage.setItem('receiver', 'Fixture receiver');
						}
						if (method === 'googleCast') sessionStorage.setItem('receiver', 'Fixture Chromecast');
						if (method === 'stopCasting') sessionStorage.removeItem('receiver');
						if (['outputState', 'castTo', 'googleCast', 'stopCasting'].includes(method))
							return { destination: sessionStorage.getItem('receiver') ?? '' };
						const track = sessionStorage.getItem('restored-song');
						return {
							repeat: 'off',
							tracks: track
								? [
										{
											id: 'saved',
											title: track,
											artist: 'Strings',
											album: 'Nightfall',
											streamUrl: '/api/v3/stream/local/saved'
										}
									]
								: [],
							index: track ? 0 : -1,
							playing: false,
							position: track ? 41 : 0,
							duration: track ? 120 : 0,
							error: null
						};
					}
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

test('the chosen start screen works offline and opens a restored song without starting playback', async ({
	page
}) => {
	await page.addInitScript(() => sessionStorage.setItem('reconnected', '1'));
	await deliverApproval(page);
	const heading = (name: string) => page.getByRole('heading', { name, exact: true });
	const openInterface = async () => {
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		await page.getByRole('button', { name: 'Interface and navigation', exact: true }).click();
	};
	await expect(heading('Home')).toBeVisible();
	await openInterface();
	const start = page.getByLabel('Start screen');
	await expect(start).toHaveValue('automatic');
	await start.selectOption('player');
	await page.reload();
	await expect(heading('Library')).toBeVisible();
	await page.evaluate(() => {
		sessionStorage.setItem('restored-song', 'Night service');
		sessionStorage.setItem('offline-only', '1');
	});
	await page.reload();
	const player = page.getByRole('region', { name: 'Now playing' });
	await expect(player).toBeVisible();
	await expect(player.getByText('Night service', { exact: true }).first()).toBeVisible();
	await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	expect(await page.evaluate(() => sessionStorage.getItem('toggled-playback'))).toBeNull();
	await player.getByRole('button', { name: 'Close player' }).click();
	await expect(heading('Library')).toBeVisible();
	await openInterface();
	await start.selectOption('library');
	await page.reload();
	await expect(heading('Library')).toBeVisible();
	await openInterface();
	await start.selectOption('home');
	await page.reload();
	await expect(heading('Home')).toBeVisible();
	await openInterface();
	await page.getByRole('button', { name: 'Restore interface defaults' }).click();
	await page.reload();
	await expect(heading('Offline music')).toBeVisible();
});

test('Android offline history settings preserve pending listens until discard is confirmed', async ({
	page
}) => {
	await page.addInitScript(() => sessionStorage.setItem('reconnected', '1'));
	await deliverApproval(page);
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Offline and cache', exact: true }).click();
	const history = page.getByRole('group', { name: 'Offline listening history' }),
		enabled = history.getByLabel('Record offline listens');
	await expect(enabled).toBeChecked();
	await expect(history.getByText('2 listens waiting to sync.')).toBeVisible();
	await enabled.uncheck();
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem('history-enabled')))
		.toBe('false');
	await history.getByRole('button', { name: 'Discard pending listens' }).click();
	await history.getByRole('button', { name: 'Cancel' }).click();
	await expect(history.getByText('2 listens waiting to sync.')).toBeVisible();
	await history.getByRole('button', { name: 'Discard pending listens' }).click();
	await history.getByRole('button', { name: 'Confirm discard' }).click();
	await expect(history.getByText('Pending listens discarded.')).toBeVisible();
	await expect(history.getByRole('button', { name: 'Discard pending listens' })).toHaveCount(0);
	await enabled.check();
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem('history-enabled')))
		.toBe('true');
});

test('an Android listener chooses and disconnects a network output after browser sign-in', async ({
	page
}) => {
	await page.addInitScript(() => sessionStorage.setItem('reconnected', '1'));
	await deliverApproval(page);
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => sessionStorage.getItem('menu-edge'))).toBe('true');
	await page.getByRole('button', { name: 'Open navigation menu' }).click();
	const menu = page.getByRole('dialog', { name: 'Navigation menu' });
	await expect.poll(() => page.evaluate(() => sessionStorage.getItem('menu-edge'))).toBe('false');
	const rowSize = (name: string) =>
		menu.getByRole('button', { name, exact: true }).evaluate((button) => {
			const box = button.getBoundingClientRect(),
				icon = button.querySelector('svg')!.getBoundingClientRect();
			return [box.width, box.height, icon.width, icon.left - box.left];
		});
	expect(await rowSize('Cast and audio output')).toEqual(await rowSize('Settings'));
	await page.getByRole('button', { name: 'Cast and audio output' }).click();
	const sheet = page.getByRole('dialog', { name: 'Cast and audio output' });
	expect(await page.evaluate(() => sessionStorage.getItem('cast-search'))).toBeNull();
	await sheet.getByRole('button', { name: 'Find network speakers' }).click();
	await sheet.getByRole('button', { name: 'Fixture receiver' }).click();
	await expect(sheet.getByText('Casting to Fixture receiver')).toBeVisible();
	await sheet.getByRole('button', { name: 'Stop casting' }).click();
	await sheet.getByRole('button', { name: 'Choose Google Cast device' }).click();
	await expect(sheet.getByText('Casting to Fixture Chromecast')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible();
	await page.getByRole('button', { name: 'Cast and audio output' }).click();
	await expect(sheet.getByText('Casting to Fixture Chromecast')).toBeVisible();
	await sheet.getByRole('button', { name: 'Stop casting' }).click();
	await expect(sheet.getByText('Playing on this phone')).toBeVisible();
	const androidBack = () =>
		page.evaluate(() => (window as unknown as { pressAndroidBack(): void }).pressAndroidBack());
	await androidBack();
	await expect(sheet).toHaveCount(0);
	await expect(menu.getByRole('button', { name: 'Cast and audio output' })).toBeFocused();
	await androidBack();
	await expect(menu).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeFocused();
	await expect.poll(() => page.evaluate(() => sessionStorage.getItem('menu-edge'))).toBe('true');
});

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
