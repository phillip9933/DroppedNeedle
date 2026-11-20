import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('a local artist links credited songs, paginated guest appearances and the DN web artist', async ({
	page,
	context
}) => {
	const server = 'https://artist.example/music',
		artistId = 'guest artist',
		artistPath = '/library/artists/' + encodeURIComponent(artistId);
	const release = (id: string, title: string, artist_name: string) => ({
		id,
		title,
		artist_name,
		art_missing: true,
		favorite: false
	});
	const song = {
		id: 'guest-song',
		title: 'After Hours',
		album_id: 'compilation',
		album_title: 'Night Cohort',
		artist_name: 'Guest Artist',
		disc_number: 1,
		track_number: 1,
		art_missing: true,
		favorite: false,
		duration_seconds: 1
	};
	let favorite = false;
	const read: string[] = [];
	await context.route(server + artistPath, (route) =>
		route.fulfill({ contentType: 'text/html', body: '<title>DN artist</title>' })
	);
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			url = new URL(req.url()),
			path = url.pathname.slice('/music/api/v3'.length),
			json = (data: unknown) => route.fulfill({ json: data });
		if (path === '/auth/providers') return json({ local: true, oidc: false });
		if (path === '/auth/login') return json({ token: 'fixture' });
		expect(req.headers().authorization).toBe('Bearer fixture');
		if (path === '/me') return json({ id: 'guest', role: 'user', display_name: 'Guest' });
		if (path === '/home') return json({ sections: [] });
		if (path === '/me/section-prefs') return json({ pages: {} });
		if (path === '/library/albums') return json({ items: [], total: 0 });
		if (path === '/library/artists')
			return json({
				items: [
					{
						id: artistId,
						name: 'Guest Artist',
						album_count: 1,
						track_count: 1,
						artist_mbid: '64b535c0-2ab8-4051-83e7-06856fda2a45',
						favorite
					}
				],
				total: 1
			});
		if (path === artistPath + '/albums') {
			read.push('albums');
			return json({ items: [release('solo', 'Solo sessions', 'Guest Artist')], total: 1 });
		}
		if (path === artistPath + '/appearances') {
			const after = url.searchParams.get('after');
			read.push(after ? 'later appearances' : 'appearances');
			return json(
				after
					? { items: [release('compilation', 'Night Cohort', 'Various Artists')], total: 2 }
					: { items: [release('pair', 'Night Duo', 'Night Duo')], total: 2, next: 'second-page' }
			);
		}
		if (path === '/library/albums/match/compilation') return json({ items: [song], total: 1 });
		if (path === '/favorites/artist/' + encodeURIComponent(artistId)) {
			expect(req.postDataJSON()).toEqual({ favorited: true });
			favorite = true;
			return json({ favorited: favorite });
		}
		if (path === '/library/tracks' && url.searchParams.has('artist_id')) {
			expect(url.searchParams.get('artist_id')).toBe(artistId);
			read.push('songs');
			return json({ items: [song], total: 1 });
		}
		if (path === '/stream/local/guest-song')
			return route.fulfill({
				path: fileURLToPath(
					new URL('../../server/tests/fixtures/library/management_full.wav', import.meta.url)
				),
				contentType: 'audio/wav'
			});
		if (await emptyBoardRead(route)) return;
		throw Error('Unexpected DN endpoint ' + path);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username', { exact: true }).fill('guest');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.getByRole('button', { name: 'Library', exact: true }).click();
	await page.getByRole('button', { name: 'Browse Artists', exact: true }).click();
	await page.getByRole('button', { name: /Guest Artist 1 album/ }).click();
	await expect(page.getByRole('button', { name: 'Solo sessions Guest Artist' })).toBeVisible();
	expect(read).toEqual(['albums']);
	await page.getByRole('button', { name: 'Favorite artist', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Remove artist from favorites' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Artist profile', exact: true })).toBeVisible();
	const view = page.getByLabel('Artist library view');
	await view.selectOption('appearances');
	await page.getByRole('button', { name: 'Select items' }).click();
	await page.getByRole('button', { name: 'Select Night Duo' }).click();
	await page.getByRole('button', { name: 'More appearances', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Select Night Duo' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: 'Select loaded' }).click();
	await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
	const dismissed = await page.evaluate(
		() => !window.dispatchEvent(new CustomEvent('dn-back', { cancelable: true }))
	);
	expect(dismissed).toBe(true);
	await expect(page.getByRole('group', { name: 'Selection actions' })).toHaveCount(0);
	await expect(view).toBeVisible();
	await page.getByRole('button', { name: 'Night Cohort Various Artists' }).click();
	await expect(page.getByRole('heading', { name: 'Night Cohort', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Select items' }).click();
	await page.getByRole('button', { name: 'Select After Hours' }).click();
	await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(view).toHaveValue('appearances');
	await expect(page.getByRole('button', { name: 'Night Duo Night Duo' })).toBeVisible();
	await view.selectOption('songs');
	await page.getByRole('button', { name: 'Play After Hours', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'After Hours', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Close player' }).click();
	await expect(view).toHaveValue('songs');
	expect(read).toContain('later appearances');
	const popup = page.waitForEvent('popup');
	await page.getByRole('link', { name: 'Open artist in web app' }).click();
	const browser = await popup;
	await expect(browser).toHaveURL(server + artistPath);
	await browser.close();
	await page.getByRole('button', { name: 'Back to artists' }).click();
	await expect(page.getByRole('heading', { name: 'Artists', exact: true })).toBeVisible();
});
