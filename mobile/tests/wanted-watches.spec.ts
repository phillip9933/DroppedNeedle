import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { test, expect, type Page } from '@playwright/test';
import type { components } from '../../frontend/src/lib/api/v3/openapi';

type S = components['schemas'];
const server = 'https://library.example/dn';
const ids = [
	'11111111-1111-4111-8111-111111111111',
	'22222222-2222-4222-8222-222222222222',
	'33333333-3333-4333-8333-333333333333'
];
function watch(i: number, title: string, state: S['WatchState']): S['WantedItem'] {
	return {
		musicbrainz_id: ids[i],
		album_title: title,
		artist_name: 'North',
		created_at: 10,
		check_count: 3,
		kind: i === 0 ? 'partial' : 'missing',
		new_candidate_count: i === 0 ? 2 : 0,
		state,
		next_check_at: 1701000000
	};
}
async function connect(page: Page, role: 'admin' | 'user' | 'trusted') {
	const rows = [
		watch(0, 'Rivers', 'watching'),
		watch(1, 'Mountains', 'stopped'),
		watch(2, 'Moon', 'fulfilled')
	];
	if (role === 'admin')
		rows.forEach((r) => {
			r.user_id = 'elsewhere';
			r.user_name = 'Sam';
		});
	let reads = 0;
	const writes: string[] = [];
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			path = new URL(req.url()).pathname.replace('/dn/api/v3', ''),
			method = req.method();
		const json = (body: unknown) => route.fulfill({ json: body });
		if (path === '/auth/providers') return json({ local: true, oidc: false });
		if (path === '/auth/login') return json({ token: 'fixture' });
		expect(req.headers().authorization).toBe('Bearer fixture');
		if (path === '/me') return json({ id: 'listener', display_name: 'Listener', role });
		if (path === '/me/section-prefs') return json({ pages: { home: [] } });
		if (path === '/home') return json({ sections: [], refreshing: false });
		if (path === '/library/albums' || path === '/library/artists')
			return json({ items: [], next: null });
		if (path === '/requests/active' || path === '/requests/history' || path === '/downloads/tasks')
			return json({ items: [], page: 1, total_pages: 1, page_size: 30 });
		if (path === '/requests/wanted') {
			expect(method).toBe('GET');
			reads++;
			if (reads === 1) return route.fulfill({ status: 503, json: {} });
			return json({
				count: rows.length,
				items: rows,
				retrying: [
					{
						album_title: 'Harbour',
						artist_name: 'Far Away',
						musicbrainz_id: ids[2],
						retry_count: 1,
						max_attempts: 4,
						next_retry_at: 1700000000
					}
				]
			} satisfies S['WantedResponse']);
		}
		if (await emptyBoardRead(route)) return;
		writes.push(method + ' ' + path);
		if (path === '/requests/wanted/clear-finished') {
			expect(method).toBe('POST');
			const finished = rows.filter((r) => r.state !== 'watching');
			finished.forEach((r) => rows.splice(rows.indexOf(r), 1));
			return json({ removed: finished.length });
		}
		const match = path.match(/^\/requests\/wanted\/([^/]+)(?:\/(seen|resume|stop))?$/);
		const item = rows.find((r) => r.musicbrainz_id === match?.[1]),
			act = match?.[2];
		expect(item).toBeDefined();
		if (!item) throw Error('Unexpected request ' + path);
		if (!act) {
			expect(method).toBe('DELETE');
			rows.splice(rows.indexOf(item), 1);
			return json({ removed: 1 });
		}
		expect(method).toBe('POST');
		if (act === 'seen') item.new_candidate_count = 0;
		if (act === 'stop') item.state = 'stopped';
		if (act === 'resume') item.state = 'watching';
		return json({ success: true, state: item.state });
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Music' })
		.getByRole('button', { name: 'Requests' })
		.click();
	expect(reads).toBe(0);
	await page.getByText('Wanted watches', { exact: true }).click();
	await page.getByRole('button', { name: 'Retry watchlist' }).click();
	const list = page.getByRole('region', { name: 'Wanted watchlist' });
	await expect(list.getByText('Harbour')).toBeVisible();
	return { list, rows, writes };
}
test('a listener checks, stops, resumes, acknowledges and removes watches', async ({ page }) => {
	const { list, rows, writes } = await connect(page, 'user');
	await expect(list.getByText('Your watches')).toBeVisible();
	await expect(list.getByText('Watching · Missing tracks')).toBeVisible();
	await expect(list.getByRole('link', { name: 'Review 2 new matches in browser' })).toHaveAttribute(
		'href',
		server + '/album/' + ids[0]
	);
	await expect(list.getByRole('button', { name: 'Watch actions for Harbour' })).toHaveCount(0);
	const modal = page.getByRole('dialog');
	for (const [action, suffix] of [
		['Check now', 'resume'],
		['Stop watching', 'stop'],
		['Resume watching', 'resume'],
		['Mark matches as seen', 'seen']
	] as const) {
		await list.getByRole('button', { name: 'Watch actions for Rivers' }).click();
		await modal.getByRole('button', { name: action, exact: true }).click();
		const prior = writes.length;
		await expect(modal.getByRole('button', { name: 'Go back' })).toBeVisible();
		expect(writes).toHaveLength(prior);
		await modal.getByRole('button', { name: action, exact: true }).click();
		await expect(modal).toHaveCount(0);
		expect(writes.at(-1)).toBe('POST /requests/wanted/' + ids[0] + '/' + suffix);
	}
	await expect(list.getByRole('link', { name: /new matches/ })).toHaveCount(0);
	await list.getByRole('button', { name: 'Watch actions for Moon' }).click();
	await modal.getByRole('button', { name: 'Go back' }).click();
	expect(writes.some((w) => w.startsWith('DELETE'))).toBe(false);
	await list.getByRole('button', { name: 'Watch actions for Moon' }).click();
	await modal.getByRole('button', { name: 'Remove watch' }).click();
	await expect(list.getByRole('button', { name: 'Moon', exact: true })).toHaveCount(0);
	expect(rows.map((r) => r.album_title)).toEqual(['Rivers', 'Mountains']);
	await list.getByRole('button', { name: 'Manage retries in Downloads' }).click();
	await expect(page.getByRole('tab', { name: 'Downloads', selected: true })).toBeVisible();
});
for (const role of ['admin', 'trusted'] as const) {
	test(role + ' confirms the scope before clearing finished watches', async ({ page }) => {
		const { list, rows, writes } = await connect(page, role);
		if (role === 'admin') await expect(list.getByText(/Watched for Sam/).first()).toBeVisible();
		await list.getByRole('button', { name: 'Clear finished watches' }).click();
		const modal = page.getByRole('dialog');
		await expect(modal).toContainText(
			role === 'admin' ? 'for everyone on this server' : 'your stopped and fulfilled watches'
		);
		await page.keyboard.press('Escape');
		expect(writes).toHaveLength(0);
		await list.getByRole('button', { name: 'Clear finished watches' }).click();
		await modal.getByRole('button', { name: 'Clear finished watches' }).click();
		await expect(page.getByText('2 finished watches removed.')).toBeVisible();
		expect(rows.map((r) => r.album_title)).toEqual(['Rivers']);
	});
}
