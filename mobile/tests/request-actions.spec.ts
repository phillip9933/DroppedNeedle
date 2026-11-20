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
	const tasks: S['DownloadTaskResponse'][] = [
		{
			...task('stalled', 'Stalled transfer', 'downloading'),
			candidate_index: 0,
			progress_percent: 37,
			files_completed: 1,
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
		},
		...['choose', 'watch', 'stop', 'other'].map((name) => ({
			...task(name, 'Matches ' + name, 'queued'),
			user_id: name === 'other' ? 'another-listener' : 'owner',
			search_job_id: name
		})),
		{ ...task('held', 'Held recording', 'partial'), held_for_review: true },
		task('manual', 'Look again', 'failed'),
		{ ...task('scheduled', 'Later transfer', 'failed'), retry_max: 2, next_retry_at: 1799999999 }
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
		if (path === '/me/section-prefs') return json({ pages: { home: [], discover: [] } });
		if (path === '/home') return json({ sections: [] });
		if (path === '/library/albums') return json({ items: [], total: 0 });
		if (path === '/requests/active') return json({ items: active });
		if (path === '/requests/history') {
			const filter = url.searchParams.get('status');
			const items = filter ? history.filter((r) => r.status === filter) : history;
			return json({ items, total: items.length, page: 1, total_pages: 1 });
		}
		if (path === '/requests/approvals') {
			expect(role).toBe('admin');
			return json({ items: approvals });
		}
		if (path === '/downloads/tasks')
			return json({ items: tasks, page: 1, page_size: 30 } satisfies S['DownloadListResponse']);
		if (path === '/downloads/search/album') {
			expect(m).toBe('POST');
			expect(req.postDataJSON()).toMatchObject({
				release_group_mbid: id,
				artist_name: 'North',
				album_title: 'Look again'
			});
			return json({ status: 'searching', job_id: 'manual' } satisfies S['SearchAlbumResponse']);
		}
		const search = path.match(
			/^\/downloads\/search\/(choose|watch|stop|manual)(?:\/(pick|dismiss|cancel))?$/
		);
		if (search) {
			const [, job, action] = search;
			if (!action) {
				expect(m).toBe('GET');
				return json({
					job_id: job,
					artist_name: 'North',
					album_title: 'Matches ' + job,
					release_group_mbid: id,
					status: 'completed',
					candidate_count: 2,
					candidates: [
						{
							candidate_index: 0,
							title: 'Alternate edition',
							note: { code: 'names_album', text: 'The release title matches.' },
							source: 'usenet',
							file_count: 0,
							size_bytes: 0,
							tier: 'possible',
							files: []
						},
						{
							candidate_index: 1,
							title: 'Night edition',
							note: { code: 'complete', text: 'Tracklist matches.' },
							username: 'fixture peer',
							source: 'soulseek',
							format: 'FLAC',
							file_count: 2,
							size_bytes: 1048576,
							tier: 'refused',
							files: [{ filename: 'folder/disc-1.flac', extension: 'flac', size: 1048576 }],
							refusal: ['over_size_cap']
						}
					]
				} satisfies S['SearchJobResponse']);
			}
			expect(m).toBe('POST');
			expect([
				['choose', 'pick'],
				['watch', 'dismiss'],
				['stop', 'cancel']
			]).toContainEqual([job, action]);
			if (action === 'pick')
				expect(req.postDataJSON()).toEqual({ candidate_index: 1, confirm_policy_break: true });
			const entry = tasks.find((t) => t.id === job)!;
			entry.status = action === 'pick' ? 'downloading' : 'cancelled';
			return json(action === 'pick' ? { task_id: 'picked' } : { success: true, state: 'watching' });
		}
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
	await page
		.getByRole('navigation', { name: 'Music' })
		.getByRole('button', { name: 'Requests', exact: true })
		.click();
	return calls;
}

