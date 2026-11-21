import { expect, test, type Page } from '@playwright/test';
import { chooseOption } from './fixtures/inlineChoice';
import type { AndroidUpdateState } from '../src/lib/updates/androidUpdates';

declare global {
	interface Window {
		updateFixture: {
			emit: (changes: Partial<AndroidUpdateState>) => void;
			grantInstallPermission: () => void;
			installs: number;
			permissionVisits: number;
		};
	}
}

async function android(page: Page, supported = true) {
	await page.addInitScript((supported) => {
		const plugins = {
			App: ['getLaunchUrl', 'addListener', 'removeListener'],
			SecureStorage: ['internalGetItem'],
			DNPlayer: ['command', 'getState'],
			DNUpdates: [
				'getState',
				'check',
				'setPreferences',
				'download',
				'cancelDownload',
				'dismiss',
				'install',
				'openInstallSettings',
				'addListener',
				'removeListener'
			]
		};
		const listeners = new Map<string, (event: AndroidUpdateState) => void>();
		const available = {
			tag: 'android-v2.0.0',
			version: '2.0.0',
			sizeBytes: 8388608,
			notes: 'Playback fixes. <em>Release note</em>'
		};
		let state: AndroidUpdateState = {
			supported,
			installedVersion: '1.0.0',
			channel: 'stable',
			automaticChecks: true,
			wifiDownload: false,
			checking: false,
			downloading: false,
			bytesDownloaded: 0,
			ready: false,
			offer: false,
			lastChecked: 0,
			error: null,
			canInstall: false,
			available: null
		};
		let finishDownload: (() => void) | undefined;
		const emit = (changes: Partial<AndroidUpdateState>) => {
			state = { ...state, ...changes };
			listeners.get('updateState')?.(structuredClone(state));
			if (changes.downloading === false) {
				finishDownload?.();
				finishDownload = undefined;
			}
		};
		window.updateFixture = {
			emit,
			installs: 0,
			permissionVisits: 0,
			grantInstallPermission: () => {
				state.canInstall = true;
			}
		};
		Object.assign(window, {
			androidBridge: {},
			Capacitor: {
				PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({
					name,
					methods: methods.map((name) => ({
						name,
						rtype: name === 'addListener' ? 'callback' : 'promise'
					}))
				})),
				nativeCallback: (
					_plugin: string,
					_method: string,
					opts: { eventName: string },
					cb: (event: AndroidUpdateState) => void
				) => {
					listeners.set(opts.eventName, cb);
					return opts.eventName;
				},
				nativePromise: async (
					plugin: string,
					method: string,
					opts: Record<string, unknown> = {}
				) => {
					if (plugin === 'SecureStorage') return { data: null, success: true };
					if (plugin !== 'DNUpdates') return {};
					if (method === 'removeListener') {
						listeners.delete(String(opts.eventName));
						return;
					}
					if (method === 'getState') return structuredClone(state);
					if (['download', 'install', 'dismiss'].includes(method) && opts.tag !== available.tag)
						throw Error('No matching release');
					switch (method) {
						case 'check':
							emit({ lastChecked: Date.now(), available, offer: true, error: null });
							break;
						case 'setPreferences':
							emit(opts);
							break;
						case 'download':
							emit({ downloading: true, bytesDownloaded: 0, error: null });
							return new Promise<void>((resolve) => {
								finishDownload = resolve;
							});
						case 'cancelDownload':
							emit({ downloading: false, bytesDownloaded: 0, error: null });
							break;
						case 'dismiss':
							emit({ offer: false });
							break;
						case 'openInstallSettings':
							window.updateFixture.permissionVisits++;
							break;
						case 'install':
							if (!state.ready || !state.canInstall) throw Error('Installer handoff out of order');
							window.updateFixture.installs++;
							break;
					}
				}
			}
		});
	}, supported);
}

async function openSettings(page: Page) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

