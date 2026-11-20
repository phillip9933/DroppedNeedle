import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { expect, test, type Page } from '@playwright/test';

async function startComposer(page: Page, seed: [string, boolean][]) {
	const server = 'https://composer.example';
	const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'listener', 'player']);
	await page.addInitScript(
		({ key, seed }) =>
			localStorage.setItem(
				key,
				JSON.stringify(seed.map(([id, sameRow]) => ({ id, sameRow, preview: true, title: '' })))
			),
		{ key, seed }
	);
	await page.route(server + '/api/v3/**', async (route) => {
		const path = new URL(route.request().url()).pathname.slice('/api/v3'.length);
		const responses: Record<string, unknown> = {
			'/auth/providers': { local: true, oidc: false },
			'/auth/login': { token: 'fixture' },
			'/me': { id: 'listener', role: 'user', display_name: 'Listener' }
		};
		if (!Object.hasOwn(responses, path) && (await emptyBoardRead(route))) return;
		expect(Object.hasOwn(responses, path)).toBe(true);
		return route.fulfill({ json: responses[path] });
	});
	await page.setViewportSize({ width: 320, height: 700 });
	await page.goto('/');
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	await page.getByLabel('Server address').fill(server);
	await button('Continue').click();
	await page.getByLabel('Username', { exact: true }).fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await button('Sign in').click();
	await button('Settings').click();
	await button('Edit Now Playing layout').click();
	return { key, button };
}

test('full rows swap a chosen field and preserve independently arranged fields when a group is split', async ({
	page
}) => {
	const { key, button } = await startComposer(page, [
		['player-track', false],
		['player-title', false],
		['player-artist', true],
		['player-album', true],
		['player-text', false]
	]);
	await button('Customize Track details').click();
	await button('Split Track details').click();
	const rows = page.locator('[data-player-row]');
	await expect(rows).toHaveCount(2);
	const ids = (r: number) =>
		rows
			.nth(r)
			.locator('[data-section-id]')
			.evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-section-id')));
	expect(await ids(0)).toEqual(['player-title', 'player-artist', 'player-album']);
	await button('Customize Custom text').click();
	await page.getByLabel('Move to row', { exact: true }).selectOption('0');
	await page.getByLabel('Swap with', { exact: true }).selectOption('1');
	expect(await ids(0)).toEqual(['player-title', 'player-text', 'player-album']);
	expect(await ids(1)).toEqual(['player-artist']);
	await button('Move Custom text left').focus();
	await page.keyboard.press('Enter');
	expect(await ids(0)).toEqual(['player-text', 'player-title', 'player-album']);
	for (const box of await rows
		.first()
		.getByRole('button')
		.evaluateAll((buttons) =>
			buttons.map((b) => {
				const { width, height } = b.getBoundingClientRect();
				return { width, height };
			})
		)) {
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
	}
	await button('Save layout').click();
	const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
	expect(saved.map((s: { id: string }) => s.id)).toEqual([
		'player-text',
		'player-title',
		'player-album',
		'player-artist'
	]);
	expect(saved.map((s: { sameRow: boolean }) => Boolean(s.sameRow))).toEqual([
		false,
		true,
		true,
		false
	]);
	await button('Player settings').click();
	await button('Try side-by-side layout').click();
	await expect(rows).not.toHaveCount(2);
	await button('Cancel').click();
	expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key)).toEqual(saved);
});

test('touch editing moves and resizes real sample fields, changes header actions, and saves the draft', async ({
	page
}) => {
	const { button, key } = await startComposer(page, [
		['player-title', false],
		['player-artist', false],
		['player-album', false],
		['player-artwork', false],
		['player-favorite', false],
		['player-up-next', false]
	]);
	const sample = page.locator('[data-part=sample-player]'),
		row = (i: number) => sample.locator('[data-player-row]').nth(i);
	await expect(sample.getByText('Soft Current', { exact: true })).toBeVisible();
	await expect(sample.getByText('Northline', { exact: true }).first()).toBeVisible();
	await expect(sample.locator('img')).toHaveJSProperty('complete', true);
	expect(
		await sample.locator('img').evaluate((i) => (i as HTMLImageElement).naturalWidth)
	).toBeGreaterThan(100);
	const cdp = await page.context().newCDPSession(page);
	async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
		for (let i = 1; i <= 5; i++)
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [
					{ x: from.x + ((to.x - from.x) * i) / 5, y: from.y + ((to.y - from.y) * i) / 5 }
				]
			});
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	}
	await button('Customize Artist').click();
	const grip = await button('Drag Artist').boundingBox(),
		title = await row(0).boundingBox();
	expect(grip && title).toBeTruthy();
	await drag(
		{ x: grip!.x + 22, y: grip!.y + 22 },
		{ x: title!.x + title!.width - 14, y: title!.y + title!.height / 2 }
	);
	await expect(row(0).locator('[data-section-id]')).toHaveCount(2);
	await page.getByLabel('Minimum row height', { exact: true }).fill('88');
	await expect(row(0)).toHaveCSS('min-height', '88px');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await button('Finish editing field').click();
	await button('Customize Artwork').click();
	await page.getByLabel('Element width', { exact: true }).fill('80');
	await page.getByLabel('Element width', { exact: true }).press('Tab');
	await button('Finish editing field').click();
	await button('Customize Artwork').click();
	const resize = button('Resize Artwork');
	await resize.scrollIntoViewIfNeeded();
	const box = await resize.boundingBox();
	await drag({ x: box!.x + 22, y: box!.y + 22 }, { x: box!.x - 30, y: box!.y + 24 });
	expect(Number(await page.getByLabel('Element width', { exact: true }).inputValue())).toBeLessThan(
		80
	);
	await button('Finish editing field').click();
	await button('Customize Player settings').click();
	await page.getByLabel('Player settings placement').selectOption('canvas');
	await page.getByLabel('Play queue placement').selectOption('header-start');
	await page.getByLabel('Close player placement').selectOption('hidden');
	await expect(sample.locator('[data-section-id="player-settings"]')).toHaveCount(1);
	await expect(sample.locator('header').getByRole('button', { name: 'Player menu' })).toBeVisible();
	await button('Save layout').click();
	const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
	expect(saved).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: 'player-artist', sameRow: true, minHeight: 88 }),
			expect.objectContaining({ id: 'player-close', placement: 'hidden' }),
			expect.objectContaining({ id: 'player-queue', placement: 'header-start' })
		])
	);
});