test('a listener can withdraw a shared track, retry history, and manage their own download', async ({
	page
}) => {
	const calls = await connect(page, 'user'),
		modal = page.getByRole('dialog');
	await expect(page.getByRole('tab', { name: 'Approvals', exact: true })).toHaveCount(0);
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
	await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
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
	await page.getByRole('tab', { name: 'Approvals', exact: true }).click();
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
	await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
	await page.getByRole('button', { name: 'Actions for Failed transfer' }).click();
	await modal.getByRole('button', { name: 'Retry import' }).click();
	await modal.getByRole('button', { name: 'Retry import' }).click();
	await expect(page.getByText('DN retried the import.')).toBeVisible();
});

test('a listener reviews matches, confirms a settings override, watches or cancels other searches, and opens held files on their own DN', async ({
	page
}) => {
	const calls = await connect(page, 'user');
	await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
	const modal = page.getByRole('dialog');
	await page.getByRole('button', { name: 'Actions for Look again' }).click();
	await modal.getByRole('button', { name: 'Search manually' }).click();
	await modal.getByRole('button', { name: 'Search manually' }).click();
	await expect(modal.getByRole('button', { name: /Night edition/ })).toBeVisible();
	await modal.getByRole('button', { name: 'Close', exact: true }).click();
	await page.getByRole('button', { name: 'Actions for Look again' }).click();
	await modal.getByRole('button', { name: 'Review manual search' }).click();
	await modal.getByRole('button', { name: 'Review manual search' }).click();
	await expect(modal.getByRole('button', { name: /Night edition/ })).toBeVisible();
	await modal.getByRole('button', { name: 'Close', exact: true }).click();
	expect(calls.filter((c) => c === 'POST /downloads/search/album')).toHaveLength(1);
	await page.getByRole('button', { name: 'Review matches for Matches choose' }).click();
	await modal.getByRole('button', { name: /Night edition/ }).click();
	await expect(modal.getByText('Exceeds your size limit')).toBeVisible();
	await modal.getByText('View files (1)').click();
	await expect(modal.getByText('disc-1.flac')).toBeVisible();
	expect(calls.some((c) => c.endsWith('/pick'))).toBe(false);
	await modal.getByRole('button', { name: 'Download anyway' }).click();
	await expect(page.getByText('Download started from your selection.')).toBeVisible();
	expect(calls.filter((c) => c.endsWith('/pick'))).toHaveLength(1);
	for (const [job, pick, confirm, receipt] of [
		[
			'watch',
			'None of these, keep watching',
			'Keep watching',
			'DN will keep watching for this album.'
		],
		['stop', 'Stop search', 'Stop search', 'Search stopped.']
	]) {
		await page.getByRole('button', { name: 'Review matches for Matches ' + job }).click();
		await modal.getByRole('button', { name: pick, exact: true }).click();
		await modal.getByRole('button', { name: confirm, exact: true }).click();
		await expect(page.getByText(receipt)).toBeVisible();
	}
	await expect(page.getByRole('button', { name: 'Review matches for Matches other' })).toHaveCount(
		0
	);
	await page.getByText('More on your server').click();
	await expect(page.getByRole('link', { name: 'Manage wanted watches' })).toHaveAttribute(
		'href',
		server + '/requests?tab=wanted'
	);
	await expect(page.getByRole('link', { name: 'Inspect quarantined downloads' })).toHaveCount(0);
	const held = page.getByRole('link', { name: 'Review held files for Held recording in browser' });
	await expect(held).toHaveAttribute('href', server + '/downloads');
	await page.context().route(server + '/downloads', async (route) => {
		expect(route.request().headers().authorization).toBeUndefined();
		await route.fulfill({ contentType: 'text/html', body: '<h1>Sign in to DN</h1>' });
	});
	const opened = page.waitForEvent('popup');
	await held.click();
	await expect((await opened).getByRole('heading', { name: 'Sign in to DN' })).toBeVisible();
});

