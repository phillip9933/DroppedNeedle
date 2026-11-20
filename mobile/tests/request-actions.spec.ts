import { expect, test, type Page } from '@playwright/test';
import type { components } from '../../frontend/src/lib/api/v3/openapi';
type S = components['schemas'];
const server = 'https://requests.example/music',
	api = server + '/api/v3';
const id = 'a39044ac-1fa7-4e7c-a616-58632eb221bb';
const second = 'ff683f78-3087-4dfa-8708-37c981bedbca';
const third = '4a1e4149-6ccb-43dc-ba92-6a3e176c36a3';
function row(
	mbid: string,
	name: string,
	status: S['RequestStatus'],
	kind: S['RequestKind'] = 'album'
): S['RequestItem'] {
	return {
		musicbrainz_id: mbid,
		artist_name: 'North',
		album_title: name,
		requested_at: 1,
		status,
		request_kind: kind,
		origin: 'user',
		requester_count: 0,
		user_id: 'owner'
	};
}
function task(taskId: string, title: string, status: S['TaskStatus']): S['DownloadTaskResponse'] {
	return {
		id: taskId,
		user_id: 'owner',
		download_type: 'album',
		source: 'soulseek',
		origin: 'user',
		release_group_mbid: id,
		artist_name: 'North',
		album_title: title,
		status,
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
		attempt_total: 2,
		has_next_source: false,
		held_for_review: false
	};
}
async function connect(page: Page, role: S['Role']) {
	const calls: string[] = [];
	let active = [
		{ ...row(id, 'Shared train', 'downloading', 'track'), user_id: 'other', requester_count: 1 },
		row(third, 'Warehouse', 'queued')
	];
	let history = [row(second, 'Missed train', 'failed', 'track')];
	let approvals = [
		row(id, 'Junction', 'awaiting_approval', 'track'),
		row(second, 'Crossing', 'awaiting_approval')
	];
	const tasks = [
		{
			...task('stalled', 'Stalled transfer', 'downloading'),
			candidate_index: 0,
			remote_queued: true,
			has_next_source: true
		},
		task('finished', 'Finished transfer', 'completed'),
		{
			...task('failed', 'Failed transfer', 'partial'),
			user_id: 'other',
			search_job_id: 'job',
			candidate_index: 1,
			source: 'usenet'
		}
	];
	await page.route(api + '/**', async (route) => {
		const req = route.request(),
			url = new URL(req.url()),
			path = url.pathname.replace('/music/api/v3', ''),
			m = req.method();
		const json = (data: unknown) => route.fulfill({ json: data });
		if (path === '/auth/providers')
			return json({ local: true, oidc: false, jellyfin: false, plex: false });
		if (path === '/auth/login') return json({ token: 'fixture' });
		expect(req.headers().authorization).toBe('Bearer fixture');
		calls.push(m + ' ' + path + url.search);
		if (path === '/me') return json({ id: 'owner', display_name: 'Listener', role });
		if (path === '/library/albums') return json({ items: [], total: 0 });
		if (path === '/requests/active') return json({ items: active });
		if (path === '/requests/history') return json({ items: history, page: 1, total_pages: 1 });
		if (path === '/requests/approvals') {
			expect(role).toBe('admin');
			return json({ items: approvals });
		}
		if (path === '/downloads/tasks')
			return json({ items: tasks, page: 1, page_size: 30 } satisfies S['DownloadListResponse']);
		if (path === '/requests/active/' + id) {
			expect(m).toBe('DELETE');
			expect(url.searchParams.get('kind')).toBe('track');
			active = active.filter((i) => i.musicbrainz_id !== id);
			return json({
				success: true,
				message: 'Removed from your requests. The shared request continues.'
			});
		}
		if (path === '/requests/active/' + third) {
			expect(m).toBe('DELETE');
			expect(url.searchParams.get('kind')).toBe('album');
			active = active.filter((item) => item.musicbrainz_id !== third);
			return json({ success: false, message: 'Request changed while cancelling.' });
		}
		if (path === '/requests/retry/' + second) {
			expect(m).toBe('POST');
			expect(url.searchParams.get('kind')).toBe('track');
			history = [];
			return json({ success: true, message: 'Retry awaiting approval.' });
		}
		if (
			path === '/requests/approvals/' + id + '/approve' ||
			path === '/requests/approvals/' + second + '/reject'
		) {
			expect(role).toBe('admin');
			expect(m).toBe('POST');
			const approved = path.endsWith('/approve');
			expect(url.searchParams.get('kind')).toBe(approved ? 'track' : 'album');
			approvals = approvals.filter((r) => r.musicbrainz_id !== (approved ? id : second));
			return json({ success: true, message: approved ? 'Request approved.' : 'Request rejected.' });
		}
		if (path === '/downloads/tasks/stalled/next-source') {
			expect(m).toBe('POST');
			expect(req.postDataJSON()).toEqual({ expected_candidate_index: 0 });
			tasks[0].remote_queued = false;
			return json({ success: true, status: 'downloading', candidate_index: 1 });
		}
		if (path === '/downloads/tasks/failed/reimport') {
			expect(role).toBe('admin');
			expect(m).toBe('POST');
			tasks[2].status = 'completed';
			return json({ success: true, status: 'completed' });
		}
		throw new Error('Unexpected request ' + m + ' ' + path);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('owner');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.getByRole('button', { name: 'Requests', exact: true }).click();
	return calls;
}

test('a listener can withdraw a shared track, retry history, and manage their own download', async ({
	page
}) => {
	const calls = await connect(page, 'user'),
		modal = page.getByRole('dialog');
	await expect(page.getByRole('button', { name: 'Approvals', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Actions for Shared train' }).click();
	await expect(modal).toContainText('Other listeners keep theirs.');
	await modal.getByRole('button', { name: 'Go back' }).click();
	expect(calls.filter((c) => c.startsWith('DELETE'))).toHaveLength(0);
	await page.getByRole('button', { name: 'Actions for Shared train' }).click();
	await modal.getByRole('button', { name: 'Withdraw request' }).click();
	await expect(page.getByRole('button', { name: 'Actions for Shared train' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Actions for Warehouse' }).click();
	await modal.getByRole('button', { name: 'Cancel request' }).click();
	await expect(page.getByRole('alert')).toHaveText('Request changed while cancelling.');
	await expect(page.getByRole('button', { name: 'Actions for Warehouse' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Actions for Missed train' }).click();
	await modal.getByRole('button', { name: 'Retry request' }).click();
	await expect(page.getByText('Retry awaiting approval.')).toBeVisible();
	await page.getByRole('button', { name: 'Downloads', exact: true }).click();
	await expect(page.getByText('Finished transfer')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Actions for Finished transfer' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Actions for Failed transfer' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Actions for Stalled transfer' }).click();
	await modal.getByRole('button', { name: 'Try next source' }).click();
	await modal.getByRole('button', { name: 'Try next source' }).click();
	await expect(page.getByText('DN switched to the next source.')).toBeVisible();
	expect(calls.some((c) => c.includes('/requests/approvals'))).toBe(false);
});

test('an admin reviews pending track and album requests and retries a failed import', async ({
	page
}) => {
	await connect(page, 'admin');
	const modal = page.getByRole('dialog');
	await page.getByRole('button', { name: 'Approvals', exact: true }).click();
	for (const [title, action] of [
		['Junction', 'Approve request'],
		['Crossing', 'Reject request']
	]) {
		await page.getByRole('button', { name: 'Actions for ' + title }).click();
		await modal.getByRole('button', { name: action }).click();
		await modal.getByRole('button', { name: action }).click();
		await expect(page.getByRole('button', { name: 'Actions for ' + title })).toHaveCount(0);
	}
	await expect(page.getByText('No requests awaiting approval.')).toBeVisible();
	await page.getByRole('button', { name: 'Downloads', exact: true }).click();
	await page.getByRole('button', { name: 'Actions for Failed transfer' }).click();
	await modal.getByRole('button', { name: 'Retry import' }).click();
	await modal.getByRole('button', { name: 'Retry import' }).click();
	await expect(page.getByText('DN retried the import.')).toBeVisible();
});
