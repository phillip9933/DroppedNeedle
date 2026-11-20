import { expect, test, type Page } from '@playwright/test';
const server = 'https://boards.example/dn';

async function fixture(page: Page) {
	let username = 'alex',
		loginCount = 0;
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			path = new URL(req.url()).pathname.slice('/dn/api/v3'.length);
		const json = (data: unknown) => route.fulfill({ json: data });
		if (path === '/auth/providers') return json({ local: true, oidc: false });
		if (path === '/auth/login') {
			username = req.postDataJSON().username;
			loginCount++;
			return json({ token: 'test-' + loginCount });
		}
		expect(req.headers().authorization).toBe('Bearer test-' + loginCount);
		if (path === '/me')
			return json({ id: 'id-' + username, display_name: 'Listener', role: 'user' });
		if (path === '/library/albums')
			return json({
				items: [{ id: 'album', title: 'Night train', artist_name: 'Southerly', art_missing: true }],
				next: null
			});
		if (path === '/library/artists')
			return json({ items: [{ id: 'artist', name: 'Southerly', album_count: 1 }], next: null });
		if (path === '/home' || path === '/discover') return json({ sections: [], refreshing: false });
		if (path === '/me/section-prefs') return json({ sections: [], pages: [] });
		if (path === '/auth/logout') return route.fulfill({ status: 204 });
		if (path === '/library/genres' || path === '/genres') return json({ items: [], genres: [] });
		return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
	});
}
async function login(page: Page, name = 'alex') {
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill(name);
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}
function button(page: Page, name: string) {
	return page.getByRole('button', { name, exact: true });
}
const order = (page: Page) =>
	page
		.locator('[data-widget]:visible h2')
		.allTextContents()
		.then((rows) => rows.map((s) => s.trim()));
test('a listener arranges and titles sections independently and keeps the layout after signing in again', async ({
	page
}) => {
	await fixture(page);
	await page.goto('/');
	await login(page);
	await expect(button(page, 'Browse Recently added')).toBeVisible();
	await button(page, 'Browse Recently added').click();
	await button(page, 'Home').click();
	await button(page, 'Edit Home layout').click();
	await button(page, 'Remove Recently played').click();
	await button(page, 'Add Artists').click();
	await button(page, 'Move Artists up').click();
	await page.getByRole('combobox', { name: 'Position', exact: true }).selectOption('0');
	await page.getByLabel('Section title').fill('My artists');
	await page.getByLabel('Show a preview').uncheck();
	await button(page, 'Save layout').click();
	expect(await order(page)).toEqual(['My artists', 'Recently added', 'Top picks for you']);
	await expect(page.locator('[data-widget="library-artists"]')).not.toContainText('Southerly');
	await button(page, 'Browse My artists').click();
	await expect(page.getByRole('heading', { name: 'My artists', exact: true })).toBeVisible();
	await expect(button(page, 'Southerly 1 album')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(button(page, 'Edit Home layout')).toBeVisible();
	await button(page, 'Library').click();
	await expect(button(page, 'Browse Artists')).toBeVisible();
	await button(page, 'Edit Library layout').click();
	await button(page, 'Remove Artists').click();
	await button(page, 'Save layout').click();
	await expect(button(page, 'Browse Artists')).toHaveCount(0);
	await button(page, 'Browse Playlists').click();
	await button(page, 'Add to Home').click();
	await expect(button(page, 'On Home')).toBeDisabled();
	await button(page, 'Home').click();
	expect(await order(page)).toEqual([
		'My artists',
		'Recently added',
		'Top picks for you',
		'Playlists'
	]);
	await button(page, 'Edit Home layout').click();
	await button(page, 'Restore default layout').click();
	await page.keyboard.press('Escape');
	await expect(button(page, 'Browse My artists')).toBeVisible();
	await page.reload();
	await login(page);
	await expect(button(page, 'Browse My artists')).toBeVisible();
	await page.reload();
	await login(page, 'blair');
	await expect(button(page, 'Browse My artists')).toHaveCount(0);
	await expect(button(page, 'Browse Recently played')).toBeVisible();
	await button(page, 'Library').click();
	await expect(button(page, 'Browse Artists')).toBeVisible();
});
test('an empty layout remains editable and Discover selections can be shared with Home', async ({
	page
}) => {
	await fixture(page);
	await page.goto('/');
	await login(page);
	await button(page, 'Discover').click();
	await button(page, 'Edit Discover layout').click();
	await page.getByLabel('Find a section').fill('trending artists');
	await button(page, 'Add Trending artists').click();
	await page.getByLabel('Show a preview').uncheck();
	await button(page, 'Save layout').click();
	await button(page, 'Browse Trending artists').click();
	await button(page, 'Add to Home').click();
	await button(page, 'Home').click();
	await expect(button(page, 'Browse Trending artists')).toBeVisible();
	await button(page, 'Edit Home layout').click();
	while (await page.locator('[data-section-id]').count())
		await page
			.locator('[data-section-id]')
			.first()
			.getByRole('button', { name: /^Remove / })
			.click();
	await button(page, 'Save layout').click();
	await expect(button(page, 'Add sections')).toBeVisible();
	await button(page, 'Discover').click();
	await expect(button(page, 'Browse Trending artists')).toBeVisible();
	await button(page, 'Home').click();
	await button(page, 'Add sections').click();
	await button(page, 'Restore default layout').click();
	await button(page, 'Save layout').click();
	await expect(button(page, 'Browse Recently added')).toBeVisible();
});
