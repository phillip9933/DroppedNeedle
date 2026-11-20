import { expect, test } from '@playwright/test';
import type { components } from '../../frontend/src/lib/api/v3/openapi';
type Schema = components['schemas'];
const server = 'https://dn.example/music';
const artist = 'b53fc3e3-49d1-42dd-a9cf-a64a7cb019e6';
const group = '19cf82e5-32dc-4827-8a4c-59b8f895dcde';
const artistName = 'Crescent Trio';

test('a listener follows a trending artist and opens their release and concert through DN', async ({
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
});
