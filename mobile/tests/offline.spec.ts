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
		if (path === '/library/albums/match/evening' || path === '/library/tracks')
			return json({ items: tracks, total: 2 });
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
	await page.getByRole('button', { name: 'Open navigation menu' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Offline music', exact: true })
		.click();
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
	await page.getByLabel('Playback cache limit').selectOption('128');
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
