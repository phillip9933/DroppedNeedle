import {
	openRule,
	applyRule,
	favoriteRule,
	ratingRule,
	playlistOptions,
	trackLimit
} from './fixtures/playlistRules';
import { chooseOption } from './fixtures/inlineChoice';
import { expect, test, type Page } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { localSignIn } from './fixtures/localSignIn';
import { seedOfflineMusic } from './fixtures/offlineMusic';
import { repeatShuffleDraws } from './fixtures/shuffleDraws';
import { silentWav } from './fixtures/silentWav';

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
		if (!q.has('include_play_stats') && q.get('limit') === '500')
			return r.fulfill({ json: { items: songs, total: songs.length, next: null } });
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
	await button(page, 'New playlist').click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: /^Smart playlist/ })
		.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Playlist name').fill('Back in rotation');
	await ratingRule(dialog, 5, true);
	await openRule(dialog, 'Genre');
	await dialog.getByRole('button', { name: /Genre Choose/ }).click();
	await page.getByRole('button', { name: 'Jazz', exact: true }).click();
	await applyRule(dialog);
	await openRule(dialog, 'Release year');
	await chooseOption(dialog.getByLabel('Condition'), 'atLeast');
	await chooseOption(dialog.getByRole('combobox', { name: 'Release year' }), '1990');
	await applyRule(dialog);
	await openRule(dialog, 'Play count');
	await chooseOption(dialog.getByLabel('Condition'), 'atMost');
	await chooseOption(dialog.getByRole('combobox', { name: 'Play count' }), 'custom');
	await dialog.getByLabel('Custom value').fill('4');
	await applyRule(dialog);
	await openRule(dialog, 'Last played');
	await chooseOption(dialog.getByRole('combobox', { name: 'Time period' }), '90');
	await applyRule(dialog);
	await trackLimit(dialog, 2);
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
	await expect(page.getByRole('heading', { name: 'Back in rotation' })).toBeVisible();
	await expect(button(page, 'Play Never played')).toBeVisible();
	await expect(button(page, 'Play Played yesterday')).toHaveCount(0);
});
async function playlists(page: Page) {
	await button(page, 'Library').click();
	await button(page, 'Browse Playlists').click();
	await expect(button(page, 'New playlist')).toBeVisible();
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
		if (path === '/library/stats')
			return r.fulfill({ json: { format_breakdown: { flac: 3 }, total_tracks: 3 } });
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
	await button(page, 'New playlist').click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: /^Smart playlist/ })
		.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Playlist name').fill('Night driving');
	await openRule(dialog, 'Search text');
	await dialog.getByLabel('Contains').fill('North');
	await applyRule(dialog);
	await favoriteRule(dialog);
	await ratingRule(dialog, 4, true);
	await openRule(dialog, 'File format');
	await dialog.getByRole('button', { name: /File format Choose/ }).click();
	await page.getByRole('button', { name: 'FLAC', exact: true }).click();
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await applyRule(dialog);
	await playlistOptions(dialog);
	await chooseOption(dialog.getByLabel('Playlist sort', { exact: true }), 'album');
	await chooseOption(dialog.getByLabel('Sort direction'), 'desc');
	await trackLimit(dialog, 2);
	await dialog.getByRole('button', { name: 'Create smart playlist', exact: true }).click();
	await expect(button(page, 'Night driving')).toBeVisible();
}
async function edit(page: Page, name: string) {
	await button(page, 'More options for ' + name).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Edit smart playlist' }).click();
	return page.getByRole('dialog');
}