test('a signed-out listener downloads, retries and hands a verified update to Android explicitly', async ({
	page
}) => {
	await android(page);
	await openSettings(page);
	const entry = page.getByRole('button', { name: /^App updates/ });
	await entry.click({ timeout: 5000 });
	await expect(page.getByText('1.0.0', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Check for updates' }).click();
	await expect(page.getByRole('heading', { name: 'Version 2.0.0' })).toBeVisible();
	await page.getByText('Release notes', { exact: true }).click();
	await expect(
		page.getByText('Playback fixes. <em>Release note</em>', { exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(entry).toContainText('2.0.0 available');
	await entry.click();
	await page.getByRole('button', { name: 'Dismiss reminder' }).click();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(entry).not.toContainText('2.0.0');
	await entry.click();
	const download = page.getByRole('button', { name: 'Download update' });
	await download.click();
	await page.evaluate(() => window.updateFixture.emit({ bytesDownloaded: 4194304 }));
	await expect(page.getByRole('progressbar')).toHaveAttribute('value', '4194304');
	await expect(page.getByText('4.0 MiB of 8.0 MiB')).toBeVisible();
	await page.getByRole('button', { name: 'Cancel download' }).click();
	await expect(download).toBeVisible();
	await download.click();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await entry.click();
	await expect(page.getByRole('button', { name: 'Cancel download' })).toBeVisible();
	await page.evaluate(() =>
		window.updateFixture.emit({ downloading: false, error: 'The download was interrupted.' })
	);
	await expect(page.getByRole('alert')).toContainText('The download was interrupted.');
	await expect(page.getByRole('button', { name: 'Install update' })).toHaveCount(0);
	await download.click();
	await page.evaluate(() =>
		window.updateFixture.emit({ downloading: false, ready: true, error: null })
	);
	await expect(page.getByText('Verified and ready to install.')).toBeVisible();
	await page.getByRole('button', { name: 'Allow app installs' }).click();
	expect(await page.evaluate(() => window.updateFixture.permissionVisits)).toBe(1);
	await page.evaluate(() => {
		window.updateFixture.grantInstallPermission();
		document.dispatchEvent(new Event('visibilitychange'));
	});
	expect(await page.evaluate(() => window.updateFixture.installs)).toBe(0);
	await page.getByRole('button', { name: 'Install update' }).click();
	expect(await page.evaluate(() => window.updateFixture.installs)).toBe(1);
});

test('Android update preferences survive leaving the screen and use the inline channel picker', async ({
	page
}) => {
	await android(page);
	await openSettings(page);
	const entry = page.getByRole('button', { name: /^App updates/ });
	await entry.click({ timeout: 5000 });
	await page.getByRole('checkbox', { name: 'Check automatically' }).uncheck();
	await page.getByRole('checkbox', { name: 'Download automatically on Wi-Fi' }).check();
	const channel = page.getByRole('combobox', { name: 'Release channel' });
	await chooseOption(channel, 'beta');
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await entry.click();
	await expect(page.getByRole('checkbox', { name: 'Check automatically' })).not.toBeChecked();
	await expect(
		page.getByRole('checkbox', { name: 'Download automatically on Wi-Fi' })
	).toBeChecked();
	await expect(channel).toHaveAttribute('data-value', 'beta');
});

test('older Android shows the minimum update version and the web settings hide Android updates', async ({
	page,
	browser
}) => {
	await android(page, false);
	await openSettings(page);
	await page.getByRole('button', { name: /^App updates/ }).click({ timeout: 5000 });
	await expect(page.getByText(/Android 8 or later/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Check for updates' })).toHaveCount(0);
	const web = await browser.newPage({ baseURL: new URL(page.url()).origin });
	await openSettings(web);
	await expect(web.getByRole('button', { name: 'About', exact: true })).toBeVisible();
	await expect(web.getByRole('button', { name: /^App updates/ })).toHaveCount(0);
	await web.close();
});
