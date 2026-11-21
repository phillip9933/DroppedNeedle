import { chooseOption } from './fixtures/inlineChoice';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
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
		user_id: 'user',
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
		if (operation === '/me') return json({ display_name: 'Listener', id: 'user', role: 'user' });
		if (operation === '/me/section-prefs') return json({ pages: { home: [], discover: [] } });
		if (operation === '/home') return json({ sections: [] });
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
				tracks: [
					{
						disc_number: 1,
						position: 1,
						title: 'Slow Motion',
						recording_id: 'song-recording',
						length: 132000
					}
				],
				total_tracks: 1
			} satisfies Schema['AlbumTracksInfo']);
		if (operation === '/library/tracks/track-2/lyrics')
			return json({
				is_synced: true,
				text: 'Daylight',
				lines: [{ start_seconds: 0, text: 'Daylight' }]
			} satisfies Schema['LyricsView']);
		if (operation === '/requests/tracks') {
			expect(req.postDataJSON()).toMatchObject({
				recording_mbid: 'song-recording',
				release_mbid: release,
				release_group_mbid: group,
				duration_seconds: 132
			});
			return json({ status: 'awaiting_approval' });
		}
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
				message: 'Request queued',
				success: true,
				musicbrainz_id: group,
				status: 'queued'
			} satisfies Schema['IntakeResponse']);
		}
		if (operation === '/downloads/tasks')
			return json({
				items:
					accepted && !imported
						? [
								{
									id: 'task',
									user_id: 'user',
									download_type: 'album',
									source: 'soulseek',
									origin: 'user',
									release_group_mbid: group,
									artist_name: artist,
									album_title: album,
									status: 'queued',
									progress_percent: 0,
									downloaded_bytes: 0,
									files_total: 2,
									files_completed: 0,
									files_failed: 0,
									retry_count: 0,
									created_at: 1,
									updated_at: 1,
									retry_max: 0,
									retry_ladder_minutes: [],
									acquisition_cleanup_state: 'not_tracked',
									remote_queued: false,
									attempt_number: 1,
									attempt_total: 1,
									has_next_source: false,
									held_for_review: false,
									search_job_id: 'edition-job'
								}
							]
						: [],
				page: 1,
				page_size: 30
			} satisfies Schema['DownloadListResponse']);
		if (operation === '/downloads/search/edition-job')
			return json({
				job_id: 'edition-job',
				status: 'completed',
				album_title: album,
				artist_name: artist,
				release_group_mbid: group,
				release_mbid: release,
				candidate_count: 1,
				candidates: [
					{
						candidate_index: 0,
						title: 'Matching edition',
						source: 'soulseek',
						tier: 'recommended',
						file_count: 2,
						files: [],
						size_bytes: 2000,
						note: { code: 'complete', text: 'Both tracks match the selected edition.' }
					}
				]
			} satisfies Schema['SearchJobResponse']);
		if (operation === '/downloads/search/edition-job/pick') {
			expect(req.method()).toBe('POST');
			expect(req.postDataJSON()).toEqual({ candidate_index: 0, confirm_policy_break: false });
			expect(accepted).toBe(true);
			expect(imported).toBe(false);
			imported = true;
			return json({ task_id: 'task' } satisfies Schema['PickResponse']);
		}
		if (operation === '/requests/active')
			return json({
				items: accepted && !imported ? [{ ...common, status: 'queued' }] : [],
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
		if (await emptyBoardRead(route)) return;
		unknown.push(operation);
		return json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } }, 404);
	});

	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Music' })
		.getByRole('button', { name: 'Search', exact: true })
		.click();
	await page.getByRole('searchbox').fill(album);
	await page.getByRole('button', { name: album + ' ' + artist }).click();
	await chooseOption(page.getByRole('combobox', { name: 'Edition' }), release);
	await expect(page.getByText('Slow Motion')).toBeVisible();
	await page.getByRole('button', { name: 'Request song Slow Motion' }).click();
	await expect(page.getByText('Awaiting approval', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Request album' }).click();
	await page.getByRole('button', { name: 'View requests' }).click();
	await expect(page.getByRole('button', { name: /After Dark.*Queued/ })).toBeVisible();
	await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
	await page.getByRole('button', { name: 'Review matches for ' + album }).click();
	const review = page.getByRole('dialog');
	await review.getByRole('button', { name: /Matching edition/ }).click();
	await review.getByRole('button', { name: 'Start download' }).click();
	await expect(page.getByText('Download started from your selection.')).toBeVisible();
	await page.getByRole('tab', { name: 'Activity', exact: true }).click();
	await page.getByRole('button', { name: /After Dark.*Imported/ }).click();
	await page.getByRole('button', { name: 'Play album' }).click();
	await expect(page.getByRole('heading', { name: 'Fading Light', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
	await expect(page.locator('[data-part=lyrics] [aria-current=true]')).toHaveText('Daylight');
	expect(played).toEqual(['/stream/local/track-1', '/stream/local/track-2']);
	await page.getByRole('button', { name: 'Show play queue' }).click();
	await expect(page.getByRole('heading', { name: 'Play queue' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('heading', { name: 'Fading Light', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Open player for Fading Light' })).toBeVisible();
	expect(unknown).toEqual([]);
});
