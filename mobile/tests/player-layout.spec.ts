import { expect, test, type Page } from '@playwright/test';
const server = 'https://layout.example/dn';
const otherServer = 'https://layout.example/elsewhere';
const songs = ['Night Train', 'Day Train'];
function audio() {
	const samples = 8000 * 60;
	const data = Buffer.alloc(44 + samples * 2);
	data.write('RIFF');
	data.writeUInt32LE(data.length - 8, 4);
	data.write('WAVEfmt ', 8);
	data.writeUInt32LE(16, 16);
	data.writeUInt16LE(1, 20);
	data.writeUInt16LE(1, 22);
	data.writeUInt32LE(8000, 24);
	data.writeUInt32LE(16000, 28);
	data.writeUInt16LE(2, 32);
	data.writeUInt16LE(16, 34);
	data.write('data', 36);
	data.writeUInt32LE(samples * 2, 40);
	return data;
}
async function fixture(page: Page) {
	const wav = audio(),
		ratings: Record<string, number> = {},
		favorites: Record<string, boolean> = {},
		lookups: string[] = [];
	const playlistPosts: string[][] = [];
	let user = 'alex';
	let savedIds: string[] = [];
	const playlist = { id: 'road', name: 'Road', can_edit: true, is_owner: true, song_count: 0 };
	await page.route('https://layout.example/**/api/v3/**', async (route) => {
		const req = route.request(),
			url = new URL(req.url()),
			path = url.pathname.split('/api/v3')[1];
		const json = (data: unknown) => route.fulfill({ json: data });
		if (path === '/auth/providers') return json({ local: true, oidc: false });
		if (path === '/auth/login') {
			user = req.postDataJSON().username;
			return json({ token: 'fixture-' + user });
		}
		expect(req.headers().authorization).toBe('Bearer fixture-' + user);
		if (path === '/me') return json({ id: user, display_name: 'Listener', role: 'user' });
		if (path === '/home') return json({ sections: [] });
		if (path === '/me/section-prefs') return json({ pages: { home: [], discover: [] } });
		if (path === '/library/albums')
			return json({
				items: [{ id: 'record', title: 'Railway', artist_name: 'The Lines', art_missing: true }],
				next: null
			});
		const rows = songs.map((title, i) => ({
			id: 't' + i,
			title,
			artist_name: 'The Lines',
			album_id: 'record',
			album_title: 'Railway',
			track_number: i + 1,
			disc_number: 1,
			duration_seconds: 60,
			art_missing: true,
			favorite: !!favorites['t' + i],
			format: 'flac',
			sample_rate: 44100,
			bit_depth: 16
		}));
		if (path === '/library/albums/match/record') return json({ items: rows, total: 2 });
		if (path === '/library/tracks') {
			lookups.push(url.searchParams.get('q') || '');
			return json({
				items: rows.filter((row) => row.title === url.searchParams.get('q')),
				next: null
			});
		}
		if (path === '/ratings/lookup') return json({ tracks: ratings, artists: {}, albums: {} });
		if (path.startsWith('/ratings/track/')) {
			expect(req.method()).toBe('PUT');
			const id = path.split('/').at(-1)!;
			ratings[id] = req.postDataJSON().rating;
			return json({ item_id: id, kind: 'track', rating: ratings[id] });
		}
		if (path.startsWith('/favorites/track/')) {
			const id = path.split('/').at(-1)!;
			favorites[id] = req.postDataJSON().favorited;
			return json({ favorited: favorites[id] });
		}
		if (path.endsWith('/lyrics'))
			return json({
				is_synced: true,
				lines: [
					{ start_seconds: 0, text: 'First line' },
					{ start_seconds: 32, text: 'At the station' }
				]
			});
		if (path === '/playlists') return json({ playlists: [playlist] });
		if (path === '/playlists/road' && req.method() === 'GET')
			return json({
				...playlist,
				tracks: savedIds.map((id) => ({ source: 'local', source_id: id }))
			});
		if (path === '/playlists/road/tracks') {
			const body = req.postDataJSON();
			savedIds = body.tracks.map((t: { track_source_id: string }) => t.track_source_id);
			playlistPosts.push(savedIds);
			return json({ tracks: body.tracks });
		}
		if (path.startsWith('/stream/local/'))
			return route.fulfill({ body: wav, contentType: 'audio/wav' });
		throw Error('Unexpected ' + req.method() + ' ' + path);
	});
	return { ratings, favorites, lookups, playlistPosts };
}
async function play(page: Page, user = 'alex', address = server) {
	await page.goto('/');
	await page.getByLabel('Server address').fill(address);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill(user);
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page
		.getByRole('button', { name: /Railway/ })
		.first()
		.click();
	await page.getByRole('button', { name: 'Play album' }).click();
	await expect(page.getByRole('heading', { name: 'Night Train' })).toBeVisible();
	await page
		.locator('[data-part=transport]')
		.getByRole('button', { name: 'Pause', exact: true })
		.click();
}

