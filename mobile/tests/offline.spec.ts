import { chooseOption } from './fixtures/inlineChoice';
import { expect, test, type Page } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';

const server = 'https://offline.example/dn';
function wav() {
	const samples = 8000 * 12,
		audio = Buffer.alloc(44 + samples * 2);
	audio.write('RIFF');
	audio.writeUInt32LE(audio.length - 8, 4);
	audio.write('WAVEfmt ', 8);
	audio.writeUInt32LE(16, 16);
	audio.writeUInt16LE(1, 20);
	audio.writeUInt16LE(1, 22);
	audio.writeUInt32LE(8000, 24);
	audio.writeUInt32LE(16000, 28);
	audio.writeUInt16LE(2, 32);
	audio.writeUInt16LE(16, 34);
	audio.write('data', 36);
	audio.writeUInt32LE(samples * 2, 40);
	return audio;
}
async function fixture(page: Page) {
	let user = 'listener',
		streams = 0,
		disconnected = false;
	const album = { id: 'evening', title: 'Pacific Lines', artist_name: 'North', art_missing: true };
	const tracks = ['Held over', 'Platform lights'].map((title, i) => ({
		title,
		id: 't' + i,
		album_id: 'evening',
		artist_id: 'north',
		genre: 'Folk',
		year: 1971,
		favorite: i === 0,
		album_title: 'Pacific Lines',
		artist_name: 'North',
		disc_number: 1,
		track_number: i + 1,
		duration_seconds: 12,
		art_missing: true
	}));
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			url = new URL(req.url()),
			path = url.pathname.split('/api/v3')[1];
		const json = (data: unknown) => route.fulfill({ json: data });
		if (path.startsWith('/stream/local/')) {
			streams++;
			if (disconnected) return route.abort('internetdisconnected');
			expect(req.headers().authorization).toBe('Bearer fixture-' + user);
			expect(url.searchParams.has('token')).toBe(false);
			return route.fulfill({ body: wav(), contentType: 'audio/wav' });
		}
		if (disconnected) return route.abort('internetdisconnected');
		if (path === '/auth/providers') return json({ local: true, oidc: false });
		if (path === '/auth/login') {
			user = req.postDataJSON().username;
			return json({ token: 'fixture-' + user });
		}
		expect(req.headers().authorization).toBe('Bearer fixture-' + user);
		if (path === '/me') return json({ id: user, display_name: 'Listener', role: 'user' });
		if (path === '/library/albums') return json({ items: [album], next: null, total: 1 });
		if (path === '/ratings/lookup') return json({ tracks: { t0: 5 }, albums: {}, artists: {} });
		if (path === '/library/albums/match/evening' || path === '/library/tracks') {
			const rows =
				url.searchParams.get('favorites') === 'true' ? tracks.filter((t) => t.favorite) : tracks;
			return json({ items: rows, total: rows.length });
		}
		if (await emptyBoardRead(route)) return;
		return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
	});
	return {
		streams: () => streams,
		disconnect: async () => {
			disconnected = true;
			await page.context().setOffline(true);
		}
	};
}
async function login(page: Page, user = 'listener') {
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill(user);
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}
async function offline(page: Page) {
	await page.getByRole('button', { name: 'Library', exact: true }).click();
	await page.getByRole('button', { name: 'Offline music', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Offline music', exact: true })).toBeVisible();
}
async function options(page: Page) {
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Offline and cache' }).click();
	await expect(page.getByLabel('Cache songs during playback')).toBeEnabled();
}
async function album(page: Page) {
	await page
		.getByRole('button', { name: /Pacific Lines/ })
		.first()
		.click();
	await expect(page.getByRole('button', { name: 'Play album', exact: true })).toBeVisible();
}

test('saved music survives a new app session, stays private to a listener and plays with networking disconnected', async ({
	page
}) => {
	const env = await fixture(page);
	await login(page);
	await album(page);
	await page.getByRole('button', { name: 'Album actions', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Save offline', exact: true }).click();
	await expect(page.getByText('2 songs saved offline.', { exact: true })).toBeAttached();
	expect(env.streams()).toBe(2);
	await login(page, 'other-listener');
	await offline(page);
	await expect(page.getByText(/Choose Save offline/)).toBeVisible();
	await login(page);
	await offline(page);
	await env.disconnect();
	const offlineView = page.getByRole('region', { name: 'Offline music' });
	await offlineView.getByRole('button', { name: 'Play all', exact: true }).click();
	const playing = page.getByRole('region', { name: 'Now playing' });
	await expect(playing.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect
		.poll(() => playing.getByRole('slider', { name: 'Playback position' }).inputValue())
		.not.toBe('0');
	expect(env.streams()).toBe(2);
	await playing.getByRole('button', { name: 'Close player' }).click();
	await offlineView.getByRole('button', { name: 'Select songs' }).click();
	await offlineView.getByRole('button', { name: 'Select all' }).click();
	await offlineView.getByRole('button', { name: 'Remove selected' }).click();
	await offlineView.getByRole('button', { name: 'Keep music', exact: true }).click();
	await expect(offlineView.getByText('2 selected')).toBeVisible();
	await offlineView.getByRole('button', { name: 'Remove selected' }).click();
	await offlineView.getByRole('button', { name: 'Confirm removal' }).click();
	await expect(offlineView.getByText(/Choose Save offline/)).toBeVisible();
});

test('completed playback can be cached, pinned and cleared independently of saved downloads', async ({
	page
}) => {
	const env = await fixture(page);
	await login(page);
	await options(page);
	await page.getByLabel('Cache songs during playback').check();
	await expect(page.getByLabel('Cache songs during playback')).toBeChecked();
	await chooseOption(page.getByLabel('Playback cache limit'), '128');
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
	await album(page);
	await page.getByRole('button', { name: 'Play album', exact: true }).click();
	const playing = page.getByRole('region', { name: 'Now playing' });
	await playing.getByRole('button', { name: 'Pause', exact: true }).click();
	await playing.getByRole('button', { name: 'Close player' }).click();
	await offline(page);
	await page.getByRole('button', { name: 'Playback cache', exact: true }).click();
	await page.getByRole('button', { name: 'Keep Held over offline', exact: true }).click();
	await page.getByRole('button', { name: 'Saved downloads', exact: true }).click();
	await expect(
		page.getByRole('region', { name: 'Offline music' }).getByText('Held over', { exact: true })
	).toBeVisible();
	expect(env.streams()).toBe(1);
	await page
		.getByRole('navigation', { name: 'Music' })
		.getByRole('button', { name: 'Home', exact: true })
		.click();
	await album(page);
	await page.getByRole('button', { name: 'Play Platform lights', exact: true }).click();
	await playing.getByRole('button', { name: 'Pause', exact: true }).click();
	await playing.getByRole('button', { name: 'Close player' }).click();
	await options(page);
	await page.getByRole('button', { name: 'Clear playback cache', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm clear cache', exact: true }).click();
	await expect(page.getByText('Playback cache cleared.', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Open offline music', exact: true }).click();
	await expect(
		page.getByRole('region', { name: 'Offline music' }).getByText('Held over', { exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Playback cache', exact: true }).click();
	await expect(page.getByText(/Enable caching in Offline settings/)).toBeVisible();
	expect(env.streams()).toBe(2);
});

for (const retained of ['cached', 'automatic'] as const) {
	test(
		'Now Playing keeps a ' + retained + ' copy without a second transfer and confirms removal',
		async ({ page }) => {
			const env = await fixture(page);
			const button = (name: string) => page.getByRole('button', { name, exact: true });
			await login(page);
			await options(page);
			if (retained === 'cached') {
				await page.getByLabel('Cache songs during playback').check();
			} else {
				await chooseOption(page.getByLabel('Download source'), 'favorites');
				await expect(page.getByText('1 automatic download added.', { exact: true })).toBeVisible();
			}
			await button('Back').click();
			await button('Back').click();
			await album(page);
			await button('Play album').click();
			await button('Pause').click();
			expect(env.streams()).toBe(1);
			await env.disconnect();
			await button('More actions').click();
			await button(retained === 'cached' ? 'Keep cached track' : 'Keep automatic download').click();
			await expect(button('Manage track download')).toHaveText('Downloaded');
			await button('Manage track download').click();
			await button('Keep download').click();
			await expect(page.getByRole('dialog', { name: 'Remove download?' })).toHaveCount(0);
			await button('Manage track download').click();
			await button('Remove download').click();
			await expect(button('Connect to download')).toBeDisabled();
			expect(env.streams()).toBe(1);
		}
	);
}

test('opted-in downloads follow their source, keep manual upgrades and respect removals', async ({
	page
}) => {
	const env = await fixture(page);
	await login(page);
	await options(page);
	expect(env.streams()).toBe(0);
	const source = page.getByLabel('Download source');
	await expect(source).toHaveAttribute('data-value', 'off');
	await chooseOption(source, 'favorites');
	await expect(page.getByText('1 automatic download added.', { exact: true })).toBeVisible();
	expect(env.streams()).toBe(1);
	const open = page.getByRole('button', { name: 'Open offline music', exact: true });
	await open.click();
	const shelf = page.getByRole('region', { name: 'Offline music' });
	await shelf.getByRole('button', { name: 'Automatic downloads', exact: true }).click();
	await expect(shelf.getByText('Held over', { exact: true })).toBeVisible();
	await expect(shelf.getByText('Platform lights', { exact: true })).toHaveCount(0);
	await shelf.getByRole('button', { name: 'Keep Held over offline', exact: true }).click();
	await shelf.getByRole('button', { name: 'Saved downloads', exact: true }).click();
	await expect(shelf.getByText('Held over', { exact: true })).toBeVisible();
	expect(env.streams()).toBe(1);
	await options(page);
	await chooseOption(source, 'recent');
	await expect(page.getByText('1 automatic download added.', { exact: true })).toBeVisible();
	expect(env.streams()).toBe(2);
	await open.click();
	await shelf.getByRole('button', { name: 'Automatic downloads', exact: true }).click();
	await expect(shelf.getByText('Platform lights', { exact: true })).toBeVisible();
	await shelf
		.getByRole('button', { name: 'Remove offline copy of Platform lights', exact: true })
		.click();
	await shelf.getByRole('button', { name: 'Confirm removal', exact: true }).click();
	await options(page);
	await page.getByRole('button', { name: 'Update automatic downloads', exact: true }).click();
	await expect(page.getByText('No automatic downloads added.', { exact: true })).toBeVisible();
	expect(env.streams()).toBe(2);
	await chooseOption(source, 'off');
	await expect(source).toHaveAttribute('data-value', 'off');
	await open.click();
	await shelf.getByRole('button', { name: 'Saved downloads', exact: true }).click();
	await expect(shelf.getByText('Held over', { exact: true })).toBeVisible();
	const saved = await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open('dn.mobile.offline.v1');
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		return new Promise<Record<string, unknown>>((resolve, reject) => {
			const read = db.transaction('tracks').objectStore('tracks').getAll();
			read.onsuccess = () => {
				resolve(read.result[0].track);
				db.close();
			};
			read.onerror = () => reject(read.error);
		});
	});
	expect(saved).toMatchObject({
		artistId: 'north',
		albumId: 'evening',
		genre: 'Folk',
		year: 1971,
		rating: 5
	});
	await env.disconnect();
	await shelf.getByRole('button', { name: 'Play all', exact: true }).click();
	await expect(
		page
			.getByRole('region', { name: 'Now playing' })
			.getByRole('button', { name: 'Pause', exact: true })
	).toBeVisible();
	expect(env.streams()).toBe(2);
});

test('older pinned and cached entries keep their provenance and incomplete bytes stay hidden', async ({
	page
}) => {
	await fixture(page);
	await login(page);
	await page.evaluate(
		async ({ server }) => {
			const key = JSON.stringify([server, 'listener']);
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open('dn.mobile.offline.v1', 1);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(['tracks', 'options'], 'readwrite'),
					tracks = tx.objectStore('tracks');
				tx.objectStore('options').put(
					{ autoCache: true, unmeteredOnly: true, cacheMiB: 128, offlineOnly: false },
					key
				);
				for (const [id, pinned, bytes] of [
					['old saved', true, 3],
					['old cached', false, 3],
					['broken', true, 6]
				] as const)
					tracks.put({
						scope: key,
						id,
						pinned,
						bytes,
						audio: new Blob(['abc'], { type: 'audio/mpeg' }),
						used: 1,
						track: {
							id,
							title: id,
							artist: 'North',
							album: 'Old',
							streamUrl: '/api/v3/stream/local/' + encodeURIComponent(id)
						}
					});
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			db.close();
		},
		{ server }
	);
	await offline(page);
	const shelf = page.getByRole('region', { name: 'Offline music' });
	await expect(shelf.getByText('old saved', { exact: true })).toBeVisible();
	await expect(shelf.getByText('broken', { exact: true })).toHaveCount(0);
	await shelf.getByRole('button', { name: 'Automatic downloads', exact: true }).click();
	await expect(shelf.getByText('old cached', { exact: true })).toHaveCount(0);
	await shelf.getByRole('button', { name: 'Playback cache', exact: true }).click();
	await expect(shelf.getByText('old cached', { exact: true })).toBeVisible();
	await options(page);
	await expect(page.getByLabel('Download source')).toHaveAttribute('data-value', 'off');
	await page.getByRole('button', { name: 'Clear playback cache', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm clear cache', exact: true }).click();
	await page.getByRole('button', { name: 'Open offline music', exact: true }).click();
	await shelf.getByRole('button', { name: 'Saved downloads', exact: true }).click();
	await expect(shelf.getByText('old saved', { exact: true })).toBeVisible();
});

test('saved audio keeps viewed timed lyrics usable after restarting in airplane mode', async ({
	page
}) => {
	const env = await fixture(page);
	let reads = 0;
	await page.route(server + '/api/v3/library/tracks/t0/lyrics', async (route) => {
		reads++;
		await route.fulfill({
			json: {
				text: 'The lights come on\nWe pass the harbour',
				is_synced: true,
				lines: [
					{ start_seconds: 0, text: 'The lights come on' },
					{ start_seconds: 6, text: 'We pass the harbour' }
				]
			}
		});
	});
	const b = (name: string) => page.getByRole('button', { name, exact: true });
	const lyrics = page.locator('[data-part=lyrics]');
	await login(page);
	await album(page);
	await b('Album actions').click();
	await page.getByRole('dialog').getByRole('button', { name: 'Save offline', exact: true }).click();
	await expect(page.getByText('2 songs saved offline.', { exact: true })).toBeAttached();
	await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
	await b('Play album').click();
	await b('Pause').click();
	await b('Lyrics').click();
	await expect(b('Seek to lyric We pass the harbour')).toBeVisible();
	expect(reads).toBe(1);
	await login(page);
	await offline(page);
	await env.disconnect();
	await page
		.getByRole('region', { name: 'Offline music' })
		.getByRole('button', { name: /^Held over/ })
		.click();
	await b('Pause').click();
	await b('Lyrics').click();
	await b('Seek to lyric We pass the harbour').click();
	await expect(page.getByRole('slider', { name: 'Playback position' })).toHaveValue('6');
	await expect(lyrics.locator('[aria-current=true]')).toHaveText('We pass the harbour');
	expect(reads).toBe(1);
});
