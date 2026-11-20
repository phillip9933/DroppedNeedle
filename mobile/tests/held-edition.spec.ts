import { expect, test, type Page } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';

async function openCheck(page: Page, failure?: 'import' | 'revision') {
	const server = 'https://edition.example/dn';
	const writes: { method: string; path: string; body: unknown }[] = [];
	let fail = failure;
	let revision = 4;
	const file = (id: number, name: string, reason: string) => ({
		id,
		original_name: name,
		reason,
		source: 'soulseek',
		reason_kind: 'hold',
		reason_text: 'Review in library',
		actions: [],
		created_at: 12
	});
	const files = [
		file(21, 'Selected.flac', 'album_needs_check'),
		file(29, 'Unselected.flac', 'album_needs_check'),
		file(30, 'Different.flac', 'wrong_track')
	];
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			url = new URL(req.url()),
			path = url.pathname.split('/api/v3')[1];
		const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
		if (path === '/auth/providers')
			return json({ local: true, oidc: false, plex: false, jellyfin: false });
		if (path === '/auth/login') return json({ token: 'edition' });
		expect(req.headers().authorization).toBe('Bearer edition');
		if (req.method() !== 'GET') {
			writes.push({ method: req.method(), path, body: req.postDataJSON() });
			if (path === '/held/3/import') {
				if (fail === 'import') {
					fail = undefined;
					return json({ error: { message: 'Import interrupted' } }, 503);
				}
				return json({ imported: 1, already_owned: 0, discarded: 0, still_held: 0 });
			}
			if (
				path === '/library/albums/copy/edition/confirm' ||
				path === '/library/albums/copy/edition'
			) {
				if (fail === 'revision') {
					fail = undefined;
					revision++;
					return json({ error: { message: 'This choice changed' } }, 409);
				}
				return json({ album_id: 'copy' });
			}
			throw Error('Unexpected edition write ' + path);
		}
		if (path === '/me') return json({ id: 'owner', display_name: 'Listener', role: 'trusted' });
		if (path === '/requests/active') return json({ items: [] });
		if (path === '/requests/history') return json({ items: [], total: 0, page: 1, total_pages: 1 });
		if (path === '/downloads/tasks') return json({ items: [], page: 1, page_size: 30 });
		if (path === '/held')
			return json({
				entries: [
					{
						id: 3,
						album_title: 'Evening Rail',
						artist_name: 'The Lines',
						state: 'held',
						origin: 'download',
						check_album_id: 'copy',
						release_group_mbid: 'group',
						files
					}
				]
			});
		if (path === '/library/albums/copy/edition')
			return json({
				album_id: 'copy',
				release_mbid: 'original',
				release_group_mbid: 'group',
				edition_kind: 'release',
				identity_revision: revision,
				state: 'unconfirmed',
				reason: { message: 'Check this copy before importing.' },
				candidates: []
			});
		if (path === '/albums/group/editions')
			return json({
				items: [
					{ release_mbid: 'original', title: 'Evening Rail', country: 'GB' },
					{ release_mbid: 'alternate', title: 'Evening Rail deluxe', country: 'JP' }
				]
			});
		if (path === '/library/albums/copy/edition/plan') {
			const release = url.searchParams.get('release_mbid');
			return json({
				album_id: 'copy',
				release_mbid: release,
				is_current: release === 'original',
				identity_revision: revision,
				edition: { title: release === 'original' ? 'First pressing' : 'Deluxe pressing' },
				tracks: [],
				files: [],
				kept_count: 2,
				missing_count: 1,
				extra_count: 0,
				duplicate_count: 0,
				other_version_count: 0
			});
		}
		if (await emptyBoardRead(route)) return;
		throw Error('Unexpected edition read ' + path);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('owner');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Music' })
		.getByRole('button', { name: 'Requests' })
		.click();
	await page.getByRole('tab', { name: 'Downloads' }).click();
	await page.getByRole('button', { name: 'Review all held files' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: /Evening Rail/ }).click();
	await dialog.getByRole('checkbox', { name: 'Unselected.flac' }).uncheck();
	await dialog.getByRole('button', { name: 'Check album edition' }).click();
	await expect(dialog.getByRole('heading', { name: 'First pressing' })).toBeVisible();
	await expect(dialog.getByText('Selected.flac', { exact: true })).toBeVisible();
	await expect(dialog.getByText('Different.flac', { exact: true })).toHaveCount(0);
	await expect(dialog.getByText('Unselected.flac', { exact: true })).toHaveCount(0);
	return { writes, dialog };
}
test('leaving an edition preview makes no writes and a changed revision needs a fresh comparison', async ({
	page
}) => {
	const { writes, dialog } = await openCheck(page, 'revision');
	await dialog.getByRole('button', { name: 'Back to held files' }).click();
	expect(writes).toHaveLength(0);
	await dialog.getByRole('button', { name: 'Check album edition' }).click();
	await dialog.getByRole('button', { name: 'Confirm edition and retry files' }).click();
	await expect(dialog.getByRole('alert')).toContainText('library edition changed');
	expect(writes).toHaveLength(1);
	await dialog.getByRole('button', { name: 'Reload editions' }).click();
	await dialog.getByRole('button', { name: 'Confirm edition and retry files' }).click();
	await expect(dialog.getByText('1 imported.', { exact: true })).toBeVisible();
	expect(writes).toEqual([
		{
			method: 'POST',
			path: '/library/albums/copy/edition/confirm',
			body: { expected_identity_revision: 4 }
		},
		{
			method: 'POST',
			path: '/library/albums/copy/edition/confirm',
			body: { expected_identity_revision: 5 }
		},
		{ method: 'POST', path: '/held/3/import', body: { file_ids: [21] } }
	]);
});
test('changing an edition and retrying an interrupted import saves the chosen release only once', async ({
	page
}) => {
	const { writes, dialog } = await openCheck(page, 'import');
	await dialog.getByLabel('Edition', { exact: true }).selectOption('alternate');
	await expect(dialog.getByRole('heading', { name: 'Deluxe pressing' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Use edition and retry files' }).click();
	await expect(dialog.getByRole('alert')).toContainText('Import interrupted');
	await expect(dialog.getByLabel('Edition', { exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Retry selected files' }).click();
	await expect(dialog.getByText('1 imported.', { exact: true })).toBeVisible();
	expect(writes).toEqual([
		{
			method: 'PUT',
			path: '/library/albums/copy/edition',
			body: { release_mbid: 'alternate', expected_identity_revision: 4 }
		},
		{ method: 'POST', path: '/held/3/import', body: { file_ids: [21] } },
		{ method: 'POST', path: '/held/3/import', body: { file_ids: [21] } }
	]);
});