test('a listener saves, cancels and restores the Now Playing layout independently for each account and server', async ({
	page
}) => {
	await fixture(page);
	await play(page);
	const playing = page.getByRole('region', { name: 'Now playing' });
	async function edit() {
		await playing.getByRole('button', { name: 'Player settings' }).click();
		await expect(page.getByRole('heading', { name: 'Edit Now Playing' })).toBeVisible();
	}
	async function returnToPlayer() {
		const settings = page.getByRole('heading', { name: 'Settings', exact: true });
		// Saving from the player shortcut may lead through Settings before returning to the player.
		if (await settings.isVisible())
			await page.getByRole('button', { name: 'Back', exact: true }).click();
		await expect(playing).toBeVisible();
	}
	await edit();
	await page.getByRole('button', { name: 'Remove Artwork' }).click();
	await page.getByRole('button', { name: 'Customize Track details' }).click();
	await page.getByLabel('Section title').fill('On the turntable');
	await page.getByLabel('Show album title').uncheck();
	await page.getByRole('button', { name: 'Add Up next' }).click();
	await page.getByRole('combobox', { name: 'Position', exact: true }).selectOption('0');
	await page.getByRole('button', { name: 'Save layout' }).click();
	await returnToPlayer();
	await expect(playing.locator('[data-section-id]').first()).toHaveAttribute(
		'data-section-id',
		'player-up-next'
	);
	await expect(playing.getByRole('heading', { name: 'On the turntable' })).toBeVisible();
	await expect(playing.getByText('Railway', { exact: true })).toHaveCount(0);
	await expect(playing.locator('[data-section-id=player-artwork]')).toHaveCount(0);
	await edit();
	await page.getByRole('button', { name: 'Restore default layout' }).click();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await returnToPlayer();
	await expect(playing.locator('[data-section-id=player-artwork]')).toHaveCount(0);
	await play(page, 'sam');
	await expect(playing.locator('[data-section-id=player-artwork]')).toBeVisible();
	await play(page, 'alex', otherServer);
	await expect(playing.locator('[data-section-id=player-artwork]')).toBeVisible();
	await play(page, 'alex');
	await expect(playing.getByRole('heading', { name: 'On the turntable' })).toBeVisible();
	await edit();
	const remove = page.getByRole('button', { name: /^Remove / });
	while (await remove.count()) await remove.first().click();
	await page.getByRole('button', { name: 'Save layout' }).click();
	await returnToPlayer();
	await expect(playing.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await expect(playing.getByRole('button', { name: 'Show play queue' })).toBeVisible();
	await edit();
	await page.getByRole('button', { name: 'Restore default layout' }).click();
	await page.getByRole('button', { name: 'Save layout' }).click();
	await returnToPlayer();
	await expect(playing.locator('[data-section-id=player-artwork]')).toBeVisible();
});

test('current track tools rate, favorite and inspect DN audio and save songs while synced lyrics seek within the track', async ({
	page
}) => {
	const calls = await fixture(page);
	await play(page);
	expect(calls.lookups).toEqual([]);
	await page.getByText('Track tools', { exact: true }).click();
	await expect(page.getByText('FLAC · 16-bit · 44.1 kHz')).toBeVisible();
	await page.getByRole('button', { name: 'Favorite track', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Remove track from favorites' })).toBeVisible();
	await page.getByRole('button', { name: 'Rate 4 stars' }).click();
	await expect(page.getByRole('button', { name: 'Rate 4 stars' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect(calls.ratings).toEqual({ t0: 4 });
	expect(calls.favorites).toEqual({ t0: true });
	await page.getByRole('button', { name: 'Clear rating' }).click();
	await expect.poll(() => calls.ratings.t0).toBe(0);
	await page.getByText('Lyrics', { exact: true }).click();
	await page.getByRole('button', { name: 'Seek to lyric At the station' }).click();
	await expect(page.getByRole('slider', { name: 'Playback position' })).toHaveValue('32');
	expect(calls.lookups).toEqual(['Night Train']);
	await page.getByRole('button', { name: 'Add to playlist', exact: true }).click();
	let dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Add track', exact: true }).click();
	await expect(dialog.getByText('Added 1 track to Road.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await page.getByRole('button', { name: 'Show play queue' }).click();
	await page.getByRole('button', { name: 'Edit queue' }).click();
	await page.getByRole('button', { name: 'Save queue to playlist' }).click();
	dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Add 2 tracks' }).click();
	await expect(dialog.getByText('Added 2 tracks to Road.')).toBeVisible();
	expect(calls.playlistPosts).toEqual([['t0'], ['t0', 't1']]);
});
