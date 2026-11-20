import { verticalSwipe } from './fixtures/verticalSwipe';
import { seedOfflineMusic } from './fixtures/offlineMusic';
import { silentWav } from './fixtures/silentWav';
import { openPlayerPlacement } from './fixtures/playerEditor';
import { localSignIn } from './fixtures/localSignIn';
import { expect, test, type Page } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
const server = 'https://layout.example/dn';
const otherServer = 'https://layout.example/elsewhere';
const songs = ['Night Train', 'Day Train'];
async function fixture(page: Page) {
	const wav = silentWav(),
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
			bit_rate: 1021,
			file_size_bytes: 3145728,
			channels: 2,
			genre: 'Jazz',
			year: 1987,
			sample_rate: 44100,
			bit_depth: 16
		}));
		if (path === '/library/albums/match/record') return json({ items: rows, total: 2 });
		if (path === '/library/tracks') {
			if (url.searchParams.has('q')) lookups.push(url.searchParams.get('q')!);
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
		if (await emptyBoardRead(route)) return;
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

async function addFeature(page: Page, name: string) {
	await page.getByRole('button', { name: 'Add row', exact: true }).click();
	await page
		.getByRole('button', { name: /^Add feature to row [0-9]+, column 1$/ })
		.last()
		.click();
	await page.getByRole('button', { name: 'Use ' + name, exact: true }).click();
}
test('timed lyrics follow playback inside their panel and let listeners read ahead until they resume', async ({
	page
}) => {
	await page.setViewportSize({ width: 360, height: 720 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await fixture(page);
	await page.route('**/api/v3/library/tracks/*/lyrics', (route) =>
		route.fulfill({
			json: {
				is_synced: true,
				lines: Array.from({ length: 60 }, (_, i) => ({
					start_seconds: i,
					text: 'Line ' + i
				}))
			}
		})
	);
	await play(page);
	const lyrics = page.locator('[data-part=lyrics]');
	await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
	const lines = lyrics.getByRole('region', { name: 'Timed lyrics' });
	await expect(lines).toBeVisible();
	const seek = page.getByRole('slider', { name: 'Playback position' });
	await seek.fill('28');
	const centerError = () =>
		lines.evaluate((box) => {
			const line = box.querySelector('[aria-current=true]')!;
			const row = line.getBoundingClientRect(),
				panel = box.getBoundingClientRect();
			return Math.abs(row.top + row.height / 2 - panel.top - panel.height / 2);
		});
	await expect(lines.locator('[aria-current=true]')).toHaveText('Line 28');
	await expect.poll(centerError).toBeLessThan(3);
	await lines.hover();
	await page.mouse.wheel(0, 160);
	const resume = lyrics.getByRole('button', { name: 'Follow current line' });
	await expect(resume).toBeVisible();
	await seek.fill('43');
	await expect(lines.locator('[aria-current=true]')).toHaveText('Line 43');
	await expect.poll(centerError).toBeGreaterThan(80);
	await resume.click();
	await expect(resume).toBeHidden();
	await expect.poll(centerError).toBeLessThan(3);
	const next = lines.getByRole('button', {
		name: 'Seek to lyric Line 45',
		exact: true
	});
	await next.click();
	await expect(lines.locator('[aria-current=true]')).toHaveText('Line 45');
	await expect.poll(centerError).toBeLessThan(3);
});

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
	await edit();
	await page.getByRole('button', { name: 'Customize Artwork', exact: true }).click();
	await page.getByRole('button', { name: 'Remove Artwork' }).click();
	await page.getByRole('button', { name: 'Customize Track title' }).click();
	await openPlayerPlacement(page);
	await page.getByLabel('Section title').fill('On the turntable');
	await page.getByRole('button', { name: 'Customize Album', exact: true }).click();
	await page.getByRole('button', { name: 'Remove Album', exact: true }).click();
	await addFeature(page, 'Up next');
	await page.getByRole('button', { name: 'Customize Up next' }).click();
	await openPlayerPlacement(page);
	await page.getByRole('combobox', { name: 'Position', exact: true }).selectOption('0');
	await page.getByRole('button', { name: 'Save layout' }).click();
	await expect(playing).toBeVisible();
	await expect(playing.locator('[data-part=player-row] [data-section-id]').first()).toHaveAttribute(
		'data-section-id',
		'player-up-next'
	);
	await expect(playing.getByRole('heading', { name: 'On the turntable' })).toBeVisible();
	await expect(playing.getByText('Railway', { exact: true })).toHaveCount(0);
	await expect(playing.locator('[data-section-id=player-artwork]')).toHaveCount(0);
	await edit();
	await page.getByRole('button', { name: 'Restore default layout' }).click();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(playing).toBeVisible();
	await expect(playing.locator('[data-section-id=player-artwork]')).toHaveCount(0);
	await play(page, 'sam');
	await expect(playing.locator('[data-section-id=player-artwork]')).toBeVisible();
	await play(page, 'alex', otherServer);
	await expect(playing.locator('[data-section-id=player-artwork]')).toBeVisible();
	await play(page, 'alex');
	await expect(playing.getByRole('heading', { name: 'On the turntable' })).toBeVisible();
	await edit();
	const fields = page.locator('.canvas [data-player-row] [data-section-id] button.field');
	await expect(fields.first()).toBeVisible();
	while (await fields.count()) {
		await fields.last().click();
		await page.getByRole('button', { name: /^Remove / }).click();
	}
	await page.getByRole('button', { name: 'Save layout' }).click();
	await expect(playing).toBeVisible();
	await expect(playing.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await expect(playing.getByRole('button', { name: 'Show play queue' })).toBeVisible();
	await edit();
	await page.getByRole('button', { name: 'Restore default layout' }).click();
	await page.getByRole('button', { name: 'Save layout' }).click();
	await expect(playing).toBeVisible();
	await expect(playing.locator('[data-section-id=player-artwork]')).toBeVisible();
});

test('current track tools rate, favorite and inspect DN audio and save songs while synced lyrics seek within the track', async ({
	page
}) => {
	const calls = await fixture(page);
	await play(page);
	expect(calls.lookups).toEqual([]);
	await page.getByRole('button', { name: 'Track details for Night Train' }).click();
	const format = page
		.getByRole('dialog', { name: 'Track details' })
		.getByRole('region', { name: 'Format' });
	await expect(format.getByText('FLAC', { exact: true })).toBeVisible();
	await expect(format.getByText('16-bit', { exact: true })).toBeVisible();
	await expect(format.getByText('44.1 kHz', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Close Track details' }).click();
	await page.getByRole('button', { name: 'More actions', exact: true }).click();
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
	await page.getByRole('button', { name: 'Close More actions' }).click();
	await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
	await page.getByRole('button', { name: 'Seek to lyric At the station' }).click();
	await expect(page.getByRole('slider', { name: 'Playback position' })).toHaveValue('32');
	expect(calls.lookups).toEqual(['Night Train', 'Night Train']);
	await page.getByRole('button', { name: 'More actions', exact: true }).click();
	await page.getByRole('button', { name: 'Add to playlist', exact: true }).click();
	let dialog = page.getByRole('dialog').last();
	await dialog.getByRole('button', { name: 'Add track', exact: true }).click();
	await expect(dialog.getByText('Added 1 track to Road.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await page.getByRole('button', { name: 'Close More actions' }).click();
	await page.getByRole('button', { name: 'Show play queue' }).click();
	await page.getByRole('button', { name: 'Edit queue' }).click();
	await page.getByRole('button', { name: 'Save queue to playlist' }).click();
	dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Add 2 tracks' }).click();
	await expect(dialog.getByText('Added 2 tracks to Road.')).toBeVisible();
	expect(calls.playlistPosts).toEqual([['t0'], ['t0', 't1']]);
	await dialog.getByRole('button', { name: 'Done' }).click();
	await page.getByRole('button', { name: 'Clear upcoming' }).click();
	await expect(page.locator('[data-part=play-queue] li')).toHaveCount(1);
	await expect(page.locator('[data-part=play-queue] [aria-current=true]')).toContainText(
		'Night Train'
	);
	await page.getByRole('button', { name: 'Hide play queue' }).click();
	await expect(page.getByRole('slider', { name: 'Playback position' })).toHaveValue('32');
	await expect(
		page.locator('[data-part=transport]').getByRole('button', { name: 'Play', exact: true })
	).toBeVisible();
});

test('a listener arranges independent player fields in columns and saves a live text template', async ({
	page
}) => {
	await fixture(page);
	await play(page);
	const player = page.getByRole('region', { name: 'Now playing' });
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	await player.getByRole('button', { name: 'Player settings' }).click();
	const edit = async (name: string) => {
		const toggle = button('Customize ' + name);
		if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
	};
	const rowIndex = async (id: string) =>
		page
			.locator('[data-player-row]')
			.evaluateAll(
				(rows, id) => rows.findIndex((row) => row.querySelector('[data-section-id="' + id + '"]')),
				id
			);
	await edit('Artist');
	const titleRow = await rowIndex('player-title');
	expect(titleRow).toBeGreaterThanOrEqual(0);
	await openPlayerPlacement(page);
	await page
		.getByRole('combobox', { name: 'Move to row', exact: true })
		.selectOption(String(titleRow));
	await edit('Artist');
	await openPlayerPlacement(page);
	await button('Move Artist left').click();
	await edit('Track title');
	await expect(page.getByRole('combobox', { name: 'Column width', exact: true })).toHaveCount(0);
	await page
		.getByRole('combobox', { name: 'Horizontal alignment', exact: true })
		.selectOption('end');
	await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('large');
	await button('Edit row ' + ((await rowIndex('player-title')) + 1)).click();
	await page.getByRole('slider', { name: 'Column 2 width' }).fill('2');
	await button('Finish editing row').click();
	await addFeature(page, 'Custom text');
	await edit('Custom text');
	await page
		.getByLabel('Text template', { exact: true })
		.fill('{position}/{count} · {title} — {duration}');
	await button('Save layout').click();
	await expect(player).toBeVisible();
	const artist = player.locator('[data-section-id="player-artist"]'),
		title = player.locator('[data-section-id="player-title"]');
	await expect(artist).toHaveText('The Lines');
	await expect(title).toHaveText('Night Train');
	const row = player
		.locator('[data-part="player-row"]')
		.filter({ has: page.locator('[data-section-id="player-title"]') });
	await expect(row.locator('[data-section-id]')).toHaveCount(2);
	const a = await artist.boundingBox(),
		b = await title.boundingBox();
	expect(a!.x).toBeLessThan(b!.x);
	expect(Math.abs(a!.y - b!.y)).toBeLessThan(20);
	expect(b!.width).toBeGreaterThan(a!.width * 1.6);
	await expect(player.getByText('1/2 · Night Train — 1:00', { exact: true })).toBeVisible();
	await player.getByRole('button', { name: 'Next track', exact: true }).click();
	await expect(player.getByText('2/2 · Day Train — 1:00', { exact: true })).toBeVisible();
	await page.setViewportSize({ width: 320, height: 694 });
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth))
		.toBeLessThanOrEqual(320);
	await player.getByRole('button', { name: 'Player settings' }).click();
	await edit('Artist');
	await openPlayerPlacement(page);
	await page.getByRole('combobox', { name: 'Move to row', exact: true }).selectOption('new');
	await button('Cancel').click();
	await expect(player).toBeVisible();
	await expect(row.locator('[data-section-id]')).toHaveCount(2);
});

test('older vertical layouts retain their settings and individual transport buttons remain usable in a narrow row', async ({
	page
}) => {
	await fixture(page);
	const legacy = [
		{ id: 'player-track', title: 'Record sleeve', preview: false },
		{ id: 'player-transport', title: '', preview: true },
		{ id: 'player-timeline', title: '', preview: true }
	];
	await page.addInitScript(
		({ server, legacy }) => {
			const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'alex', 'player']);
			if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(legacy));
		},
		{ server, legacy }
	);
	await play(page);
	const player = page.getByRole('region', { name: 'Now playing' });
	await expect(player.locator('[data-part=player-row]')).toHaveCount(3);
	await expect(player.getByRole('heading', { name: 'Record sleeve' })).toBeVisible();
	await expect(player.locator('[data-section-id=player-track]')).not.toContainText('Railway');
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	await button('Player settings').click();
	await button('Customize Playback controls').click();
	await button('Split Playback controls').click();
	await button('Save layout').click();
	await expect(player).toBeVisible();
	await page.setViewportSize({ width: 320, height: 694 });
	const controls = player
		.locator('[data-part=player-row]')
		.filter({ has: page.locator('[data-section-id=player-toggle]') });
	const playButton = controls.getByRole('button', { name: 'Play', exact: true });
	const previous = controls.getByRole('button', { name: 'Previous track' }),
		next = controls.getByRole('button', { name: 'Next track' });
	for (const control of [previous, playButton, next]) {
		const rect = await control.boundingBox();
		expect(rect!.width).toBeGreaterThanOrEqual(44);
		expect(rect!.height).toBeGreaterThanOrEqual(44);
	}
	await playButton.click();
	await expect(controls.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await next.click();
	await expect(player.getByRole('heading', { name: 'Day Train' })).toBeVisible();
});

test('independent queue, favorite and playlist fields control the current DN track with the header close action hidden', async ({
	page
}) => {
	const calls = await fixture(page);
	await play(page);
	const region = page.locator('[data-part=now-playing]'),
		button = (name: string) => page.getByRole('button', { name, exact: true });
	await region.getByRole('button', { name: 'Player settings' }).click();
	for (const name of ['Favorite', 'Add to playlist', 'Offline download', 'Track rating'])
		await addFeature(page, name);
	await button('Customize Playback position').click();
	await button('Split Playback position').click();
	await button('Customize Play queue').click();
	await openPlayerPlacement(page);
	await page.getByLabel('Move to row', { exact: true }).selectOption('new');
	await button('Customize Close player').click();
	await button('Remove Close player').click();
	await button('Save layout').click();
	await expect(region.locator('[data-section-id=player-quality]')).toHaveText(
		'Lossless · PCM · 16-bit · 8 kHz · 128 kbps'
	);
	const download = region.locator('[data-section-id=player-download]');
	await download.getByRole('button', { name: 'Save offline', exact: true }).click();
	await expect(download.getByRole('button', { name: 'Manage track download' })).toHaveText(
		'Downloaded'
	);
	await region
		.locator('[data-section-id=player-rating]')
		.getByRole('button', { name: 'Rate 3 stars' })
		.click();
	await expect.poll(() => calls.ratings.t0).toBe(3);
	await expect(region.locator('[data-section-id=player-seek]').getByRole('slider')).toBeVisible();
	await expect(region.locator('[data-section-id=player-duration]')).toHaveText('1:00');
	const fav = region.locator('[data-section-id=player-favorite]');
	await fav.getByRole('button', { name: 'Favorite track' }).click();
	await expect(fav.getByRole('button', { name: 'Remove track from favorites' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect(calls.favorites.t0).toBe(true);
	await region
		.locator('[data-section-id=player-playlist]')
		.getByRole('button', { name: 'Add to playlist' })
		.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Add track', exact: true }).click();
	await expect(dialog.getByText('Added 1 track to Road.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await region
		.locator('[data-section-id=player-queue]')
		.getByRole('button', { name: 'Show play queue' })
		.click();
	await expect(region.getByRole('heading', { name: 'Play queue' })).toBeVisible();
	await region.getByRole('button', { name: 'Hide play queue' }).click();
	await expect(region.getByRole('button', { name: 'Player menu' })).toHaveCount(0);
	await region.getByRole('button', { name: 'Close player' }).click();
	await expect(page.locator('[data-part=mini-player]')).toBeVisible();
});

test('Android Back discards a sample layout and returns to the empty player from either entry point', async ({
	page
}) => {
	await fixture(page);
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('alex');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Edit Now Playing layout' }).click();
	const player = page.getByRole('region', { name: 'Now playing', exact: true });
	await page.getByRole('button', { name: 'Customize Artwork', exact: true }).click();
	await page.getByRole('button', { name: 'Remove Artwork', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect(player.getByRole('heading', { name: 'Nothing playing' })).toBeVisible();
	await player.getByRole('button', { name: 'Player settings' }).click();
	await expect(page.getByRole('button', { name: 'Customize Artwork', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(player.getByRole('heading', { name: 'Nothing playing' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
});

test('a resized control grows its face and keeps its custom label above or below in preview and playback', async ({
	page
}) => {
	await fixture(page);
	await play(page);
	const b = (name: string) => page.getByRole('button', { name, exact: true });
	const originalViewport = (await page.locator('[data-part=now-playing]').boundingBox())!;
	await b('Player settings').click();
	await b('Customize Playback controls').click();
	await b('Split Playback controls').click();
	await b('Customize Play or pause').click();
	const sample = page.locator('[data-part=sample-player]'),
		cell = sample.locator('[data-section-id=player-toggle]');
	const viewport = (await sample.boundingBox())!;
	expect(Math.abs(viewport.height - originalViewport.height)).toBeLessThan(1);
	expect(Math.abs(viewport.width - originalViewport.width)).toBeLessThan(1);
	const before = (await cell.locator('.glyph').boundingBox())!.height;
	await page.getByLabel('Label', { exact: true }).selectOption('show');
	await page.getByLabel('Label name').fill('Listen');
	await page.getByLabel('Label position').selectOption('above');
	await openPlayerPlacement(page);
	await page.getByLabel('Minimum row height', { exact: true }).fill('96');
	await expect(cell.locator('.caption')).toHaveText('Listen');
	expect((await cell.locator('.glyph').boundingBox())!.height).toBeGreaterThan(before);
	const fillsRow = async (element: typeof cell) => {
		const size = await element.locator('button.play').evaluate((el) => {
			const box = el.getBoundingClientRect(),
				cell = el.closest('[data-section-id]')!.getBoundingClientRect();
			const fit = Number(getComputedStyle(el).getPropertyValue('--player-fit')) || 1;
			return {
				width: box.width / fit,
				height: box.height / fit,
				max: Math.min(96, cell.width / fit)
			};
		});
		expect(Math.abs(size.max - size.width)).toBeLessThan(1);
		expect(Math.abs(size.max - size.height)).toBeLessThan(1);
	};
	await fillsRow(cell);
	await b('Save layout').click();
	const live = page.locator('[data-part=now-playing] [data-section-id=player-toggle]');
	await expect(live.locator('.caption')).toHaveText('Listen');
	await expect(live.locator('.face')).toHaveAttribute('data-label-position', 'above');
	await fillsRow(live);
	await expect(live.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});
test('an older header becomes an editable grid with square controls on the header, in a body row and in the queue', async ({
	page
}) => {
	const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'alex', 'player']);
	await page.addInitScript(
		({ key }) => {
			if (localStorage.getItem(key)) return;
			const fields = [
				{ id: 'player-track' },
				{ id: 'player-transport' },
				{ id: 'player-close', placement: 'header-end', icon: 'circle-play', iconSize: 32 },
				{ id: 'player-queue', placement: 'header-start', icon: 'square-play', iconSize: 36 },
				{ id: 'player-output', placement: 'hidden' }
			];
			localStorage.setItem(
				key,
				JSON.stringify(fields.map((s) => ({ title: '', preview: true, ...s })))
			);
		},
		{ key }
	);
	await page.setViewportSize({ width: 320, height: 720 });
	await fixture(page);
	await play(page);
	const live = page.locator('[data-part=now-playing]'),
		sample = page.locator('[data-part=sample-player]'),
		button = (name: string) => page.getByRole('button', { name, exact: true });
	const ids = (where: typeof live) =>
		where
			.locator('header [data-section-id]')
			.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-section-id')));
	const geometry = async (where: typeof live, id: string, size: number) => {
		const field = where.locator('[data-section-id="' + id + '"]');
		const boxes = await field
			.locator('.content .icon-button, .content .glyph > svg')
			.evaluateAll((nodes) =>
				nodes.map((n) => {
					const box = n.getBoundingClientRect();
					return { w: box.width, h: box.height };
				})
			);
		expect(boxes).toHaveLength(2);
		for (const box of boxes) expect(Math.abs(box.w - box.h)).toBeLessThan(1);
		expect(boxes[0].w).toBeGreaterThanOrEqual(44);
		expect(boxes[1].w).toBeGreaterThanOrEqual(size - 0.5);
		expect(boxes[1].w).toBeLessThanOrEqual(boxes[0].w + 0.5);
	};
	const order = ['player-queue', 'player-heading', 'player-close', 'player-settings'];
	expect(await ids(live)).toEqual(order);
	await geometry(live, 'player-close', 32);
	await geometry(live, 'player-queue', 36);
	await button('Player settings').click();
	await expect(sample).toBeVisible();
	expect(await ids(sample)).toEqual(order);
	await geometry(sample, 'player-queue', 36);
	await button('Edit header').click();
	const panel = page.getByRole('group', { name: 'Edit header', exact: true });
	await panel.getByLabel('Number of columns').selectOption('5');
	await panel.getByLabel('Column spacing (px)').fill('4');
	await panel.getByLabel('Minimum row height').fill('72');
	await panel.getByLabel('Column 2 width').fill('4');
	const empty = button('Open column 5, Empty column');
	await empty.click();
	await expect(page.getByRole('group', { name: 'Choose a player feature' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(empty).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(button('Edit header')).toBeFocused();
	await button('Add feature to header, column 5').click();
	await button('Use Remaining time').click();
	await button('Customize Close player').click();
	await openPlayerPlacement(page);
	await page.getByLabel('Move to row', { exact: true }).selectOption('new');
	await geometry(sample, 'player-close', 32);
	await button('Save layout').click();
	expect(await ids(live)).toEqual([
		'player-queue',
		'player-heading',
		'player-settings',
		'player-remaining'
	]);
	await geometry(live, 'player-close', 32);
	await geometry(live, 'player-queue', 36);
	const grid = live.locator('[data-part=player-header-row]');
	expect(
		await grid
			.locator(':scope [data-section-id]')
			.evaluateAll(
				(nodes) => nodes[1].getBoundingClientRect().left - nodes[0].getBoundingClientRect().right
			)
	).toBeCloseTo(4, 0);
	await expect(grid).toHaveCSS('min-height', '72px');
	await button('Show play queue').click();
	await expect(live.getByRole('heading', { name: 'Play queue' })).toBeVisible();
	await expect(grid.locator('[data-section-id=player-remaining]')).toBeVisible();
	await geometry(live, 'player-queue', 36);
	await button('Hide play queue').click();
	await geometry(live, 'player-close', 32);
	const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
	expect(stored.find((s: { id: string }) => s.id === 'player-output')).toMatchObject({
		placement: 'hidden'
	});
	expect(stored.find((s: { id: string }) => s.id === 'player-close')).toMatchObject({
		icon: 'circle-play',
		iconSize: 32
	});
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the waveform measures the playing file and its time labels can be chosen independently', async ({
	page
}) => {
	await fixture(page);
	await page.addInitScript((address) => {
		const sections = [
			{ id: 'player-track' },
			{ id: 'player-transport' },
			{
				id: 'player-timeline',
				seekStyle: 'waveform',
				showElapsed: false,
				showRemaining: true,
				showDuration: true
			},
			{ id: 'player-quality' }
		].map((s) => ({ title: '', preview: true, ...s }));
		localStorage.setItem(
			'dn.mobile.layout.v1.' + JSON.stringify([address, 'alex', 'player']),
			JSON.stringify(sections)
		);
	}, server);
	const audio = silentWav(8);
	// Four seconds of digital silence followed by four seconds of a 400 Hz tone.
	for (let i = 32000; i < 64000; i++)
		audio.writeInt16LE(Math.round(16000 * Math.sin((i * Math.PI) / 10)), 44 + i * 2);
	let reads = 0;
	await page.route('**/api/v3/stream/local/**', (route) => {
		reads++;
		return route.fulfill({ body: audio, contentType: 'audio/wav' });
	});
	await play(page);
	const region = page.locator('[data-part=now-playing]'),
		bar = region.locator('[data-part=playback-bar]');
	await expect(bar).toHaveAttribute('data-seek-style', 'waveform');
	const path = bar.locator('defs path');
	await expect(path).toHaveCount(1);
	const heights = Array.from((await path.getAttribute('d'))!.matchAll(/v([\d.]+)/g), (match) =>
		Number(match[1])
	);
	expect(heights).toHaveLength(112);
	expect(Math.max(...heights.slice(0, 50))).toBeLessThan(2);
	expect(Math.min(...heights.slice(60, 105))).toBeGreaterThan(18);
	expect(reads).toBe(1);
	await expect(region.locator('[data-part=audio-quality]')).toContainText('PCM · 16-bit · 8 kHz');
	await expect(bar.getByLabel('Elapsed time')).toHaveCount(0);
	await expect(bar.getByLabel('Track length')).toHaveText('0:08');
	await bar.getByRole('slider').fill('3');
	await expect(bar.getByLabel('Time remaining')).toHaveText('−0:05');
});

test('a counted sleep timer advances once per natural ending and finish-last lets the current song play out', async ({
	page
}) => {
	await fixture(page);
	await play(page);
	const live = page.locator('[data-part=now-playing]');
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	await button('Sleep timer').click();
	const ruler = page.getByRole('slider', { name: 'Timer duration' });
	await ruler.focus();
	await ruler.press('ArrowRight');
	await expect(page.getByLabel('Minutes', { exact: true })).toHaveValue('16');
	await ruler.hover();
	const scale = (await ruler.boundingBox())!;
	await page.mouse.move(scale.x + scale.width / 2, scale.y + scale.height / 2);
	await page.mouse.down();
	await page.mouse.move(scale.x + scale.width / 2 - 42, scale.y + scale.height / 2, { steps: 6 });
	await page.mouse.up();
	await expect(page.getByLabel('Minutes', { exact: true })).toHaveValue('19');
	await button('Tracks').click();
	await page.getByLabel('Number of tracks', { exact: true }).fill('2');
	await button('Start timer').click();
	await button('Play').click();
	await live.getByRole('slider', { name: 'Playback position' }).fill('59.5');
	await expect(live.getByRole('heading', { name: 'Day Train' })).toBeVisible();
	await expect(button('Sleep timer')).toContainText('End of track');
	await live.getByRole('slider', { name: 'Playback position' }).fill('59.5');
	await expect(live.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await button('Sleep timer').click();
	await expect(page.getByText('The sleep timer is off.')).toBeVisible();
	await button('Duration').click();
	await page.getByLabel('Minutes', { exact: true }).fill('1');
	await page.getByRole('switch', { name: 'Finish last track' }).check();
	await page.clock.install();
	await button('Start timer').click();
	await button('Play').click();
	await expect(live.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await page.clock.fastForward(60_001);
	await expect(button('Sleep timer')).toContainText('End of track');
	await expect(live.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await live.getByRole('slider', { name: 'Playback position' }).fill('59.5');
	await expect(live.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await expect(live.getByRole('heading', { name: 'Day Train' })).toBeVisible();
});

test('sleep timers pause the browser queue at a wall-clock deadline and before an automatic repeat or next track', async ({
	page
}) => {
	await fixture(page);
	await play(page);
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	const live = page.locator('[data-part=now-playing]');
	await button('Sleep timer').click();
	await page.getByLabel('Minutes', { exact: true }).fill('1');
	await page.clock.install();
	await button('Start timer').click();
	await live.getByRole('button', { name: 'Play', exact: true }).click();
	await button('Close player').click();
	await page.clock.fastForward(60_001);
	await expect(
		page.locator('[data-part=mini-player]').getByRole('button', { name: 'Play', exact: true })
	).toBeVisible();
	await button('Open player for Night Train').click();
	await button('Sleep timer').click();
	await expect(
		page.getByRole('status').filter({ hasText: 'The sleep timer is off.' })
	).toBeVisible();
	await button('Tracks').click();
	await button('Start timer').click();
	await expect(button('Sleep timer')).toContainText('End of track');
	await live.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('slider', { name: 'Playback position' }).fill('59');
	await expect(live.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
		timeout: 10000
	});
	await expect(live.getByRole('heading', { name: 'Night Train' })).toBeVisible();
	await button('Sleep timer').click();
	await button('Tracks').click();
	await button('Start timer').click();
	await button('Next track').click();
	await expect(live.getByRole('heading', { name: 'Day Train' })).toBeVisible();
	await button('Sleep timer').click();
	await expect(page.getByText('The sleep timer is off.')).toBeVisible();
	await button('Duration').click();
	await page.getByLabel('Minutes', { exact: true }).fill('5');
	await button('Start timer').click();
	await button('Sleep timer').click();
	await button('Cancel timer').click();
	await button('Repeat off. Change repeat mode').click();
	await button('Repeat all. Change repeat mode').click();
	await button('Sleep timer').click();
	await button('Tracks').click();
	await button('Start timer').click();
	await page.getByRole('slider', { name: 'Playback position' }).fill('59');
	await expect(live.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
		timeout: 10000
	});
	await expect(live.getByRole('heading', { name: 'Day Train' })).toBeVisible();
	await button('Sleep timer').click();
	await expect(page.getByText('The sleep timer is off.')).toBeVisible();
});

test('a clean draft preview preserves the inspector and scroll while the real track keeps playing', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 720 });
	await page.addInitScript(() => {
		const Audio = window.Audio;
		window.Audio = new Proxy(Audio, {
			construct(target, args) {
				const el = Reflect.construct(target, args) as HTMLAudioElement;
				Object.assign(window, { fixtureAudio: el });
				return el;
			}
		});
	});
	const streams: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/api/v3/stream/local/')) streams.push(r.url());
	});
	await fixture(page);
	await play(page);
	const b = (name: string) => page.getByRole('button', { name, exact: true });
	const main = page.locator('main'),
		live = page.locator('[data-part=now-playing]');
	await live.getByRole('slider', { name: 'Playback position' }).fill('15');
	await live
		.locator('[data-part=transport]')
		.getByRole('button', { name: 'Play', exact: true })
		.click();
	await b('Player settings').click();
	const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'alex', 'player']);
	const saved = () => page.evaluate((k) => localStorage.getItem(k), key),
		original = await saved();
	const editor = page.locator('[data-part=layout-editor]'),
		preview = b('Preview current draft');
	await b('Add row').click();
	await b('Customize Track title').click();
	await openPlayerPlacement(page);
	await page.getByLabel('Section title').fill('Draft sleeve');
	const scroll = await main.evaluate((el) => el.scrollTop);
	expect(scroll).toBeGreaterThan(50);
	const toolbar = await editor.locator('.bar button:visible').evaluateAll((nodes) =>
		nodes.map((el) => {
			const { x, y, width, height } = el.getBoundingClientRect();
			return { x, y, width, height };
		})
	);
	for (const box of toolbar) {
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(320);
		expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
	}
	await preview.tap();
	const sample = page.getByRole('region', { name: 'Now Playing layout preview' });
	const back = b('Back to editing');
	await expect(back).toBeFocused();
	await expect(editor).toBeHidden();
	await expect(sample.getByRole('heading', { name: 'Draft sleeve' })).toBeVisible();
	await expect(sample.getByRole('heading', { name: 'Track Title' })).toBeVisible();
	await expect(sample.getByRole('img', { name: 'Album artwork' })).toBeVisible();
	await expect(
		sample.locator('[data-layout-drag], .editing-field, .active-field, [data-inspector], .field')
	).toHaveCount(0);
	await expect(sample.locator('[data-slot=true]')).toHaveCount(1);
	await expect(sample.getByRole('button')).toHaveCount(0);
	await expect(sample.getByRole('button', { name: 'Open navigation menu' })).toHaveCount(0);
	await expect(page.locator('.mast')).toBeHidden();
	const title = sample.locator('[data-section-id=player-heading] .lines');
	expect(await title.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
	await page.screenshot({ path: test.info().outputPath('now-playing-draft-preview-320.png') });
	const next = sample.locator('[data-part=transport] button[aria-label="Next track"]');
	await next.scrollIntoViewIfNeeded();
	const box = (await next.boundingBox())!;
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
	await expect(back).toBeInViewport();

	await page.keyboard.press('Escape');
	await expect(preview).toBeFocused();
	await expect(page.getByLabel('Section title')).toHaveValue('Draft sleeve');
	await expect(editor.locator('.canvas details.advanced')).toHaveAttribute('open', '');
	expect(Math.abs((await main.evaluate((el) => el.scrollTop)) - scroll)).toBeLessThan(2);
	await preview.tap();
	await back.tap();
	await expect(preview).toBeFocused();
	await preview.tap();
	expect(
		await page.evaluate(() =>
			window.dispatchEvent(new CustomEvent('dn-back', { cancelable: true }))
		)
	).toBe(false);
	await expect(preview).toBeFocused();
	expect(await saved()).toBe(original);
	await b('Cancel').click();
	await expect(live.getByRole('heading', { name: 'Night Train' })).toBeVisible();
	await expect(live.getByRole('heading', { name: 'Draft sleeve' })).toHaveCount(0);
	await expect(
		live.locator('[data-part=transport]').getByRole('button', { name: 'Pause', exact: true })
	).toBeVisible();
	const time = await page.evaluate(
		() => (window as unknown as { fixtureAudio: HTMLAudioElement }).fixtureAudio.currentTime
	);
	expect(time).toBeGreaterThanOrEqual(15);
	expect(streams).toEqual([server + '/api/v3/stream/local/t0']);
	expect(await saved()).toBe(original);
});

test('the clean preview keeps every player row and Back inside the screen in both orientations', async ({
	page
}) => {
	await fixture(page);
	await play(page);
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	await button('Player settings').click();
	await button('Edit header').click();
	await button('Add subrow to column 1').click();
	await button('Use Artist').click();
	await button('Customize Playback position').click();
	await page.getByLabel('Seek bar style').selectOption('waveform');
	await button('Preview current draft').click();
	const dialog = page.getByRole('dialog', { name: 'Player layout preview' }),
		preview = dialog.locator('[data-part=draft-player]'),
		rows = preview.locator('[data-part=player-header-row], [data-part=player-row]'),
		back = dialog.getByRole('button', { name: 'Back to editing' });
	await expect(preview.locator('[data-seek-style=waveform] svg')).toBeVisible();
	for (const size of [
		{ width: 390, height: 844 },
		{ width: 320, height: 568 },
		{ width: 667, height: 375 }
	]) {
		await page.setViewportSize(size);
		await expect(back).toBeInViewport({ ratio: 1 });
		await expect
			.poll(() =>
				rows.evaluateAll((els) => {
					const frame = els[0].closest('dialog')!;
					const button = frame.querySelector('button')!.getBoundingClientRect();
					return els.every((el) => {
						const r = el.getBoundingClientRect();
						return (
							r.width > 0 &&
							r.height > 0 &&
							r.top >= button.bottom - 1 &&
							r.bottom <= innerHeight + 1 &&
							r.left >= -1 &&
							r.right <= innerWidth + 1
						);
					});
				})
			)
			.toBe(true);
		await expect(preview.locator('[data-section-id=player-more]')).toBeInViewport({ ratio: 0.999 });
	}
	await back.click();
	await expect(button('Preview current draft')).toBeFocused();
});

test('old menu and Track tools layouts migrate to More actions without adding either retired field to the picker', async ({
	page
}) => {
	const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'alex', 'player']);
	await page.addInitScript(
		(k) =>
			localStorage.setItem(
				k,
				JSON.stringify([
					{ id: 'player-tools', preview: false, title: '' },
					{ id: 'player-menu', preview: true, title: '', placement: 'header' }
				])
			),
		key
	);
	await fixture(page);
	await localSignIn(page, server, 'alex');
	const b = (name: string) => page.getByRole('button', { name, exact: true });
	await b('Settings').click();
	await b('Edit Now Playing layout').click();
	await expect(b('Customize More actions')).toBeVisible();
	await b('Add row').click();
	await page
		.getByRole('button', { name: /^Add feature to row/ })
		.last()
		.click();
	await expect(b('Use Track tools')).toHaveCount(0);
	await expect(b('Use Navigation menu')).toHaveCount(0);
	await b('Save layout').click();
	const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
	expect(saved.some((s: { id: string }) => s.id === 'player-more')).toBe(true);
	expect(saved.some((s: { id: string }) => s.id === 'player-menu' || s.id === 'player-tools')).toBe(
		false
	);
});
test('an explicit six-column header keeps all columns after menu migration', async ({ page }) => {
	const ids = [
		'player-close',
		'player-heading',
		'player-queue',
		'player-output',
		'player-settings',
		'player-slot-1'
	];
	const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'alex', 'player']);
	await page.addInitScript(
		({ ids, key }) =>
			localStorage.setItem(
				key,
				JSON.stringify(ids.map((id) => ({ id, title: '', preview: true, placement: 'header' })))
			),
		{ ids, key }
	);
	await page.setViewportSize({ width: 320, height: 720 });
	await fixture(page);
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	const b = (name: string) => page.getByRole('button', { name, exact: true });
	await b('Continue').click();
	await page.getByLabel('Username').fill('alex');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await b('Sign in').click();
	await b('Settings').click();
	await b('Edit Now Playing layout').click();
	const fields = () =>
		page
			.locator('[data-part=player-header-row]:visible [data-section-id]')
			.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-section-id')));
	await expect.poll(fields).toEqual(ids);
	await b('Cancel').click();
	await expect(page.getByRole('heading', { name: 'Nothing playing' })).toBeVisible();
	await expect.poll(fields).toEqual(ids);
	await expect(b('Open navigation menu')).toHaveCount(0);
	await expect(b('Player menu')).toHaveCount(0);
	await b('Close player').click();
	await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
});

test('touch users can fit the player, pull the queue down from a track and dismiss song details', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 568 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await fixture(page);
	await play(page);
	const view = page.locator('[data-part=now-playing]');
	async function allRowsFit() {
		return view.evaluate((root) => {
			const frame = root.getBoundingClientRect();
			return [
				...root.querySelectorAll('[data-part=player-row],[data-part=player-header-row]')
			].every((row) => {
				const r = row.getBoundingClientRect();
				return (
					r.height > 0 &&
					r.top >= frame.top - 1 &&
					r.bottom <= Math.min(innerHeight, frame.bottom) + 1
				);
			});
		});
	}
	await expect.poll(allRowsFit).toBe(true);
	await view.screenshot({ path: test.info().outputPath('portrait-player.png') });
	await expect(view.getByRole('button', { name: 'Open navigation menu' })).toHaveCount(0);
	const title = view.locator('[data-section-id=player-title] button');
	await title.click();
	const details = page.getByRole('dialog', { name: 'Track details' });
	await expect(details.getByText('Night Train', { exact: true })).toBeVisible();
	const grip = (await details.locator('[data-sheet-grip]').boundingBox())!;
	await verticalSwipe(page, grip.x + grip.width / 2, grip.y + grip.height / 2, 70);
	await expect(details).toBeHidden();
	await expect(title).toBeFocused();
	const art = view.locator('.hero'),
		rect = (await art.boundingBox())!;
	expect(rect.height).toBeGreaterThan(70);
	await verticalSwipe(page, rect.x + rect.width / 2, rect.y + rect.height * 0.85, -70);
	const queue = view.locator('[data-part=play-queue]');
	await expect(queue).toBeVisible();
	const row = (await queue.getByRole('button', { name: /Day Train/ }).boundingBox())!;
	await verticalSwipe(page, row.x + row.width / 2, row.y + row.height / 2, 76);
	await expect(queue).toBeHidden();
	await expect(view.getByRole('heading', { name: 'Night Train' })).toBeVisible();
	await page.setViewportSize({ width: 667, height: 375 });
	await expect.poll(allRowsFit).toBe(true);
	const landscape = (await art.boundingBox())!;
	await verticalSwipe(
		page,
		landscape.x + landscape.width / 2,
		landscape.y + landscape.height / 2,
		72
	);
	await expect(page.locator('[data-part=mini-player]')).toBeVisible();
});

test('a saved full-screen lyrics field opens an accessible sheet and preserves the artwork', async ({
	page
}) => {
	const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'alex', 'player']);
	await page.addInitScript(
		(key) =>
			localStorage.setItem(
				key,
				JSON.stringify([
					...'artwork title transport'
						.split(' ')
						.map((id) => ({ id: 'player-' + id, title: '', preview: true })),
					{ id: 'player-lyrics', title: '', preview: true, lyricsMode: 'sheet' }
				])
			),
		key
	);
	await fixture(page);
	await play(page);
	const trigger = page.getByRole('button', { name: 'Lyrics', exact: true });
	await trigger.click();
	const dialog = page.getByRole('dialog', { name: 'Lyrics' });
	await expect(dialog.getByRole('button', { name: 'Seek to lyric At the station' })).toBeVisible();
	expect((await dialog.boundingBox())!.height).toBeGreaterThan(
		(page.viewportSize()?.height ?? 0) * 0.9
	);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();
	await expect(page.locator('[data-section-id=player-artwork] [data-part=lyrics]')).toHaveCount(0);
});

test('an oversized saved composition fits all live controls after a viewport resize', async ({
	page
}) => {
	const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'alex', 'player']);
	const ids = [
		'player-artwork',
		'player-title',
		'player-transport',
		'player-more',
		'player-timeline',
		'player-lyrics'
	];
	await page.addInitScript(
		({ key, ids }) =>
			localStorage.setItem(
				key,
				JSON.stringify(ids.map((id) => ({ id, preview: true, title: '', minHeight: 132 })))
			),
		{ key, ids }
	);
	await fixture(page);
	await play(page);
	const view = page.locator('[data-part=now-playing]');
	for (const size of [
		{ width: 320, height: 568 },
		{ width: 667, height: 375 },
		{ width: 390, height: 844 }
	]) {
		await page.setViewportSize(size);
		await expect
			.poll(() =>
				view.evaluate(
					(root, ids) =>
						ids.every((id) => {
							const target = root
								.querySelector('[data-section-id="' + id + '"]')
								?.getBoundingClientRect();
							return (
								!!target &&
								target.height > 0 &&
								target.top >= -1 &&
								target.bottom <= innerHeight + 1
							);
						}),
					ids
				)
			)
			.toBe(true);
	}
	// The app's error banner or an inset may reduce the available main area without a window resize.
	await page.locator('main').evaluate((main) => {
		main.style.maxHeight = '420px';
	});
	await expect
		.poll(() =>
			view.evaluate((root) => {
				const pane = root.closest('main')!.getBoundingClientRect();
				return Math.abs(root.getBoundingClientRect().height - pane.height);
			})
		)
		.toBeLessThan(1);
	await view.getByRole('button', { name: 'More actions' }).click();
	await expect(page.getByRole('dialog', { name: 'More actions' })).toBeVisible();
});

test('hiding artwork uses the full lyrics sheet and honors a listener’s More actions caption', async ({
	page
}) => {
	const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'alex', 'player']);
	await page.addInitScript(
		(key) =>
			localStorage.setItem(
				key,
				JSON.stringify([
					{ id: 'player-title', title: '', preview: true },
					{ id: 'player-transport', title: '', preview: true },
					{
						id: 'player-more',
						title: '',
						preview: true,
						showLabel: true,
						labelPosition: 'above',
						labelName: 'My track actions'
					},
					{ id: 'player-lyrics', title: '', preview: true }
				])
			),
		key
	);
	await fixture(page);
	await play(page);
	const more = page.getByRole('button', { name: 'More actions', exact: true });
	await expect(more).toHaveText('My track actions');
	// More is a vertical ellipsis, independent of the listener's caption.
	const dots = await more
		.locator('svg circle')
		.evaluateAll((nodes) => nodes.map((n) => [n.getAttribute('cx'), n.getAttribute('cy')]));
	expect(dots).toHaveLength(3);
	expect(new Set(dots.map(([x]) => x)).size).toBe(1);
	expect(new Set(dots.map(([, y]) => y)).size).toBe(3);
	await expect(more.locator('[data-label-position=above]')).toBeVisible();
	await expect(page.locator('[data-section-id=player-artwork]')).toHaveCount(0);
	await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
	const lyrics = page.getByRole('dialog', { name: 'Lyrics' });
	await expect(lyrics.getByRole('button', { name: 'Seek to lyric First line' })).toBeVisible();
	const body = (await lyrics.locator('.sheet-content').boundingBox())!;
	await verticalSwipe(page, body.x + body.width / 2, body.y + 26, 85);
	await expect(lyrics).toBeHidden();
	await expect(page.getByRole('button', { name: 'Lyrics', exact: true })).toBeFocused();
});

test('track details distinguish DN source format, actual playback and each device copy without reading unrelated metadata', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 690 });
	const calls = await fixture(page);
	await play(page);
	const reads: string[] = [];
	page.on('request', (r) => {
		const url = new URL(r.url());
		if (url.pathname.includes('/api/v3/')) reads.push(url.pathname.split('/api/v3')[1]);
	});
	const title = page.getByRole('button', { name: 'Track details for Night Train' });
	const sheet = page.getByRole('dialog', { name: 'Track details' });
	await title.click();
	await expect(sheet.getByRole('heading', { name: 'Night Train' })).toBeVisible();
	await expect(sheet.locator('[data-part=cover]')).toBeVisible();
	const source = sheet.getByRole('region', { name: 'Source' }),
		format = sheet.getByRole('region', { name: 'Format' }),
		music = sheet.getByRole('region', { name: 'Music metadata' });
	await expect(source.getByText('DroppedNeedle', { exact: true })).toBeVisible();
	await expect(source.getByText('Not saved on this device')).toBeVisible();
	await expect(source.getByText('3.0 MiB')).toBeVisible();
	await expect(format.getByText('44.1 kHz', { exact: true })).toBeVisible();
	await expect(format.getByText('1021 kbps', { exact: true })).toBeVisible();
	await expect(music.getByText('Jazz', { exact: true })).toBeVisible();
	await expect(sheet.getByRole('region', { name: 'Current playback' })).toContainText(
		'PCM · 16-bit · 8 kHz · 128 kbps'
	);
	await expect(sheet.getByText('File path', { exact: true })).toHaveCount(0);
	await expect(sheet.getByText('Play count', { exact: true })).toHaveCount(0);
	expect(calls.lookups).toEqual(['Night Train']);
	const copy = {
		id: 't0',
		title: 'Night Train',
		artist: 'The Lines',
		album: 'Railway',
		streamUrl: '/api/v3/stream/local/t0',
		format: 'flac',
		genre: 'Jazz'
	};
	for (const [origin, label] of [
		['cached', 'Playback cache'],
		['automatic', 'Automatically saved'],
		['downloaded', 'Saved manually']
	] as const) {
		await seedOfflineMusic(page, server, 'alex', false, [{ track: copy, origin }]);
		await expect(source.getByText(label, { exact: true })).toBeVisible();
	}
	await expect(source.getByText('Size on device', { exact: true })).toBeVisible();
	expect(
		reads.filter(
			(p) => p.startsWith('/ratings') || p.startsWith('/favorites') || p.startsWith('/playlists')
		)
	).toEqual([]);
	await sheet.getByRole('button', { name: 'Close Track details' }).click();
	await page.context().setOffline(true);
	reads.length = 0;
	await title.click();
	await expect(source.getByText('Saved manually')).toBeVisible();
	await expect(format.getByText('FLAC', { exact: true })).toBeVisible();
	await expect(format.getByText('Sample rate', { exact: true })).toHaveCount(0);
	await expect(source.getByText('File size', { exact: true })).toHaveCount(0);
	expect(reads).toEqual([]);
	await page.keyboard.press('Escape');
	await expect(title).toBeFocused();
});
