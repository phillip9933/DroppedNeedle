import { emptyBoardRead } from './fixtures/emptyBoardRead';
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
				items: [
					{ id: 'artist-one', name: 'Night Train', album_count: 1, track_count: 1, favorite: false }
				],
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
		if (await emptyBoardRead(route)) return;
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

test('rating and format filters preserve the server cursor and stay off previews', async ({
	page
}) => {
	const server = 'https://music.example/dn',
		lookups: string[] = [];
	const album = (id: string, title: string) => ({
		id,
		title,
		artist_name: 'Jasper',
		art_missing: true
	});
	const song = (id: string, title: string) => ({ ...album(id, title), album_title: 'Sparks' });
	let formatReads = 0;
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			url = new URL(req.url()),
			path = url.pathname.replace('/dn/api/v3', ''),
			p = url.searchParams;
		const json = (body: unknown) => route.fulfill({ json: body });
		if (path === '/auth/providers') return json({ local: true, oidc: false });
		if (path === '/auth/login') return json({ token: 'fixture' });
		expect(req.method()).toBe('GET');
		expect(req.headers().authorization).toBe('Bearer fixture');
		if (path === '/me') return json({ id: 'listener', display_name: 'Listener' });
		if (path === '/me/section-prefs') return json({ pages: { home: [] } });
		if (path === '/home') return json({ sections: [], refreshing: false });
		if (path === '/library/albums/formats') {
			formatReads++;
			if (formatReads === 1) return route.fulfill({ status: 503, json: {} });
			return json({
				items: [
					{ format: 'flac', album_count: 2 },
					{ format: 'mp3', album_count: 1 }
				]
			});
		}
		if (path === '/library/stats') return json({ format_breakdown: { alac: 20, wav: 2 } });
		if (path === '/library/albums') {
			lookups.push(path + '?' + p);
			if (
				p.get('rating') === '4' &&
				p.get('formats') === 'flac' &&
				p.get('format_mode') === 'with'
			) {
				expect(p.get('rating_mode')).toBe('at_least');
				return p.has('after')
					? json({ items: [album('second', 'Encore')], next: null })
					: json({ items: [album('first', 'Session')], next: 'continue-4-flac' });
			}
			return json({ items: [album('base', 'Overture')], next: null });
		}
		if (path === '/library/tracks') {
			lookups.push(path + '?' + p);
			const match =
				p.get('rating') === '2' &&
				p.get('rating_mode') === 'at_most' &&
				p.get('formats') === 'alac,wav' &&
				p.get('format_mode') === 'without';
			return json({
				items: [song(match ? 'other' : 'one', match ? 'Open air' : 'Silent lake')],
				next: null
			});
		}
		if (await emptyBoardRead(route)) return;
		throw Error('Unexpected fixture request ' + path);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.getByRole('button', { name: 'Library', exact: true }).click();
	await expect(page.getByText('Rating and format', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Browse Albums' }).click();
	await expect(page.getByRole('button', { name: /Overture/ })).toBeVisible();
	expect(formatReads).toBe(0);
	await page.getByText('Rating and format', { exact: true }).click();
	await page.getByRole('button', { name: 'Retry formats' }).click();
	await page.getByLabel('Your rating').selectOption('4');
	await page.getByRole('checkbox', { name: 'FLAC' }).check();
	await expect(page.getByRole('button', { name: /Session/ })).toBeVisible();
	await page.getByRole('button', { name: 'More albums' }).click();
	await expect(page.getByRole('button', { name: /Encore/ })).toBeVisible();
	expect(
		lookups.some(
			(u) =>
				u.includes('after=continue-4-flac') && u.includes('rating=4') && u.includes('formats=flac')
		)
	).toBe(true);
	await page.getByRole('button', { name: 'Clear rating and format' }).click();
	await expect(page.getByRole('button', { name: /Overture/ })).toBeVisible();
	await page.getByRole('button', { name: 'Back to Library' }).click();
	await page.getByRole('button', { name: 'Browse Tracks' }).click();
	await page.getByText('Rating and format', { exact: true }).click();
	await expect(page.getByRole('checkbox', { name: 'FLAC' })).toHaveCount(0);
	await page.getByRole('checkbox', { name: 'ALAC' }).check();
	await page.getByRole('checkbox', { name: 'WAV' }).check();
	await page.getByLabel('Selected formats').selectOption('without');
	await page.getByLabel('Your rating').selectOption('2');
	await page.getByLabel('Rating range').selectOption('at_most');
	await expect(page.getByRole('button', { name: 'Play Open air', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Clear rating and format' }).click();
	await expect(page.getByRole('button', { name: 'Play Silent lake', exact: true })).toBeVisible();
	expect(lookups.at(-1)).not.toMatch(/formats=|rating=|after=/);
});
