import { expect, test } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { localSignIn } from './fixtures/localSignIn';

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
		if (path === '/search/suggest')
			return json({ status: 'ok', results: [{ title: 'Rail', kind: 'artist' }] });
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
	await expect(page.getByRole('button', { name: 'Search for Rail in Artists' })).toBeVisible();
	await input.press('Enter');
	await input.fill('');
	const history = page.getByRole('region', { name: 'Recent searches' });
	await history.getByRole('button', { name: 'Search for rail in Top results' }).click();
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

test('recent search history deduplicates submitted queries and stays within each listener and server', async ({
	page
}) => {
	const origin = 'https://history.example';
	await page.route(origin + '/**', async (r) => {
		const path = new URL(r.request().url()).pathname.split('/api/v3')[1];
		if (path === '/auth/providers') return r.fulfill({ json: { local: true, oidc: false } });
		if (path === '/auth/login')
			return r.fulfill({ json: { token: r.request().postDataJSON().username } });
		if (path === '/me')
			return r.fulfill({
				json: {
					id: r.request().headers().authorization.slice(7),
					display_name: 'Listener',
					role: 'user'
				}
			});
		if (path === '/search')
			return r.fulfill({
				json: {
					albums: [],
					artists: [],
					tracks: [],
					album_status: 'ok',
					artist_status: 'ok',
					track_status: 'ok'
				}
			});
		if (await emptyBoardRead(r)) return;
		return r.fulfill({ status: 404, json: {} });
	});
	const search = async (account: string, path = '/one') => {
		await localSignIn(page, origin + path, account);
		await page
			.getByRole('navigation', { name: 'Music' })
			.getByRole('button', { name: 'Search' })
			.click();
	};
	const box = page.getByRole('searchbox', { name: 'Search music' });
	const history = page.getByRole('region', { name: 'Recent searches' });
	await search('alice');
	for (const term of ['tide', 'Tide']) {
		await box.fill(term);
		await box.press('Enter');
	}
	await box.fill('unfinished');
	await box.fill('');
	await expect(history.getByRole('button', { name: /Search for/ })).toHaveCount(1);
	await search('bob');
	await expect(history).toHaveCount(0);
	await search('alice', '/other');
	await expect(history).toHaveCount(0);
	await search('alice');
	await expect(
		history.getByRole('button', { name: 'Search for Tide in Top results' })
	).toBeVisible();
	await history.getByRole('button', { name: 'Clear history' }).click();
	await expect(history).toHaveCount(0);
});
