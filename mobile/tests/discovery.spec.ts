import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { components } from '../../frontend/src/lib/api/v3/openapi';
type Schema = components['schemas'];
const server = 'https://dn.example/music';
const artist = 'b53fc3e3-49d1-42dd-a9cf-a64a7cb019e6';
const group = '19cf82e5-32dc-4827-8a4c-59b8f895dcde';
const artistName = 'Crescent Trio';

test('a listener explores DN charts and genres, follows an artist and plays library songs and radio', async ({
	page
}) => {
	let following = false;
	const reads: string[] = [];
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			url = new URL(req.url());
		const path = url.pathname.slice('/music/api/v3'.length);
		const json = (data: unknown) => route.fulfill({ json: data });
		if (path === '/auth/providers')
			return json({ local: true, oidc: false, plex: false, jellyfin: false });
		if (path === '/auth/login') return json({ token: 'listener-session' });
		expect(req.headers().authorization).toBe('Bearer listener-session');
		if (path === '/me') return json({ id: 'user', display_name: 'Listener' });
		if (path === '/library/albums') return json({ items: [], next: null, total: 0 });
		if (path.includes('artwork') || path.startsWith('/covers/'))
			return route.fulfill({ status: 404 });
		reads.push(path);
		if (path === '/home')
			return json({
				sections: [
					{
						key: 'genre_list',
						zone: 'browse_genres',
						content: {
							shape: 'shelf',
							shelf: {
								title: 'Genres',
								type: 'genres',
								items: [{ kind: 'genre', name: 'Art pop' }]
							}
						}
					}
				],
				service_prompts: [],
				genre_artwork: {},
				genre_artwork_schema_version: '1',
				refreshing: false
			} satisfies Schema['HomeResponse']);
		if (path === '/home/genre/Art%20pop')
			return json({
				genre: 'Art pop',
				genre_artwork: { kind: 'gradient', version: '1', albums: [] },
				library: {
					albums: [
						{
							musicbrainz_id: group,
							title: 'Moonrise',
							artist_name: artistName,
							in_library: true,
							requested: false
						}
					],
					artists: [{ musicbrainz_id: artist, name: artistName, in_library: true }],
					album_count: 1,
					artist_count: 1
				},
				popular: null
			} satisfies Schema['GenreDetailResponse']);
		if (path === '/artists/' + artist + '/top-songs')
			return json({
				source: 'lastfm',
				asked_source: 'lastfm',
				configured: true,
				needs_account: [],
				unavailable_sources: [],
				songs: [
					{
						title: 'Blue Hour',
						artist_name: artistName,
						release_group_mbid: group,
						track_number: 1,
						release_name: 'Moonrise'
					},
					{ title: 'Lost Song', artist_name: artistName }
				]
			} satisfies Schema['TopSongsResponse']);
		if (path === '/library/resolve-tracks') {
			expect(req.postDataJSON().items).toEqual([
				{ release_group_mbid: group, disc_number: 1, track_number: 1 }
			]);
			return json({
				items: [
					{
						release_group_mbid: group,
						disc_number: 1,
						track_number: 1,
						source: 'local',
						track_source_id: 'local-one',
						duration: 0.3
					}
				]
			} satisfies Schema['ResolveTracksResponse']);
		}
		if (path === '/discover/radio/plan') {
			const body = req.postDataJSON() as Schema['RadioPlanRequest'];
			expect(req.method()).toBe('POST');
			expect(body.mode).toBe('library');
			const owned = {
				track_name: 'Silver Skies',
				artist_name: artistName,
				artist_mbid: artist,
				album_name: 'Moonrise',
				in_library: true,
				local_file_id: 'radio-one'
			};
			const unavailable = {
				...owned,
				track_name: 'Remote-only radio entry',
				in_library: false,
				local_file_id: 'foreign-file'
			};
			if (body.seed_type === 'artist') {
				expect(body.seed_id).toBe(artist);
				return json({
					title: 'Artist station',
					tracks: [
						unavailable,
						{ ...owned, track_name: 'Missing file ID', local_file_id: null },
						owned
					]
				} satisfies Schema['RadioPlanResponse']);
			}
			expect(body.seed_type).toBe('genre');
			expect(body.seed_id).toBe('Art pop');
			return json({
				title: 'Genre station',
				tracks: [unavailable]
			} satisfies Schema['RadioPlanResponse']);
		}
		if (path === '/stream/local/radio-one' || path === '/stream/local/local-one')
			return route.fulfill({
				path: fileURLToPath(
					new URL('../../server/tests/fixtures/library/management_full.wav', import.meta.url)
				),
				contentType: 'audio/wav'
			});
		if (path === '/artists/' + artist + '/top-albums')
			return json({
				source: 'lastfm',
				asked_source: 'lastfm',
				configured: true,
				needs_account: [],
				unavailable_sources: [],
				albums: [
					{
						title: 'Moonrise',
						musicbrainz_id: group,
						artist_name: artistName,
						in_library: true,
						requested: false
					}
				]
			} satisfies Schema['TopAlbumsResponse']);
		if (path === '/discover')
			return json({
				discover_queue_enabled: false,
				service_prompts: [],
				genre_artwork: {},
				genre_artwork_schema_version: '1',
				refreshing: false,
				sections: [
					{
						key: 'top_picks',
						zone: 'essentials',
						content: {
							shape: 'picks',
							picks: {
								title: 'Top picks',
								personalizing: false,
								items: [
									{
										album: {
											musicbrainz_id: group,
											title: 'Moonrise',
											artist_name: artistName,
											requested: false,
											in_library: false
										},
										match_pct: 92,
										reasons: []
									}
								]
							}
						}
					}
				]
			} satisfies Schema['DiscoverResponse']);
		if (path === '/home/popular/albums' || path === '/home/your-top/albums') {
			expect(url.searchParams.get('range')).toBe('this_month');
			const personal = path.includes('your-top');
			return json({
				items: [
					{
						musicbrainz_id: group,
						title: personal ? 'On repeat' : 'Crowd favourite',
						artist_name: artistName,
						in_library: personal,
						requested: false
					}
				],
				range_key: 'this_month',
				label: 'Albums',
				limit: 24,
				offset: 0,
				has_more: false
			} satisfies Schema['ChartPage_AlbumRef']);
		}
		if (path === '/home/trending/artists')
			return json({
				items: [{ name: artistName, musicbrainz_id: artist, in_library: false }],
				range_key: 'this_month',
				label: 'Trending',
				limit: 24,
				offset: 0,
				has_more: false
			} satisfies Schema['ChartPage_ArtistRef']);
		if (path === '/artists/' + artist + '/follow') {
			expect(req.method()).toBe('PUT');
			expect(req.postDataJSON()).toEqual({ followed: !following });
			following = !following;
		}
		if (path.startsWith('/artists/' + artist + '/follow'))
			return json({
				artist_mbid: artist,
				followed: following,
				auto_download: false,
				auto_download_state: 'none'
			} satisfies Schema['FollowStatusResponse']);
		if (path === '/artists/' + artist + '/releases')
			return json({
				albums: [{ id: group, title: 'Moonrise', in_library: false, requested: false }],
				eps: [],
				singles: [],
				offset: 0,
				limit: 24,
				has_more: false,
				returned_count: 1,
				warming: false,
				source: 'musicbrainz',
				service_status: null
			} satisfies Schema['ArtistReleases']);
		if (path === '/following/artists')
			return json({
				artists: following
					? [
							{
								artist_mbid: artist,
								name: artistName,
								followed_at: 1,
								auto_download: false,
								auto_download_state: 'none'
							}
						]
					: []
			} satisfies Schema['FollowedArtistListResponse']);
		if (path === '/following/new-releases/recent')
			return json({
				items: [
					{
						artist_mbid: artist,
						artist_name: artistName,
						release_group_mbid: group,
						title: 'Moonrise',
						in_library: false
					}
				],
				total: 1
			} satisfies Schema['NewReleaseListResponse']);
		if (path === '/following/concerts')
			return json({
				configured: true,
				items: [
					{
						artist_mbid: artist,
						artist_name: artistName,
						source: 'ticketmaster',
						source_event_id: 'one',
						event_name: 'Evening concert',
						matched_city: 'Tokyo',
						local_date: '2027-03-04',
						venue_name: 'Civic Hall',
						status: 'scheduled'
					}
				],
				total: 1
			} satisfies Schema['ConcertsResponse']);
		if (path === '/library/albums/match/' + group)
			return route.fulfill({
				status: 404,
				json: { error: { code: 'NOT_FOUND', message: 'Missing' } }
			});
		if (path === '/albums/' + group + '/editions') return json({ items: [] });
		throw new Error('Unexpected DroppedNeedle request ' + path);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username', { exact: true }).fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.getByRole('button', { name: 'Discover', exact: true }).click({ timeout: 4000 });
	await expect(page.getByRole('button', { name: 'Moonrise ' + artistName })).toBeVisible();
	expect(reads).toEqual(['/discover']);
	const view = page.getByRole('combobox', { name: 'Discover view' });
	await view.selectOption('popular');
	await expect(page.getByRole('button', { name: 'Crowd favourite ' + artistName })).toBeVisible();
	await view.selectOption('top');
	await expect(page.getByRole('button', { name: 'On repeat ' + artistName })).toBeVisible();
	await view.selectOption('trending');
	await page.getByRole('button', { name: artistName, exact: true }).click();
	await page.getByRole('button', { name: 'Follow artist', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Unfollow artist', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Moonrise ' + artistName }).click();
	await expect(page.getByRole('heading', { name: 'Moonrise', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Unfollow artist', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(view).toHaveValue('trending');
	await view.selectOption('following');
	await expect(page.getByRole('button', { name: artistName, exact: true })).toBeVisible();
	await view.selectOption('releases');
	await expect(page.getByRole('button', { name: 'Moonrise ' + artistName })).toBeVisible();
	await view.selectOption('concerts');
	await expect(page.getByText('Civic Hall', { exact: false })).toBeVisible();
	await page.getByRole('button', { name: artistName, exact: true }).click();
	await page.getByRole('button', { name: 'Unfollow artist' }).click();
	await expect(page.getByRole('button', { name: 'Follow artist', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await view.selectOption('following');
	await expect(page.getByText('Artists you follow will appear here.')).toBeVisible();
	await view.selectOption('genres');
	await page.getByRole('button', { name: 'Art pop', exact: true }).click();
	await page.getByRole('button', { name: 'Library radio' }).click();
	await expect(page.getByText('No playable library tracks for this station.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Moonrise ' + artistName })).toBeVisible();
	await page.getByRole('button', { name: artistName, exact: true }).click();
	const artistView = page.getByRole('combobox', { name: 'Artist view' });
	await artistView.selectOption('albums');
	await expect(page.getByRole('button', { name: 'Moonrise ' + artistName })).toBeVisible();
	await artistView.selectOption('songs');
	await expect(
		page.getByRole('button', { name: 'Lost Song, unavailable in your library' })
	).toBeDisabled();
	await page.getByRole('button', { name: 'Play Blue Hour', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Blue Hour', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Close player' }).click();
	await page.getByRole('button', { name: 'Library radio' }).click();
	await expect(page.getByRole('heading', { name: 'Silver Skies', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Show play queue' }).click();
	const queue = page.locator('[data-part="play-queue"]');
	await expect(queue.getByRole('button')).toHaveCount(1);
	await expect(queue.getByRole('button', { name: /Silver Skies/ })).toBeVisible();
});
