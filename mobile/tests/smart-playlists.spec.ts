import { expect, test, type Page } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { localSignIn } from './fixtures/localSignIn';

const server = 'https://smart.example/dn';
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
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
	await dialog.getByLabel('Playlist rating', { exact: true }).selectOption('4');
	await dialog.getByLabel('Audio formats').fill('FLAC');
	await dialog.getByLabel('Playlist sort', { exact: true }).selectOption('album');
	await dialog.getByLabel('Sort direction').selectOption('desc');
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