test('administrators see links to the deployed upgrade, import, auto-download and quarantine pages', async ({
	page
}) => {
	await connect(page, 'admin');
	await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
	await page.getByText('More on your server').click();
	const pages = {
		'Import files into the library': '/downloads?tab=import',
		'Review quality upgrades': '/requests?tab=upgrades',
		'Manage auto-downloads': '/requests?tab=auto-download',
		'Inspect quarantined downloads': '/downloads'
	};
	for (const [label, path] of Object.entries(pages)) {
		await expect(page.getByRole('link', { name: label })).toHaveAttribute('href', server + path);
	}
	await expect(page.getByRole('button', { name: 'Review matches for Matches other' })).toHaveCount(
		0
	);
});

test('request tabs, history filters and transfer groups expose their state', async ({ page }) => {
	const calls = await connect(page, 'user');
	const tabs = page.getByRole('tablist', { name: 'Request views' });
	const current = tabs.getByRole('tab', { name: 'Activity', selected: true });
	await expect(current).toBeVisible();
	const history = page.getByRole('region', { name: 'Request history' });
	await history.getByText('Filter and sort history').click();
	await history.getByLabel('History status').selectOption('imported');
	await expect(history.getByText('No requests match this status.')).toBeVisible();
	await history.getByLabel('History order').selectOption('oldest');
	await expect.poll(() => calls.some((c) => c.includes('status=imported&sort=oldest'))).toBe(true);
	await history.getByLabel('History status').selectOption('failed');
	await expect(history.getByText('Missed train')).toBeVisible();
	await expect(history.getByRole('option', { name: 'Can reimport' })).toHaveCount(0);
	await current.focus();
	await page.keyboard.press('ArrowRight');
	await expect(tabs.getByRole('tab', { name: 'Downloads', selected: true })).toBeFocused();
	const panel = page.getByRole('tabpanel', { name: 'Downloads' });
	await expect(
		panel.getByRole('region', { name: 'Needs review' }).getByText('Held recording')
	).toBeVisible();
	const moving = panel.getByRole('region', { name: 'In progress' });
	await expect(
		moving.getByRole('progressbar', { name: 'Download progress for Stalled transfer' })
	).toHaveAttribute('value', '37');
	await expect(moving.getByText('1 of 2 files')).toBeVisible();
	await expect(
		panel.getByRole('region', { name: 'Scheduled retries' }).getByText('Later transfer')
	).toBeVisible();
	await expect(
		panel.getByRole('region', { name: 'Download history' }).getByText('Finished transfer')
	).toBeVisible();
	await page.keyboard.press('Home');
	await expect(tabs.getByRole('tab', { name: 'Activity', selected: true })).toBeFocused();
});

for (const theme of ['dark', 'light', 'midnight']) {
	test('request text and statuses remain legible in ' + theme, async ({ page }, testInfo) => {
		await page.addInitScript(
			(mode) => localStorage.setItem('dn.mobile.appearance.mode.v2', mode),
			theme
		);
		await connect(page, 'admin');
		await page.getByRole('tab', { name: 'Downloads' }).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
		const badges = page.locator('[data-part="download-task"] [data-tone]');
		await expect(badges.first()).toBeVisible();
		const ratios = await badges.evaluateAll((elements) => {
			// Canvas resolves both sRGB and the web themes’ OKLCH colors to sRGB.
			const ctx = document.createElement('canvas').getContext('2d')!;
			function luminance(color: string) {
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, 1, 1);
				const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data).map((v) => {
					const s = v / 255;
					return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
				});
				return 0.2126 * r + 0.7152 * g + 0.0722 * b;
			}
			return elements.map((el) => {
				const st = getComputedStyle(el),
					ink = luminance(st.color),
					bg = luminance(st.backgroundColor);
				return (Math.max(ink, bg) + 0.05) / (Math.min(ink, bg) + 0.05);
			});
		});
		expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			390
		);
		await page.screenshot({ path: testInfo.outputPath('downloads-' + theme + '.png') });
	});
}
