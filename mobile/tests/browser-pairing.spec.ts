import { expect, test, type Page } from '@playwright/test';
import type { ManualStatus } from '../src/lib/offline/nativeMedia';
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
				'manualStatus',
				'takeDownloadNotification',
				'downloadNotificationSettings',
				'openDownloadNotificationSettings',
				'enqueueManual',
				'cancelManual',
				'retryManual',
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
						if (
							method === 'downloadNotificationSettings' ||
							method === 'openDownloadNotificationSettings'
						) {
							if (Object.keys(opts).length)
								throw Error('Android notification settings need no account');
							if (method === 'downloadNotificationSettings')
								return { state: sessionStorage.getItem('notification-state') ?? 'appOff' };
							sessionStorage.setItem('opened-notification-settings', '1');
							return;
						}
						if (method === 'takeDownloadNotification') {
							if (Object.keys(opts).length) throw Error('A notification tap needs no account data');
							const open = sessionStorage.getItem('notification-tap') === '1';
							if (open) {
								sessionStorage.removeItem('notification-tap');
								sessionStorage.setItem(
									'notification-opens',
									String(Number(sessionStorage.getItem('notification-opens')) + 1)
								);
							}
							return { open };
						}
						if (['manualStatus', 'enqueueManual', 'retryManual', 'cancelManual'].includes(method)) {
							if (
								opts.serverUrl !== 'https://library.example/dn' ||
								opts.userId !== 'fixture-id' ||
								'token' in opts
							)
								throw Error('Wrong download account');
							const empty: ManualStatus = {
								state: 'idle',
								total: 0,
								saved: 0,
								pending: 0,
								failed: 0,
								lastError: ''
							};
							const before: ManualStatus =
								JSON.parse(sessionStorage.getItem('download-queue') ?? 'null') ?? empty;
							let status = before;
							if (method === 'enqueueManual') {
								const tracks = opts.tracks as unknown as { id: string; streamUrl: string }[];
								if (
									tracks.length !== 1 ||
									tracks[0].id !== 'saved' ||
									tracks[0].streamUrl !== '/api/v3/stream/local/saved'
								)
									throw Error('Invalid retained song');
								status = { ...empty, state: 'waitingOffline', pending: 1, total: 1 };
							}
							if (method === 'retryManual')
								status = {
									...empty,
									state: 'queued',
									total: before.total,
									pending: before.failed + before.pending,
									saved: before.saved
								};
							if (method === 'cancelManual') {
								status = empty;
								sessionStorage.setItem(
									'cancel-downloads',
									String(1 + Number(sessionStorage.getItem('cancel-downloads')))
								);
							}
							if (method !== 'manualStatus') {
								sessionStorage.setItem('download-queue', JSON.stringify(status));
								listeners.get('manualChanged')?.({ url: '' });
							}
							return method === 'enqueueManual'
								? {
										queued: before.pending ? 0 : 1,
										alreadyQueued: before.pending ? 1 : 0,
										saved: 0,
										failed: 0,
										status
									}
								: status;
						}
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
						} else if (opts.url.endsWith('/auth/logout')) data = {};
						else if (opts.url.endsWith('/me/section-prefs'))
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
		window.addEventListener('fixture-system-resume', () => listeners.get('resume')?.({ url: '' }));
		window.addEventListener('fixture-download-update', () =>
			listeners.get('manualChanged')?.({ url: '' })
		);
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

test('a download notification waits for browser sign-in and opens Offline music only once per tap', async ({
	page
}) => {
	await page.addInitScript(() => sessionStorage.setItem('reconnected', '1'));
	await page.goto('/');
	await page.evaluate(() => sessionStorage.setItem('notification-tap', '1'));
	await expect(page.getByLabel('Server address')).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event('dn-download-notification')));
	expect(await page.evaluate(() => sessionStorage.getItem('notification-tap'))).toBe('1');
	await deliverApproval(page);
	const heading = (name: string) => page.getByRole('heading', { name, exact: true });
	await expect(heading('Offline music')).toBeVisible();
	expect(await page.evaluate(() => sessionStorage.getItem('notification-opens'))).toBe('1');

	// A cold notification overrides this listener's saved Now Playing screen for this launch.
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Interface and navigation', exact: true }).click();
	await page.getByLabel('Start screen').selectOption('player');
	await page.evaluate(() => {
		sessionStorage.setItem('restored-song', 'Night service');
		sessionStorage.setItem('notification-tap', '1');
	});
	await page.reload();
	await expect(heading('Offline music')).toBeVisible();
	await page.reload();
	await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible();

	// A warm tap closes the navigation overlay and leaves the restored song paused.
	await page.getByRole('button', { name: 'Open navigation menu' }).click();
	await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible();
	await page.evaluate(() => {
		sessionStorage.setItem('notification-tap', '1');
		window.dispatchEvent(new Event('dn-download-notification'));
	});
	await expect(heading('Offline music')).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toHaveCount(0);
	expect(await page.evaluate(() => sessionStorage.getItem('notification-opens'))).toBe('3');
	expect(await page.evaluate(() => sessionStorage.getItem('toggled-playback'))).toBeNull();
	await page.getByRole('button', { name: 'Home', exact: true }).click();
	await page.evaluate(() => window.dispatchEvent(new Event('dn-download-notification')));
	await expect(heading('Home')).toBeVisible();
	expect(await page.evaluate(() => sessionStorage.getItem('notification-opens'))).toBe('3');
});

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

