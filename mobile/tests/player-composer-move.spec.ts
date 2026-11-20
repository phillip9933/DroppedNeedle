import { expect, test } from '@playwright/test';

test('full rows swap a chosen field and preserve independently arranged fields when a group is split', async ({
	page
}) => {
	const server = 'https://composer.example';
	const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'listener', 'player']);
	await page.addInitScript((key) => {
		localStorage.setItem(
			key,
			JSON.stringify(
				[
					['player-track', false],
					['player-title', false],
					['player-artist', true],
					['player-album', true],
					['player-text', false]
				].map(([id, sameRow]) => ({ id, sameRow, preview: true, title: '' }))
			)
		);
	}, key);
	await page.route(server + '/api/v3/**', (route) => {
		const path = new URL(route.request().url()).pathname.slice('/api/v3'.length);
		const responses: Record<string, unknown> = {
			'/auth/providers': { local: true, oidc: false },
			'/auth/login': { token: 'fixture' },
			'/me': { id: 'listener', role: 'user', display_name: 'Listener' },
			'/home': { sections: [] },
			'/library/albums': { items: [], total: 0 },
			'/me/section-prefs': { pages: {} }
		};
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
	await button('Edit Now Playing layout').click();
	await button('Try side-by-side layout').click();
	await expect(rows).not.toHaveCount(2);
	await button('Cancel').click();
	expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key)).toEqual(saved);
});