test('New playlist carries its name to a full-screen rule editor and previews library matches before saving', async ({
	page
}) => {
	const env = await fixture(page);
	await localSignIn(page, server);
	await playlists(page);
	await button(page, 'New playlist').click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Playlist name').fill('Try filters');
	await dialog.getByRole('button', { name: /^Smart playlist/ }).click();
	await expect(dialog).toHaveAccessibleName('Smart playlist');
	expect((await dialog.boundingBox())?.height).toBe(page.viewportSize()!.height);
	await expect(dialog.getByLabel('Playlist name')).toHaveValue('Try filters');
	await ratingRule(dialog, 4, true);
	await trackLimit(dialog, 2);
	await dialog.getByRole('button', { name: 'Preview matching tracks' }).click();
	await expect(dialog.getByRole('region', { name: 'Matching tracks' })).toContainText('North Star');
	await dialog.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(dialog).toHaveAccessibleName('New playlist');
	await expect(dialog.getByLabel('Playlist name')).toHaveValue('Try filters');
	await dialog.getByRole('button', { name: /^Smart playlist/ }).click();
	await expect(dialog.getByRole('button', { name: 'Rating is at least 4 stars' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(button(page, 'Try filters')).toHaveCount(0);
	expect(env.playlistWrites).toEqual([]);
});

test('shuffling a saved smart playlist after closing the app gives a fresh order for the same matches', async ({
	context
}) => {
	await repeatShuffleDraws(context);
	let previous: string[] = [];
	for (let i = 0; i < 2; i++) {
		const app = await context.newPage();
		await fixture(app);
		await app.route(server + '/api/v3/stream/local/**', (r) =>
			r.fulfill({ contentType: 'audio/wav', body: silentWav() })
		);
		await localSignIn(app, server);
		await playlists(app);
		if (i === 0) await create(app);
		await button(app, 'Night driving').click();
		await button(app, 'Shuffle all').click();
		await button(app, 'Show play queue').click();
		const rows = app.locator('[data-part=play-queue] strong');
		await expect(rows).toHaveCount(2);
		const order = await rows.allTextContents();
		expect([...order].sort()).toEqual(['North Coast', 'North Star']);
		if (i > 0) expect(order).not.toEqual(previous);
		previous = order;
		await app.close();
	}
});

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
	await trackLimit(modal, 1);
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

test('rule groups keep their scope, cancel discards an edit, and new playlists use 10,000 tracks', async ({
	page
}) => {
	await fixture(page);
	let finishIndex!: () => void;
	const lastPage = new Promise<void>((resolve) => {
		finishIndex = resolve;
	});
	await page.route(server + '/api/v3/library/tracks?**', async (route) => {
		const q = new URL(route.request().url()).searchParams;
		if (q.get('limit') !== '500') return route.fallback();
		if (q.get('after') === 'more genres') {
			await lastPage;
			return route.fulfill({ json: { items: [{ genre: 'Punk' }], total: 2, next: null } });
		}
		return route.fulfill({ json: { items: [{ genre: 'Rock' }], total: 2, next: 'more genres' } });
	});
	await localSignIn(page, server);
	await playlists(page);
	await button(page, 'New playlist').click();
	const dialog = page.locator('dialog[open]');
	await dialog.getByRole('button', { name: /^Smart playlist/ }).click();
	await dialog.getByLabel('Playlist name').fill('Five-star rock');
	await expect(dialog.locator('summary')).toContainText('Up to 10,000 tracks');
	await ratingRule(dialog, 5);
	await dialog.getByRole('button', { name: 'Add group', exact: true }).click();
	await dialog.getByRole('searchbox', { name: 'Find a rule' }).fill('gen');
	await dialog.getByRole('button', { name: 'Genre', exact: true }).click();
	await dialog.getByRole('button', { name: /Genre Choose/ }).click();
	await page.getByRole('searchbox', { name: 'Search choices' }).fill('ro');
	await expect(page.getByRole('button', { name: 'Punk', exact: true })).toHaveCount(0);
	await expect(button(page, 'Rock')).toBeVisible();
	finishIndex();
	await button(page, 'Rock').click();
	await applyRule(dialog);
	const group = dialog.locator('.rule-group.nested');
	await expect(group.getByRole('combobox')).toHaveAttribute('data-value', 'any');
	await group.getByRole('button', { name: 'Add rule', exact: true }).click();
	await dialog.getByRole('button', { name: 'Genre', exact: true }).click();
	await dialog.getByRole('button', { name: /Genre Choose/ }).click();
	await button(page, 'Punk').click();
	await applyRule(dialog);
	await expect(group.getByRole('button', { name: 'Genre is Punk' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Create smart playlist', exact: true }).click();
	await expect(button(page, 'Five-star rock')).toBeVisible();
	await edit(page, 'Five-star rock');
	await dialog.getByRole('button', { name: 'Genre is Punk' }).click();
	await dialog.getByRole('button', { name: 'Genre Punk' }).click();
	await page.getByRole('searchbox', { name: 'Search choices' }).fill('Secondary tag');
	await button(page, 'Use exact genre “Secondary tag”').click();
	await applyRule(dialog);
	await expect(group.getByRole('button', { name: 'Genre is Secondary tag' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Genre is Secondary tag' }).click();
	await dialog.getByRole('button', { name: 'Remove rule', exact: true }).click();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await edit(page, 'Five-star rock');
	await expect(group.getByRole('button', { name: 'Genre is Punk' })).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Rating is 5 stars' })).toBeVisible();
	await group.getByRole('button', { name: 'Remove group' }).click();
	await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
	await dialog.getByRole('button', { name: 'Save playlist', exact: true }).click();
	await edit(page, 'Five-star rock');
	await expect(dialog.getByRole('button', { name: 'Rating is 5 stars' })).toBeVisible();
	await expect(group).toHaveCount(0);
});
