import { expect, test, type Page } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { localSignIn } from './fixtures/localSignIn';

const server = 'https://draft.example/dn';
const saved = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'alex', 'player']);

async function routes(page: Page) {
	await page.route('https://draft.example/**/api/v3/**', async (route) => {
		const request = route.request(),
			path = new URL(request.url()).pathname.split('/api/v3')[1];
		if (path === '/auth/providers') return route.fulfill({ json: { local: true, oidc: false } });
		if (path === '/auth/login')
			return route.fulfill({ json: { token: 'fixture-' + request.postDataJSON().username } });
		const id = request.headers().authorization?.replace('Bearer fixture-', '');
		expect(['alex', 'blair']).toContain(id);
		if (path === '/me')
			return route.fulfill({ json: { id, display_name: 'Listener', role: 'user' } });
		if (await emptyBoardRead(route)) return;
		throw Error('Unexpected fixture request ' + path);
	});
}
async function edit(page: Page, account = 'alex', address = server) {
	await localSignIn(page, address, account);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Edit Now Playing layout' }).click();
	await expect(page.getByRole('heading', { name: 'Edit Now Playing' })).toBeVisible();
}

test('an interrupted player edit reopens for its DN account and server until saved or canceled', async ({
	page
}) => {
	await routes(page);
	await edit(page);
	const rows = page.locator('[data-layout-row]'),
		add = page.getByRole('button', { name: 'Add row', exact: true });
	const notice = page.getByText('Recovered your unsaved layout.', { exact: true });
	const initial = await rows.count();
	await add.click();
	await expect(rows).toHaveCount(initial + 1);
	expect(await page.evaluate((k) => localStorage.getItem(k), saved)).toBeNull();

	await edit(page, 'blair');
	await expect(rows).toHaveCount(initial);
	await expect(notice).toHaveCount(0);
	await edit(page, 'alex', server + '-other');
	await expect(rows).toHaveCount(initial);
	await expect(notice).toHaveCount(0);
	await edit(page);
	await expect(rows).toHaveCount(initial + 1);
	await expect(notice).toBeVisible();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.locator('[data-part=now-playing]')).toBeVisible();
	await page.getByRole('button', { name: 'Player settings', exact: true }).click();
	await expect(rows).toHaveCount(initial);
	await expect(notice).toHaveCount(0);

	await add.click();
	await edit(page);
	await expect(notice).toBeVisible();
	await page.getByRole('button', { name: 'Save layout', exact: true }).click();
	await expect(page.locator('[data-part=now-playing]')).toBeVisible();
	await edit(page);
	await expect(rows).toHaveCount(initial + 1);
	await expect(notice).toHaveCount(0);
});

test('failed layout saves retain the recoverable draft and a newer saved layout takes precedence', async ({
	page
}) => {
	await routes(page);
	await edit(page);
	const rows = page.locator('[data-layout-row]'),
		initial = await rows.count();
	await page.getByRole('button', { name: 'Add row', exact: true }).click();
	await page.evaluate((key) => {
		const write = Storage.prototype.setItem;
		Storage.prototype.setItem = function (k: string, v: string) {
			if (k === key) throw new DOMException('Device full', 'QuotaExceededError');
			write.call(this, k, v);
		};
	}, saved);
	await page.getByRole('button', { name: 'Save layout', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Your edits are still here');
	await edit(page);
	await expect(page.getByText('Recovered your unsaved layout.')).toBeVisible();
	await expect(rows).toHaveCount(initial + 1);
	await page.evaluate((k) => localStorage.setItem(k, '[]'), saved);
	await edit(page);
	await expect(rows).toHaveCount(1);
	await expect(page.getByText('Recovered your unsaved layout.')).toHaveCount(0);
});

test('canceling an older editor keeps a newer edit made in a second window', async ({
	page,
	context
}) => {
	await routes(page);
	await edit(page);
	const original = await page.locator('[data-layout-row]').count();
	await page.getByRole('button', { name: 'Add row', exact: true }).click();
	const second = await context.newPage();
	await routes(second);
	await edit(second);
	await expect(second.locator('[data-layout-row]')).toHaveCount(original + 1);
	await second.getByRole('button', { name: 'Add row', exact: true }).click();
	await expect(second.locator('[data-layout-row]')).toHaveCount(original + 2);
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await edit(second);
	await expect(second.locator('[data-layout-row]')).toHaveCount(original + 2);
	await expect(second.getByText('Recovered your unsaved layout.')).toBeVisible();
});

test('unavailable draft storage leaves layout editing and explicit Save usable', async ({
	page
}) => {
	await page.addInitScript(() => {
		const open = IDBFactory.prototype.open;
		IDBFactory.prototype.open = function (name: string, version?: number) {
			if (name === 'dn.mobile.player-drafts')
				throw new DOMException('Unavailable', 'SecurityError');
			return open.call(this, name, version);
		};
	});
	await routes(page);
	await edit(page);
	const rows = page.locator('[data-layout-row]'),
		initial = await rows.count();
	await expect(page.getByText(/could not keep a recovery copy/)).toHaveCount(0);
	await page.getByRole('button', { name: 'Add row', exact: true }).click();
	await expect(page.getByText(/could not keep a recovery copy/)).toBeVisible();
	await page.getByRole('button', { name: 'Save layout', exact: true }).click();
	await expect(page.locator('[data-part=now-playing]')).toBeVisible();
	await edit(page);
	await expect(rows).toHaveCount(initial + 1);
	await expect(page.getByText(/could not keep a recovery copy/)).toHaveCount(0);
});

test('an outstanding five-column version 1 draft survives upgrading an explicitly saved former default header', async ({
	page
}) => {
	await routes(page);
	await page.goto('/');
	await page.evaluate(
		async ({ server, saved }) => {
			const field = (id: string, options = {}) => ({ id, title: '', preview: true, ...options });
			const body = field('player-title', { sameRow: false });
			const header = [
				'player-close',
				'player-heading',
				'player-settings',
				'player-queue',
				'player-output'
			].map((id) =>
				field(id, {
					placement: 'header',
					...(id === 'player-heading' ? { width: 2, align: 'center', maxLines: 2 } : {})
				})
			);
			localStorage.setItem(saved, JSON.stringify([body, ...header]));
			const oldFile = (sections: unknown[]) =>
				JSON.stringify({ format: 'droppedneedle-player-layout', version: 1, sections });
			const request = indexedDB.open('dn.mobile.player-drafts', 1);
			request.onupgradeneeded = () => request.result.createObjectStore('layouts');
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const tx = db.transaction('layouts', 'readwrite');
			tx.objectStore('layouts').put(
				{
					baseline: oldFile([body]),
					layout: oldFile([
						body,
						field('player-text', { template: 'Sleeve notes', sameRow: false })
					])
				},
				[server, 'alex', 123, 'old-edit']
			);
			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			db.close();
		},
		{ server, saved }
	);
	await edit(page);
	await expect(page.getByText('Recovered your unsaved layout.', { exact: true })).toBeVisible();
	const sample = page.locator('[data-part=sample-player]');
	await expect(sample.getByText('Sleeve notes', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	const live = page.locator('[data-part=now-playing]');
	await expect(live.locator('[data-part=player-header-row] > [data-section-id]')).toHaveCount(5);
	await expect(live.getByText('Sleeve notes', { exact: true })).toHaveCount(0);
});
