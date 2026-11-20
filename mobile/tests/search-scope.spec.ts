import { expect, test } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';

test('category changes keep the query, page the selected bucket, and open genres and playlists inside Search', async ({
	page
}) => {
	const server = 'https://scope.example/music';
	const searched: string[] = [];
	const list = { id: 'rail', name: 'Rail journeys', cover_urls: [], song_count: 0, is_owner: true };
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			url = new URL(req.url()),
			path = url.pathname.split('/api/v3')[1];
		const json = (data: unknown) => route.fulfill({ json: data });
		if (path === '/auth/providers')
			return json({ local: true, oidc: false, plex: false, jellyfin: false });
		if (path === '/auth/login') return json({ token: 'scoped' });
		expect(req.headers().authorization).toBe('Bearer scoped');
		expect(req.method()).toBe('GET');
		if (path === '/me') return json({ id: 'listener', display_name: 'Listener', role: 'user' });
		if (path === '/discover')
			return json({
				sections: [
					{
						key: 'genre_list',
						content: {
							shape: 'shelf',
							shelf: {
								type: 'genres',
								title: 'Genres',
								items: [{ kind: 'genre', name: 'Rail folk' }]
							}
						}
					}
				]
			});
		if (path === '/home/genre/Rail%20folk')
			return json({ genre: 'Rail folk', library: { albums: [], artists: [] }, popular: null });
		if (path === '/playlists')
			return json({ playlists: [list, { id: 'other', name: 'Rail private', is_redacted: true }] });
		if (path === '/playlists/rail') return json({ ...list, tracks: [] });
		if (path.startsWith('/search')) {
			expect(url.searchParams.get('q')).toBe('rail');
			searched.push(path);
			if (path === '/search')
				return json({
					albums: [],
					artists: [],
					tracks: [],
					album_status: 'ok',
					artist_status: 'ok',
					track_status: 'ok'
				});
			expect(url.searchParams.get('limit')).toBe('24');
			const offset = Number(url.searchParams.get('offset'));
			if (path === '/search/artists')
				return json({
					status: 'ok',
					results: Array.from({ length: offset === 0 ? 24 : 1 }, (_, i) => ({
						title: 'Rail artist ' + (i + offset),
						id: 'a' + (i + offset)
					}))
				});
			if (path === '/search/albums')
				return json({
					status: 'ok',
					results: [{ title: 'Rail album', id: 'album', art_missing: true }]
				});
			if (path === '/search/tracks')
				return json({
					status: 'ok',
					results: [
						{
							title: 'Rail song',
							id: 'song',
							track: { album_title: 'Rail album' },
							art_missing: true
						}
					]
				});
		}
		if (await emptyBoardRead(route)) return;
		throw Error('Unexpected search fixture endpoint ' + path);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Music' })
		.getByRole('button', { name: 'Search' })
		.click();
	const scopes = page.getByRole('group', { name: 'Search category' });
	const input = page.getByRole('searchbox', { name: 'Search music' });
	await input.fill('rail');
	await expect(page.getByText('No matches for “rail”.')).toBeVisible();
	await scopes.getByRole('button', { name: 'Artists' }).click();
	await expect(page.getByRole('button', { name: 'Rail artist 0', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Next results' }).click();
	await expect(page.getByRole('button', { name: 'Rail artist 24' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Next results' })).toBeDisabled();
	await page.getByRole('button', { name: 'Previous results' }).click();
	await expect(page.getByRole('button', { name: 'Rail artist 0', exact: true })).toBeVisible();
	await scopes.getByRole('button', { name: 'Albums' }).click();
	await expect(page.getByText('Rail album', { exact: true })).toBeVisible();
	await scopes.getByRole('button', { name: 'Songs' }).click();
	await expect(page.getByText('Rail song', { exact: true })).toBeVisible();
	await scopes.getByRole('button', { name: 'Genres' }).click();
	await page.getByRole('button', { name: 'Rail folk', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Rail folk' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(input).toHaveValue('rail');
	await expect(scopes.getByRole('button', { name: 'Genres' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await input.fill('Rail folk');
	await expect(page.getByRole('button', { name: /as a genre/ })).toHaveCount(0);
	await input.fill('rail');
	await scopes.getByRole('button', { name: 'Playlists' }).click();
	await expect(page.getByRole('button', { name: 'Rail private', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Rail journeys' }).click();
	await expect(page.getByRole('heading', { name: 'Rail journeys' })).toBeVisible();
	await page.getByRole('button', { name: 'Back to search' }).click();
	await expect(input).toHaveValue('rail');
	expect(searched).toEqual([
		'/search',
		'/search/artists',
		'/search/artists',
		'/search/artists',
		'/search/albums',
		'/search/tracks'
	]);
});
