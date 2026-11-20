import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { components } from '../../frontend/src/lib/api/v3/openapi';

type Schema = components['schemas'];
const server = 'https://dn.example/music';
const api = server + '/api/v3';
const group = '72fe3516-d6ed-4a83-9370-0957c61c929d';
const release = 'fe12575d-3384-484f-8eb3-dff88d23b06a';
const album = 'After Dark';
const artist = 'Northbound';
const session = 'test-device-session';
const audio = fileURLToPath(
	new URL('../../server/tests/fixtures/library/management_full.wav', import.meta.url)
);

test('the requested edition arrives and both local tracks play in disc order', async ({ page }) => {
	let accepted = false;
	let imported = false;
	const played: string[] = [];
	const unknown: string[] = [];
	const common = {
		musicbrainz_id: group,
		artist_name: artist,
		album_title: album,
		requested_at: 1,
		request_kind: 'album',
		origin: 'user',
		requester_count: 0,
		release_mbid: release
	} as const;
	await page.route(api + '/**', async (route) => {
		const req = route.request();
		const url = new URL(req.url());
		const operation = url.pathname.slice('/music/api/v3'.length);
		const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
		if (operation === '/auth/providers')
			return json({ local: true, oidc: false, plex: false, jellyfin: false });
		if (operation === '/auth/login') {
			expect(req.postDataJSON()).toMatchObject({ transport: 'bearer' });
			return json({ token: session });
		}
		expect(req.headers().authorization).toBe('Bearer ' + session);
		if (operation === '/me') return json({ display_name: 'Listener', id: 'user' });
		if (operation === '/library/albums') return json({ items: [], total: 0, next: null });
		if (operation === '/search')
			return json({
				albums: [
					{
						kind: 'album',
						title: album,
						artist,
						musicbrainz_id: group,
						art_missing: true,
						score: 100,
						in_library: false,
						requested: false
					}
				],
				tracks: [],
				artists: [],
				album_status: 'ok',
				artist_status: 'ok',
				track_status: 'ok'
			} satisfies Schema['SearchResponse']);
		if (operation === '/library/albums/match/' + group && !imported)
			return json({ error: { code: 'NOT_FOUND', message: 'Album not found' } }, 404);
		if (
			operation === '/library/albums/match/' + group ||
			operation === '/library/albums/' + release + '/status'
		) {
			const items = ['Fading Light', 'Slow Motion'].map(
				(title, index) =>
					({
						id: 'track-' + (2 - index),
						title,
						artist_name: artist,
						album_artist_name: artist,
						album_id: 'owned',
						album_title: album,
						art_missing: true,
						cover_available: false,
						disc_number: 1,
						track_number: 2 - index,
						duration_seconds: 0.3,
						favorite: false,
						file_size_bytes: 4800,
						format: 'wav',
						row_revision: 1
					}) satisfies Schema['TrackView']
			);
			if (operation.endsWith('/status')) {
				const owned = items.map((t) => ({ ...t, current_tier: 'lossless', below_cutoff: false }));
				return json({
					album_id: 'owned',
					in_library: true,
					track_count: 3,
					tracks: [...owned, { ...owned[0], album_id: 'second-copy', id: 'other-copy-track' }]
				} satisfies Schema['LibraryAlbumStatus']);
			}
			return json({
				items: [{ ...items[0], id: 'group-default', title: 'Different edition' }],
				total: 1,
				offset: 0,
				limit: 200
			} satisfies Schema['TrackPage']);
		}
		if (operation === '/albums/' + group + '/editions')
			return json({
				items: [
					{
						release_mbid: release,
						title: album,
						disambiguation: 'Japan CD',
						track_count: 2,
						disc_count: 1,
						is_owned: false,
						is_pinned: false,
						media_formats: ['CD']
					}
				]
			} satisfies Schema['AlbumEditionsResponse']);
		if (operation === '/albums/' + group + '/editions/' + release + '/tracks')
			return json({
				tracks: [{ disc_number: 1, position: 1, title: 'Slow Motion' }],
				total_tracks: 1
			} satisfies Schema['AlbumTracksInfo']);
		if (operation === '/requests/albums') {
			expect(req.method()).toBe('POST');
			expect(req.postDataJSON()).toMatchObject({
				musicbrainz_id: group,
				release_mbid: release,
				artist,
				album
			});
			expect(accepted).toBe(false);
			accepted = true;
			return json({
				message: 'Waiting for approval',
				success: true,
				musicbrainz_id: group,
				status: 'awaiting_approval'
			} satisfies Schema['IntakeResponse']);
		}
		if (operation === '/requests/active')
			return json({
				items: accepted && !imported ? [{ ...common, status: 'awaiting_approval' }] : [],
				count: accepted && !imported ? 1 : 0
			} satisfies Schema['ActiveRequestsResponse']);
		if (operation === '/requests/history')
			return json({
				items: imported ? [{ ...common, status: 'imported' }] : [],
				page: 1,
				total_pages: 1,
				total: imported ? 1 : 0,
				page_size: 30
			} satisfies Schema['HistoryResponse']);
		if (operation.startsWith('/covers/')) return route.fulfill({ status: 404 });
		if (operation.startsWith('/stream/local/')) {
			played.push(operation);
			return route.fulfill({ path: audio, contentType: 'audio/wav' });
		}
		unknown.push(operation);
		return json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } }, 404);
	});

	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await page.getByRole('searchbox').fill(album);
	await page.getByRole('button', { name: album + ' ' + artist }).click();
	await page.getByRole('combobox', { name: 'Edition' }).selectOption(release);
	await expect(page.getByText('Slow Motion')).toBeVisible();
	await page.getByRole('button', { name: 'Request album' }).click();
	await page.getByRole('button', { name: 'View requests' }).click();
	await expect(page.getByRole('button', { name: /After Dark.*Awaiting approval/ })).toBeVisible();
	imported = true;
	await page.getByRole('button', { name: 'Refresh requests' }).click();
	await page.getByRole('button', { name: /After Dark.*Imported/ }).click();
	await page.getByRole('button', { name: 'Play album' }).click();
	await expect(page.getByRole('heading', { name: 'Fading Light', exact: true })).toBeVisible();
	expect(played).toEqual(['/stream/local/track-1', '/stream/local/track-2']);
	await page.getByRole('button', { name: 'Show play queue' }).click();
	await expect(page.getByRole('heading', { name: 'Play queue' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('heading', { name: 'Fading Light', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Open player for Fading Light' })).toBeVisible();
	expect(unknown).toEqual([]);
});
