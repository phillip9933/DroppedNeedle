import { expect, test } from '@playwright/test';

test('browse a library artist, open their album and keep a favorite across views', async ({
	page
}) => {
	const server = 'https://music.example/dn';
	let favorite = false;
	await page.route(server + '/api/v3/**', async (route) => {
		const request = route.request(),
			url = new URL(request.url()),
			path = url.pathname.replace('/dn/api/v3', '');
		const json = (data: unknown) => route.fulfill({ json: data });
		if (path === '/auth/providers') return json({ local: true, oidc: false });
		if (path === '/auth/login') return json({ token: 'synthetic' });
		expect(request.headers().authorization).toBe('Bearer synthetic');
		if (path === '/me') return json({ id: 'listener', display_name: 'Listener', role: 'user' });
		const album = {
			id: 'album-one',
			title: 'Return Trip',
			artist_name: 'Night Train',
			favorite,
			art_missing: true
		};
		if (path === '/me/section-prefs') return json({ pages: { home: [] } });
		if (path === '/home') return json({ sections: [], refreshing: false });
		if (path === '/library/albums')
			return json({
				items: url.searchParams.get('favorites') === 'true' && !favorite ? [] : [album],
				next: null
			});
		if (path === '/library/artists')
			return json({
				items: [{ id: 'artist-one', name: 'Night Train', album_count: 1, track_count: 1 }],
				next: null
			});
		if (path === '/library/artists/artist-one/albums') return json({ items: [album], next: null });
		if (path === '/library/albums/match/album-one')
			return json({
				items: [
					{
						id: 'song',
						title: 'Overnight',
						album_title: album.title,
						artist_name: 'Night Train',
						disc_number: 1,
						track_number: 1,
						art_missing: true
					}
				],
				total: 1
			});
		if (path === '/favorites/album/album-one' && request.method() === 'PUT') {
			favorite = request.postDataJSON().favorited;
			return json({ kind: 'album', item_id: 'album-one', favorited: favorite });
		}
		throw Error('Unexpected fixture request ' + path);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.getByRole('button', { name: 'Library', exact: true }).click();
	await page.getByRole('button', { name: 'Browse Artists', exact: true }).click({ timeout: 2500 });
	await page.getByRole('button', { name: /Night Train/ }).click();
	await page.getByRole('button', { name: /Return Trip/ }).click();
	await page.getByRole('button', { name: 'Favorite album', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Remove album from favorites' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('heading', { name: 'Night Train', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Back to Library', exact: true }).click();
	await page.getByRole('button', { name: 'Browse Albums', exact: true }).click();
	await page.getByRole('button', { name: 'Favorites only' }).click();
	await expect(page.getByRole('button', { name: /Return Trip/ })).toBeVisible();
	expect(favorite).toBe(true);
});
