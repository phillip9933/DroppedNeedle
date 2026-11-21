import { chooseOption } from './fixtures/inlineChoice';
import { expect, test, type Page } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { localSignIn } from './fixtures/localSignIn';
import { seedOfflineMusic } from './fixtures/offlineMusic';

const server = 'https://smart.example/dn';
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
test('five-star jazz from a year range uses personal history before its limit, including on device', async ({
	page
}) => {
	await fixture(page);
	const songs = ['Played yesterday', 'Early recording', 'Rediscovered', 'Never played'].map(
		(title, i) => ({
			id: 'history' + i,
			title,
			year: i === 1 ? 1975 : 1998,
			genre: 'Jazz',
			album_title: 'Collection',
			artist_name: 'Band',
			art_missing: true
		})
	);
	let oldServer = false;
	await page.route(server + '/api/v3/library/tracks?**', async (r) => {
		const q = new URL(r.request().url()).searchParams;
		if (!q.has('include_play_stats')) return r.fallback();
		expect(q.get('genre')).toBe('Jazz');
		expect(q.get('rating')).toBe('5');
		const second = q.get('after') === 'page two';
		const stats = {
			history0: { play_count: 2, last_played: Date.now() / 1000 - 86400 },
			history2: { play_count: 3, last_played: 10 }
		};
		return r.fulfill({
			json: {
				items: second ? songs.slice(2) : songs.slice(0, 2),
				total: 4,
				next: second ? null : 'page two',
				play_stats: oldServer ? undefined : stats
			}
		});
	});
	await localSignIn(page, server);
	await playlists(page);
	await seedOfflineMusic(
		page,
		server,
		'listener',
		false,
		songs.map((t) => ({
			origin: 'downloaded',
			track: {
				id: t.id,
				title: t.title,
				artist: 'Band',
				album: 'Collection',
				rating: 5,
				genre: 'Jazz',
				year: t.year,
				streamUrl: '/api/v3/stream/local/' + t.id
			}
		}))
	);
	await button(page, 'Create smart playlist').click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Playlist name').fill('Back in rotation');
	await chooseOption(dialog.getByLabel('Playlist rating', { exact: true }), '5');
	await dialog.getByText('Genre, year and listening history').click();
	await dialog.getByLabel('Genre', { exact: true }).fill('Jazz');
	await dialog.getByLabel('Earliest year').fill('1990');
	await dialog.getByLabel('Maximum plays').fill('4');
	await dialog.getByLabel('Not played in the last (days)').fill('90');
	await dialog.getByLabel('Track limit').fill('2');
	await dialog.getByRole('button', { name: 'Create smart playlist', exact: true }).click();
	await button(page, 'Back in rotation').click();
	await expect(button(page, 'Play Rediscovered')).toBeVisible();
	await expect(button(page, 'Play Never played')).toBeVisible();
	await expect(button(page, 'Play Played yesterday')).toHaveCount(0);
	await button(page, 'Back to Playlists').click();
	oldServer = true;
	await button(page, 'Back in rotation').click();
	await expect(page.getByRole('alert')).toContainText('Update your DN server');
	await seedOfflineMusic(page, server, 'listener', true, []);
	await expect(page.getByRole('group', { name: 'Offline availability' })).toBeVisible();
	await button(page, 'Back in rotation').click();
	await expect(button(page, 'Play Never played')).toBeVisible();
	await expect(button(page, 'Play Played yesterday')).toHaveCount(0);
});
async function playlists(page: Page) {
	await button(page, 'Library').click();
	await button(page, 'Browse Playlists').click();
	await expect(button(page, 'Create smart playlist')).toBeVisible();
}
async function fixture(page: Page) {
	let user = 'listener',
		version = 1;
	const queries: URLSearchParams[] = [],
		playlistWrites: string[] = [];
	await page.route(server + '/api/v3/**', async (r) => {
		const req = r.request(),
			url = new URL(req.url()),
			path = url.pathname.slice('/dn/api/v3'.length);
		if (path === '/auth/providers') return r.fulfill({ json: { local: true, oidc: false } });
		if (path === '/auth/login') {
			user = req.postDataJSON().username;
			return r.fulfill({ json: { token: 'fixture-' + user } });
		}
		expect(req.headers().authorization).toBe('Bearer fixture-' + user);
		if (path === '/me')
			return r.fulfill({
				json: { id: user, display_name: 'Listener', role: 'user' }
			});
		if (path === '/library/tracks' && url.searchParams.has('rating')) {
			queries.push(url.searchParams);
			const items = ['North Star', 'North Coast', 'North Wind']
				.slice(0, Number(url.searchParams.get('limit')))
				.map((title, i) => ({
					title: version === 1 ? title : title + ' Live',
					id: 't' + i,
					album_id: 'album',
					album_title: 'Dawn',
					artist_name: 'North',
					favorite: true,
					art_missing: true
				}));
			return r.fulfill({ json: { items, next: 'more', total: 75000 } });
		}
		if (path.startsWith('/playlists') && req.method() !== 'GET') playlistWrites.push(req.method());
		if (await emptyBoardRead(r)) return;
		return r.fulfill({ status: 404 });
	});
	return {
		queries,
		playlistWrites,
		updateCatalog: () => {
			version++;
		}
	};
}
async function create(page: Page) {
	await button(page, 'Create smart playlist').click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Playlist name').fill('Night driving');
	await dialog.getByLabel('Contains').fill('North');
	await dialog.getByLabel('Favorites only').check();
	await chooseOption(dialog.getByLabel('Playlist rating', { exact: true }), '4');
	await dialog.getByLabel('Audio formats').fill('FLAC');
	await chooseOption(dialog.getByLabel('Playlist sort', { exact: true }), 'album');
	await chooseOption(dialog.getByLabel('Sort direction'), 'desc');
	await dialog.getByLabel('Track limit').fill('2');
	await dialog.getByRole('button', { name: 'Create smart playlist', exact: true }).click();
	await expect(button(page, 'Night driving')).toBeVisible();
}
async function edit(page: Page, name: string) {
	await button(page, 'More options for ' + name).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Edit smart playlist' }).click();
	return page.getByRole('dialog');
}

