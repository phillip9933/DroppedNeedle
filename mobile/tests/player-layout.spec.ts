import { silentWav } from './fixtures/silentWav';
import { openPlayerPlacement } from './fixtures/playerEditor';
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
	await lyrics.locator('summary').click();
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
	await page.getByRole('combobox', { name: 'Column width', exact: true }).selectOption('2');
	await page
		.getByRole('combobox', { name: 'Horizontal alignment', exact: true })
		.selectOption('end');
	await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('large');
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
	await addFeature(page, 'Favorite');
	await addFeature(page, 'Add to playlist');
	await button('Customize Playback position').click();
	await button('Split Playback position').click();
	await button('Customize Play queue').click();
	await openPlayerPlacement(page);
	await page.getByLabel('Move to row', { exact: true }).selectOption('new');
	await button('Customize Close player').click();
	await button('Remove Close player').click();
	await button('Save layout').click();
	await expect(region.locator('[data-section-id=player-quality]')).toHaveText(
		'FLAC · 16-bit · 44.1 kHz'
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
	await expect(region.locator('header').getByRole('button', { name: 'Close player' })).toHaveCount(
		0
	);
	await region.getByRole('button', { name: 'Player menu' }).click();
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

test('a listener sees the five-button row proportions, appearance and reserved text lines in the preview and live player', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 720 });
	await fixture(page);
	await play(page);
	const live = page.locator('[data-part=now-playing]'),
		sample = page.locator('[data-part=sample-player]');
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	await live.getByRole('button', { name: 'Player settings' }).click();
	await button('Arrange five playback controls').click();
	await button('Customize Play or pause').click();
	await expect(page.getByRole('spinbutton', { name: 'Padding' })).toBeVisible();
	await expect(page.locator('.canvas details.advanced')).not.toHaveAttribute('open', '');
	await page.getByLabel('Padding', { exact: true }).fill('0');
	await page.getByLabel('Horizontal alignment').selectOption('center');
	await page.getByLabel('Vertical alignment').selectOption('end');
	await page.getByRole('combobox', { name: 'Icon', exact: true }).selectOption('circle-play');
	await page.getByLabel('Icon size', { exact: true }).fill('30');
	await page.getByLabel('Action label').selectOption('hide');
	const checkRow = async (region: typeof live) => {
		const toggle = region.locator('[data-section-id=player-toggle]');
		const row = region
			.locator('[data-part=player-row]')
			.filter({ has: page.locator('[data-section-id=player-toggle]') });
		expect(
			await row
				.locator('[data-section-id]')
				.evaluateAll((cells) => cells.map((c) => c.getAttribute('data-section-id')))
		).toEqual([
			'player-shuffle',
			'player-previous',
			'player-toggle',
			'player-next',
			'player-repeat'
		]);
		await expect(toggle).toHaveCSS('align-content', 'end');
		await expect(toggle).toHaveCSS('text-align', 'center');
		await expect(toggle.locator('[data-player-icon=circle-play] .glyph')).toHaveCSS(
			'width',
			'30px'
		);
		expect(
			await toggle.evaluate((el) => getComputedStyle(el).getPropertyValue('--field-padding').trim())
		).toBe('0px');
		const sizes = await row
			.locator('[data-section-id]')
			.evaluateAll((cells) => cells.map((c) => c.getBoundingClientRect().width));
		expect(sizes[2]).toBeGreaterThan(sizes[1] + 5);
		expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44);
		return sizes;
	};
	const myRow = await page
		.locator('[data-player-row]')
		.filter({ has: button('Customize Play or pause') })
		.getAttribute('data-player-row');
	await button('Edit row ' + (Number(myRow) + 1)).click();
	const slider = page.getByRole('slider', { name: 'Column 3 width' });
	await slider.focus();
	await slider.press('End');
	const sizes = await checkRow(sample);
	const measured = Math.round((100 * sizes[2]) / sizes.reduce((a, b) => a + b, 0));
	await expect(slider.locator('..').locator('output')).toHaveText(measured + '%');
	await button('Customize Track title').click();
	await expect(page.getByLabel('Column width', { exact: true })).toHaveCount(0);
	await expect(page.getByLabel('Show text', { exact: true })).toHaveCount(0);
	await page.getByRole('combobox', { name: 'Icon', exact: true }).selectOption('music');
	await expect(page.getByLabel('Show text', { exact: true })).toBeChecked();
	await page.getByLabel('Show text', { exact: true }).uncheck();
	await expect(sample.locator('[data-section-id=player-title]')).not.toContainText('Soft Current');
	await page.getByLabel('Show text', { exact: true }).check();

	await page.getByLabel('Maximum lines').selectOption('3');
	await page.getByLabel('Reserve all lines').check();
	const lines = (region: typeof live) =>
		region.locator('[data-section-id=player-title] .lines').first();
	await expect(lines(sample)).toHaveCSS('-webkit-line-clamp', '3');
	const hasLines = (region: typeof live) =>
		lines(region).evaluate(
			(el) =>
				el.getBoundingClientRect().height >= 3 * parseFloat(getComputedStyle(el).lineHeight) - 1
		);
	expect(await hasLines(sample)).toBe(true);
	const save = button('Save layout');
	await save.scrollIntoViewIfNeeded();
	expect(
		await save.evaluate((b) => {
			const r = b.getBoundingClientRect(),
				s = getComputedStyle(b),
				at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
			return (b === at || b.contains(at)) && s.whiteSpace === 'nowrap';
		})
	).toBe(true);
	const toolbar = page.locator('.composer .bar');
	await expect(toolbar).toBeVisible();
	expect(
		await toolbar.evaluate((bar) => {
			const canvas = bar.parentElement!.querySelector('.canvas')!.getBoundingClientRect();
			const rect = bar.getBoundingClientRect(),
				y = rect.y + rect.height / 2;
			return [canvas.left + 1, canvas.right - 1].every((x) =>
				bar.contains(document.elementFromPoint(x, y))
			);
		})
	).toBe(true);

	await save.click();
	await checkRow(live);
	await expect(lines(live)).toHaveCSS('-webkit-line-clamp', '3');
	expect(await hasLines(live)).toBe(true);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
		expect(boxes[1].w).toBeCloseTo(size, 0);
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
			.locator(':scope > [data-section-id]')
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
	await button('End of this track').click();
	await expect(button('Sleep timer')).toContainText('End of track');
	await live.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('slider', { name: 'Playback position' }).fill('59');
	await expect(live.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
		timeout: 10000
	});
	await expect(live.getByRole('heading', { name: 'Night Train' })).toBeVisible();
	await button('Sleep timer').click();
	await button('End of this track').click();
	await button('Next track').click();
	await expect(live.getByRole('heading', { name: 'Day Train' })).toBeVisible();
	await button('Sleep timer').click();
	await expect(page.getByText('The sleep timer is off.')).toBeVisible();
	await button('5 min').click();
	await button('Sleep timer').click();
	await button('Cancel timer').click();
	await button('Repeat off. Change repeat mode').click();
	await button('Repeat all. Change repeat mode').click();
	await button('Sleep timer').click();
	await button('End of this track').click();
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
	await expect(sample.getByRole('heading', { name: 'Soft Current' })).toBeVisible();
	await expect(sample.getByRole('img', { name: 'Tidal Memory album cover' })).toBeVisible();
	await expect(
		sample.locator('[data-layout-drag], .editing-field, .active-field, [data-inspector], .field')
	).toHaveCount(0);
	await expect(sample.locator('[data-slot=true]')).toHaveCount(1);
	await expect(sample.getByRole('button')).toHaveCount(1);
	await expect(sample.getByRole('button', { name: 'Open navigation menu' })).toBeVisible();
	await expect(page.locator('.mast')).toBeHidden();
	const title = sample.locator('[data-section-id=player-heading] .lines');
	expect(await title.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
	await page.screenshot({ path: test.info().outputPath('now-playing-draft-preview-320.png') });
	const next = sample.locator('[data-part=transport] button[aria-label="Next track"]');
	await next.scrollIntoViewIfNeeded();
	const box = (await next.boundingBox())!;
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
	await expect(back).toBeInViewport();
	await b('Open navigation menu').tap();
	await b('Close navigation menu').tap();
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

test('the navigation field can be dragged, styled and saved, with one drawer trigger on the player and queue at 320px', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 760 });
	await fixture(page);
	await play(page);
	const b = (name: string) => page.getByRole('button', { name, exact: true });
	const live = page.locator('[data-part=now-playing]');
	const sample = page.locator('[data-part=sample-player]');
	const cells = (within: typeof live) =>
		within.locator('[data-part=player-header-row] > [data-section-id]');
	const trigger = b('Open navigation menu');
	const checkDrawer = async (returned: typeof trigger) => {
		await trigger.click();
		await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible();
		await b('Close navigation menu').click();
		await expect(returned).toBeFocused();
	};
	await expect(cells(live)).toHaveCount(6);
	await expect(cells(live).first()).toHaveAttribute('data-section-id', 'player-menu');
	await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
	await checkDrawer(trigger);
	const boxes = await cells(live).evaluateAll((nodes) =>
		nodes.map((n) => {
			const b = n.getBoundingClientRect();
			return [b.x, b.right, b.width];
		})
	);
	for (const [left, right, width] of boxes) {
		expect(left).toBeGreaterThanOrEqual(0);
		expect(right).toBeLessThanOrEqual(320);
		expect(width).toBeGreaterThanOrEqual(44);
	}
	await b('Player settings').click();
	await expect(sample.locator('[data-section-id=player-menu]')).toHaveCount(1);
	const handle = b('Customize Navigation menu').locator('[data-layout-drag]');
	const heading = sample.locator('[data-section-id=player-heading]');
	const box = (await heading.boundingBox())!;
	await handle.dragTo(heading, { targetPosition: { x: box.width - 5, y: box.height / 2 } });
	await expect(cells(sample).nth(2)).toHaveAttribute('data-section-id', 'player-menu');
	await b('Cancel').click();
	await expect(cells(live).first()).toHaveAttribute('data-section-id', 'player-menu');
	await b('Player settings').click();
	await b('Customize Navigation menu').click();
	await page.getByRole('combobox', { name: 'Icon', exact: true }).selectOption('heart');
	await openPlayerPlacement(page);
	await page.getByLabel('Move to row', { exact: true }).selectOption('new');
	await b('Finish editing field').click();
	await page.getByText('Share player layout', { exact: true }).click();
	const exported = JSON.parse(await page.getByLabel('Current layout JSON').inputValue());
	expect(exported.sections.filter((s: { id: string }) => s.id === 'player-menu')).toEqual([
		expect.objectContaining({ id: 'player-menu', icon: 'heart' })
	]);
	await b('Save layout').click();
	await expect(live.locator('header [data-section-id=player-menu]')).toHaveCount(0);
	await expect(
		live.locator('[data-section-id=player-menu] [data-player-icon=heart]')
	).toBeVisible();
	await checkDrawer(trigger);
	await expect(b('Player menu')).toHaveCount(0);
	await b('Show play queue').click();
	await expect(trigger).toHaveCount(0);
	await b('Player menu').click();
	await checkDrawer(b('Player menu'));
	await b('Hide play queue').click();
	await expect(trigger).toBeVisible();
	await b('Player settings').click();
	await b('Customize Navigation menu').click();
	await b('Remove Navigation menu').click();
	await b('Save layout').click();
	await expect(live.locator('[data-section-id=player-menu]')).toHaveCount(0);
	await b('Player menu').click();
	await checkDrawer(b('Player menu'));
});

test('an explicit six-column header keeps all columns and the empty player offers drawer access', async ({
	page
}) => {
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
			.locator('[data-part=player-header-row]:visible > [data-section-id]')
			.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-section-id')));
	await expect.poll(fields).toEqual(ids);
	await b('Cancel').click();
	await expect(page.getByRole('heading', { name: 'Nothing playing' })).toBeVisible();
	await expect.poll(fields).toEqual(ids);
	await expect(b('Open navigation menu')).toHaveCount(0);
	await b('Player menu').click();
	await expect(b('Close player')).toHaveCount(1);
	await b('Open navigation menu').click();
	await b('Close navigation menu').click();
	await expect(b('Player menu')).toBeFocused();
	await b('Player settings').click();
	await addFeature(page, 'Navigation menu');
	await b('Save layout').click();
	await expect(page.getByRole('heading', { name: 'Nothing playing' })).toBeVisible();
	await expect.poll(fields).toEqual(ids);
	await expect(b('Open navigation menu')).toHaveCount(0);
	await b('Player menu').click();
	await b('Open navigation menu').click();
	await b('Close navigation menu').click();
	await expect(b('Player menu')).toBeFocused();
});
