import { expect, test, type Page } from '@playwright/test';
import type { components } from '../../frontend/src/lib/api/v3/openapi';

type Schema = components['schemas'];
const server = 'https://library.example/dn';
const api = server + '/api/v3';
const local = ['Signal', 'Station'].map(
	(title, i) =>
		({
			id: 'file-' + i,
			title,
			artist_name: 'North',
			album_artist_name: 'North',
			album_id: 'album',
			album_title: i === 0 ? 'In transit' : '',
			disc_number: 1,
			track_number: i + 1,
			format: 'flac',
			file_size_bytes: 500,
			cover_available: false,
			art_missing: true,
			favorite: false,
			row_revision: 1
		}) satisfies Schema['TrackView']
);

function playlist(
	id: string,
	name: string,
	owner: boolean,
	edit: boolean
): Schema['PlaylistDetail'] {
	return {
		id,
		name,
		is_owner: owner,
		is_public: false,
		can_edit: edit,
		can_delete: owner,
		is_shared: !owner,
		is_redacted: false,
		cover_urls: [],
		created_at: 1,
		updated_at: 1,
		track_count: 0,
		tracks: []
	};
}
async function connect(page: Page) {
	const lists = [
		playlist('mine', 'My mix', true, true),
		playlist('shared', 'Shared mix', false, true),
		playlist('readonly', 'Listening room', false, false)
	];
	let members: Schema['PlaylistMember'][] = [];
	const writes: string[] = [];
	await page.route(api + '/**', async (route) => {
		const req = route.request(),
			method = req.method(),
			path = req.url().slice(api.length).split('?')[0];
		const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
		if (path === '/auth/providers')
			return json({ local: true, oidc: false, plex: false, jellyfin: false });
		if (path === '/auth/login') return json({ token: 'device-token' });
		expect(req.headers().authorization).toBe('Bearer device-token');
		if (method !== 'GET') writes.push(method + ' ' + path);
		if (path === '/me') return json({ id: 'listener', display_name: 'Listener' });
		if (path === '/users/directory')
			return json({
				users: [
					{ id: 'listener', display_name: 'Listener' },
					{ id: 'sam', display_name: 'Sam' }
				]
			});
		if (path === '/library/albums')
			return json({
				items: [
					{
						id: 'album',
						title: 'In transit',
						artist_name: 'North',
						artist_id: 'artist',
						identity_state: 'unidentified',
						guess_contradicted: false,
						track_count: 2,
						total_duration_seconds: 20,
						total_size_bytes: 1000,
						is_compilation: false,
						cover_available: false,
						art_missing: true,
						favorite: false
					}
				],
				total: 1
			});
		if (path === '/library/albums/match/album')
			return json({ items: local, total: 2, offset: 0, limit: 200 } satisfies Schema['TrackPage']);
		if (path === '/playlists') {
			if (method === 'GET') return json({ playlists: lists });
			expect(method).toBe('POST');
			const p = playlist('created', req.postDataJSON().name, true, true);
			lists.push(p);
			return json(p, 201);
		}
		const [, group, id, ...parts] = path.split('/'),
			p = lists.find((item) => item.id === id);
		if (group !== 'playlists' || !p) throw new Error('Unexpected request ' + method + ' ' + path);
		const action = parts.join('/');
		if (action === '') {
			if (method === 'GET') return json(p);
			if (method === 'PUT') {
				expect(p.is_owner).toBe(true);
				p.name = req.postDataJSON().name;
				return json(p);
			}
			if (method === 'DELETE') {
				expect(p.can_delete).toBe(true);
				lists.splice(lists.indexOf(p), 1);
				return json({ status: 'ok', message: 'Deleted' });
			}
		}
		if (action === 'visibility' && method === 'PATCH') {
			expect(p.is_owner).toBe(true);
			p.is_public = req.postDataJSON().is_public;
			return json(p);
		}
		if (action === 'members') {
			expect(p.is_owner).toBe(true);
			if (method === 'PUT') {
				const data = req.postDataJSON() as Schema['MembersBody'];
				members = data.user_ids.map((user_id) => ({
					user_id,
					display_name: 'Sam',
					can_edit: data.editor_ids?.includes(user_id) ?? false
				}));
			}
			return json({ members });
		}
		expect(p.can_edit).toBe(true);
		if (action === 'tracks' && method === 'POST') {
			const data = req.postDataJSON() as Schema['AddTracksBody'];
			const added = data.tracks.map((entry, i) => {
				expect(entry.source_type).toBe('local');
				expect(entry.available_sources).toEqual(['local']);
				return {
					...entry,
					source_type: 'local',
					id: 'entry-' + (i + p.tracks.length),
					position: i + p.tracks.length,
					created_at: 1
				};
			});
			p.tracks.push(...added);
			p.track_count = p.tracks.length;
			return json({ tracks: added });
		}
		if (action === 'tracks/reorder' && method === 'PATCH') {
			const data = req.postDataJSON() as Schema['ReorderBody'];
			const idx = p.tracks.findIndex((t) => t.id === data.track_id);
			expect(idx).toBeGreaterThanOrEqual(0);
			p.tracks.splice(data.new_position, 0, ...p.tracks.splice(idx, 1));
			return json({ status: 'ok', message: 'Moved', new_position: data.new_position });
		}
		if (parts[0] === 'tracks' && method === 'DELETE') {
			p.tracks = p.tracks.filter((t) => t.id !== parts[1]);
			p.track_count = p.tracks.length;
			return json({ status: 'ok', message: 'Removed' });
		}
		throw new Error('Unexpected request ' + method + ' ' + path);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
	return { lists, writes, members: () => members };
}

test('an owner creates, renames, shares and confirms deletion of a playlist', async ({ page }) => {
	const state = await connect(page);
	await page.getByRole('button', { name: 'Playlists', exact: true }).click();
	await page.getByRole('button', { name: 'New playlist' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('button', { name: 'Create playlist' })).toBeDisabled();
	await dialog.getByLabel('Playlist name').fill('  Saturday  ');
	await dialog.getByRole('button', { name: 'Create playlist' }).click();
	await expect(page.getByRole('heading', { name: 'Saturday' })).toBeVisible();
	await page.getByRole('button', { name: 'Edit playlist', exact: true }).click();
	await page.getByRole('button', { name: 'Rename', exact: true }).click();
	await dialog.getByLabel('Playlist name').fill('Sunday');
	await dialog.getByRole('button', { name: 'Save name' }).click();
	await expect(page.getByRole('heading', { name: 'Sunday' })).toBeVisible();
	await page.getByRole('button', { name: 'Share playlist' }).click();
	await dialog.getByLabel('Who can listen').selectOption({ label: 'Everyone on this server' });
	await dialog.getByRole('button', { name: 'Save visibility' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Everyone on this server can listen.');
	await dialog.getByLabel('Find a listener').fill('Sam');
	await dialog.getByRole('button', { name: 'Add Sam' }).click();
	await dialog.getByLabel('Access for Sam').selectOption({ label: 'Can edit tracks' });
	await dialog.getByRole('button', { name: 'Save listeners' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Shared listeners updated.');
	expect(state.members()).toEqual([{ user_id: 'sam', display_name: 'Sam', can_edit: true }]);
	await dialog.getByRole('button', { name: 'Done' }).click();
	await page.getByRole('button', { name: 'Delete playlist' }).click();
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	expect(state.writes).not.toContain('DELETE /playlists/created');
	await page.getByRole('button', { name: 'Delete playlist' }).click();
	await dialog.getByRole('button', { name: 'Delete playlist' }).click();
	await expect(page.getByRole('button', { name: /My mix/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Sunday/ })).toHaveCount(0);
});

test('a shared editor adds an album, reorders tracks and removes one occurrence', async ({
	page
}) => {
	const state = await connect(page);
	const dialog = page.getByRole('dialog', { name: 'Add to playlist' });
	await page.getByRole('button', { name: /In transit/ }).click();
	await page.getByRole('button', { name: 'Album actions' }).click();
	await page.getByRole('button', { name: 'Add to playlist', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Listening room' })).toHaveCount(0);
	await dialog.getByRole('combobox', { name: 'Playlist', exact: true }).selectOption('shared');
	await dialog.getByRole('button', { name: 'Add 2 tracks' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Added 2 tracks to Shared mix.');
	await dialog.getByRole('button', { name: 'Done' }).click();
	await page.getByRole('button', { name: 'More options for Signal' }).click();
	await page.getByRole('button', { name: 'Add to playlist', exact: true }).click();
	await dialog.getByRole('combobox', { name: 'Playlist', exact: true }).selectOption('shared');
	await dialog.getByRole('button', { name: 'Add track', exact: true }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await page.getByRole('button', { name: 'Playlists', exact: true }).click();
	await page.getByRole('button', { name: /Shared mix/ }).click();
	await page.getByRole('button', { name: 'Edit playlist' }).click();
	await expect(
		page.getByRole('button', { name: /Rename|Share playlist|Delete playlist/ })
	).toHaveCount(0);
	const entries = page.locator('[data-entry]'),
		titles = entries.locator('strong');
	await expect(titles).toHaveText(['Signal', 'Station', 'Signal']);
	await entries.last().getByRole('button', { name: 'Move Signal up' }).click();
	await expect(titles).toHaveText(['Signal', 'Signal', 'Station']);
	await entries.nth(1).getByRole('button', { name: 'Remove Signal' }).click();
	await page.keyboard.press('Escape');
	await expect(titles).toHaveCount(3);
	await entries.nth(1).getByRole('button', { name: 'Remove Signal' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Remove track' }).click();
	await expect(titles).toHaveText(['Signal', 'Station']);
	expect(state.lists[1].tracks.map((t) => t.track_source_id)).toEqual(['file-0', 'file-1']);
	expect(state.lists[1].tracks[1].album_name).toBe('Unknown album');
	expect(state.writes).toContain('DELETE /playlists/shared/tracks/entry-2');
	await page.getByRole('button', { name: 'Back to playlists' }).click();
	await page.getByRole('button', { name: /Listening room/ }).click();
	await expect(page.getByText('This playlist is empty.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Edit playlist' })).toHaveCount(0);
});