test('a smart playlist evaluates the current DN filters and limit and keeps account-scoped edits on this device', async ({
	page
}) => {
	const env = await fixture(page);
	await localSignIn(page, server);
	await playlists(page);
	await create(page);
	await button(page, 'Night driving').click();
	await expect(button(page, 'Play North Star')).toBeVisible();
	await expect(button(page, 'Play North Coast')).toBeVisible();
	await expect(button(page, 'Play North Wind')).toHaveCount(0);
	expect(env.queries).toHaveLength(1);
	expect(Object.fromEntries(env.queries[0])).toMatchObject({
		q: 'North',
		limit: '2',
		rating: '4',
		rating_mode: 'at_least',
		favorites: 'true',
		formats: 'flac',
		format_mode: 'with',
		sort: 'album',
		order: 'desc'
	});
	await button(page, 'Back to Playlists').click();
	env.updateCatalog();
	let modal = await edit(page, 'Night driving');
	await modal.getByLabel('Playlist name').fill('Night drive live');
	await modal.getByLabel('Track limit').fill('1');
	await modal.getByRole('button', { name: 'Save playlist' }).click();
	await button(page, 'Night drive live').click();
	await expect(button(page, 'Play North Star Live')).toBeVisible();
	await expect(button(page, 'Play North Coast Live')).toHaveCount(0);
	expect(env.queries).toHaveLength(2);
	await localSignIn(page, server, 'another-listener');
	await playlists(page);
	await expect(page.getByText('No matching playlists.')).toBeVisible();
	await localSignIn(page, server);
	await playlists(page);
	modal = await edit(page, 'Night drive live');
	await modal.getByRole('button', { name: 'Delete smart playlist' }).click();
	await modal.getByRole('button', { name: 'Cancel' }).click();
	await expect(modal.getByLabel('Playlist name')).toHaveValue('Night drive live');
	await modal.getByRole('button', { name: 'Delete smart playlist' }).click();
	await modal.getByRole('button', { name: 'Delete playlist', exact: true }).click();
	await expect(page.getByText('No matching playlists.')).toBeVisible();
	expect(env.playlistWrites).toEqual([]);
});

test('in airplane mode an old download needs a confirmed rule match and known metadata takes precedence', async ({
	page
}) => {
	const env = await fixture(page);
	await localSignIn(page, server);
	await playlists(page);
	await create(page);
	await button(page, 'Night driving').click();
	await expect(button(page, 'Play North Star')).toBeVisible();
	await button(page, 'Back to Playlists').click();
	// Version 1 saved audio, before DN Mobile retained rating and format with the file.
	await page.evaluate(async (server) => {
		const db = await new Promise<IDBDatabase>((yes, no) => {
			const req = indexedDB.open('dn.mobile.offline.v1');
			req.onsuccess = () => yes(req.result);
			req.onerror = () => no(req.error);
		});
		try {
			const tx = db.transaction('tracks', 'readwrite'),
				scope = JSON.stringify([server, 'listener']);
			for (const [id, title, details] of [
				['t0', 'North Star', {}],
				['t1', 'North Coast', { rating: 1 }],
				['unknown', 'North Wind', {}]
			] as const) {
				tx.objectStore('tracks').put({
					scope,
					id,
					track: {
						id,
						title,
						artist: 'North',
						album: 'Dawn',
						streamUrl: '/api/v3/stream/local/' + id,
						...details
					},
					audio: new Blob(['fixture']),
					pinned: true,
					used: Date.now(),
					bytes: 7
				});
			}
			await new Promise<void>((yes, no) => {
				tx.oncomplete = () => yes();
				tx.onabort = () => no(tx.error);
			});
		} finally {
			db.close();
		}
	}, server);
	await button(page, 'Back to Library').click();
	await page.context().setOffline(true);
	await button(page, 'Browse Playlists').click();
	await button(page, 'Night driving').click();
	await expect(button(page, 'Play North Star')).toBeVisible();
	await expect(button(page, 'Play North Coast')).toHaveCount(0);
	await expect(button(page, 'Play North Wind')).toHaveCount(0);
	expect(env.queries).toHaveLength(1);
});
