import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { components } from '../../frontend/src/lib/api/v3/openapi';

type Schema = components['schemas'];
const server = 'https://library.example/dn';
const audio = fileURLToPath(
	new URL('../../server/tests/fixtures/library/management_full.wav', import.meta.url)
);

test('a mixed playlist plays all local entries in saved order, including repeats', async ({
	page
}) => {
	const summary = {
		id: 'night',
		name: 'Night drive',
		track_count: 4,
		created_at: 1,
		updated_at: 1,
		cover_urls: [],
		is_owner: true,
		is_public: false,
		is_redacted: false,
		is_shared: false,
		can_edit: true,
		can_delete: true
	} satisfies Schema['PlaylistSummary'];
	const first = {
		id: 'entry-one',
		track_name: 'Going Home',
		artist_name: 'Metro',
		album_name: 'Last Stop',
		track_source_id: 'local-10',
		source_type: 'local',
		position: 0,
		created_at: 1
	} satisfies Schema['PlaylistTrack'];
	const external = {
		...first,
		id: 'entry-two',
		position: 1,
		source_type: 'plex',
		track_name: 'Across Town',
		track_source_id: 'plex-key',
		available_sources: ['plex']
	};
	const unresolved = {
		...first,
		id: 'entry-three',
		position: 2,
		source_type: '',
		track_name: 'Slow Train',
		album_id: 'group-8',
		track_source_id: null,
		available_sources: []
	};
	let healed = false;
	const streamed: string[] = [];
	await page.route(server + '/api/v3/**', async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.replace('/dn/api/v3', '');
		if (path === '/auth/providers')
			return route.fulfill({ json: { local: true, oidc: false, plex: false, jellyfin: false } });
		if (path === '/auth/login') return route.fulfill({ json: { token: 'fixture-session' } });
		expect(request.headers().authorization).toBe('Bearer fixture-session');
		if (path === '/me') return route.fulfill({ json: { display_name: 'Listener', id: 'user' } });
		if (path === '/me/section-prefs') return route.fulfill({ json: { pages: { home: [] } } });
		if (path === '/home') return route.fulfill({ json: { sections: [], refreshing: false } });
		if (path === '/library/albums')
			return route.fulfill({ json: { items: [], next: null, total: 0 } });
		if (path === '/playlists')
			return route.fulfill({
				json: {
					playlists: [
						{ id: 'hidden', track_count: 1, is_redacted: true, can_delete: false },
						summary
					]
				} satisfies Schema['PlaylistListResponse']
			});
		if (path === '/playlists/night/resolve-sources') {
			expect(request.method()).toBe('POST');
			healed = true;
			return route.fulfill({
				json: { sources: { 'entry-three': ['local'] } } satisfies Schema['ResolveSourcesResponse']
			});
		}
		if (path === '/playlists/night')
			return route.fulfill({
				json: {
					...summary,
					tracks: [
						first,
						external,
						healed
							? { ...unresolved, available_sources: ['local'], library_file_id: 'local-20' }
							: unresolved,
						{ ...first, id: 'entry-four', position: 3 }
					]
				} satisfies Schema['PlaylistDetail']
			});
		if (path.startsWith('/stream/local/')) {
			streamed.push(path);
			return route.fulfill({ path: audio, contentType: 'audio/wav' });
		}
		if (await emptyBoardRead(route)) return;
		throw Error('Unexpected API call: ' + path);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.getByRole('button', { name: 'Library', exact: true }).click();
	await page
		.getByRole('button', { name: 'Browse Playlists', exact: true })
		.click({ timeout: 4000 });
	await page.getByRole('button', { name: 'Night drive', exact: true }).click();
	await expect(page.getByRole('button', { name: /Across Town/ })).toBeDisabled();
	await expect(page.getByText('Slow Train', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Play playlist', exact: true }).click();
	await expect
		.poll(() => streamed)
		.toEqual(['/stream/local/local-10', '/stream/local/local-20', '/stream/local/local-10']);
	await page.getByRole('button', { name: 'Show play queue' }).click();
	const queue = page.locator('[data-part="play-queue"]');
	await expect(queue.getByRole('button')).toHaveCount(3);
	await expect(queue.locator('strong')).toHaveText(['Going Home', 'Slow Train', 'Going Home']);
});