test('download notification settings open on demand and reflect Android changes on return', async ({
	page
}) => {
	await page.addInitScript(() => sessionStorage.setItem('reconnected', '1'));
	await deliverApproval(page);
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Offline and cache', exact: true }).click();
	const group = page.getByRole('group', { name: 'Download notifications' });
	await expect(group.getByRole('status')).toHaveText('Off for DroppedNeedle.');
	expect(
		await page.evaluate(() => sessionStorage.getItem('opened-notification-settings'))
	).toBeNull();
	await group.getByRole('button', { name: 'Open Android notification settings' }).click();
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem('opened-notification-settings')))
		.toBe('1');
	for (const [state, text] of [
		[
			'appOn',
			'On for DroppedNeedle. The download channel appears after your first download starts.'
		],
		['channelOff', 'Off for offline downloads.'],
		['on', 'On for offline downloads.']
	]) {
		await page.evaluate((value) => {
			sessionStorage.setItem('notification-state', value);
			window.dispatchEvent(new Event('fixture-system-resume'));
		}, state);
		await expect(group.getByRole('status')).toHaveText(text);
	}
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

test('queued Android downloads survive navigation and expose waiting, retry and cancel in Offline music', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 760 });
	await page.addInitScript(() => {
		sessionStorage.setItem('reconnected', '1');
		sessionStorage.setItem('restored-song', 'Night service');
		sessionStorage.setItem('offline-only', '1');
	});
	await deliverApproval(page);
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	const queue = page.getByRole('region', { name: 'Download queue' });
	await expect(page.getByRole('heading', { name: 'Offline music', exact: true })).toBeVisible();
	await expect(queue).toHaveCount(0);
	await button('Open player for Night service').click();
	await page.getByText('Track tools', { exact: true }).click();
	await button('Queue for download').click();
	await expect(
		page.getByRole('status').filter({ hasText: '1 song queued for download.' })
	).toBeVisible();
	await button('Queue for download').click();
	await expect(
		page.getByRole('status').filter({ hasText: '1 song already in the download queue.' })
	).toBeVisible();
	await button('View download queue').click();
	await expect(queue.getByRole('status')).toContainText('Waiting for offline-only playback');
	await page.reload();
	await expect(queue.getByRole('status')).toContainText('0 of 1 saved');
	await page.evaluate(() => {
		sessionStorage.setItem(
			'download-queue',
			JSON.stringify({
				state: 'downloading',
				total: 1,
				pending: 1,
				failed: 0,
				saved: 0,
				lastError: '',
				current: { id: 'saved', title: 'Night service', artist: 'Strings' }
			})
		);
		window.dispatchEvent(new Event('fixture-download-update'));
	});
	await expect(queue.getByText('Night service · Strings', { exact: true })).toBeVisible();
	await page.evaluate(() => {
		sessionStorage.setItem(
			'download-queue',
			JSON.stringify({
				state: 'failed',
				total: 1,
				pending: 0,
				failed: 1,
				saved: 0,
				lastError: 'File unavailable on DN.',
				failures: [
					{
						id: 'saved',
						title: 'Night service',
						artist: 'Strings',
						reason: 'File unavailable on DN.'
					}
				]
			})
		);
		window.dispatchEvent(new Event('fixture-download-update'));
	});
	await expect(
		queue.getByRole('list', { name: 'Failed songs' }).getByText('File unavailable on DN.')
	).toBeVisible();
	await button('Retry failed downloads').click();
	await expect(queue.getByRole('status')).toContainText('Queued for download');
	await button('Cancel remaining downloads').click();
	await expect(queue).toHaveCount(0);
	await page.evaluate(() => {
		sessionStorage.setItem(
			'download-queue',
			JSON.stringify({
				state: 'complete',
				total: 1,
				pending: 0,
				failed: 0,
				saved: 1,
				lastError: ''
			})
		);
		window.dispatchEvent(new Event('fixture-download-update'));
	});
	await expect(queue.getByRole('status')).toContainText('Downloads complete · 1 of 1 saved');
	await button('Dismiss download summary').click();
	await expect(queue).toHaveCount(0);
	await button('Settings').click();
	await button('Sign out').click();
	await expect(page.getByLabel('Server address')).toBeVisible();
	expect(await page.evaluate(() => sessionStorage.getItem('cancel-downloads'))).toBe('3');
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
