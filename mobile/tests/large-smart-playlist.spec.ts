import { expect, test } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { localSignIn } from './fixtures/localSignIn';
import { silentWav } from './fixtures/silentWav';

test('a pinned smart playlist shows the first page while scanning and plays a song near its 10,000-track limit', async ({
	page
}) => {
	const server = 'https://smart-large.example/dn';
	const title = 'Large collection';
	const requested: number[] = [];
	const streams: string[] = [];
	let release!: () => void;
	const secondPage = new Promise<void>((resolve) => (release = resolve));
	await page.addInitScript(
		({ server, title }) => {
			const owner = JSON.stringify([server, 'listener']);
			const id = 'smart-many';
			localStorage.setItem(
				'dn.mobile.smart-playlists.v1.' + owner + '.' + id,
				JSON.stringify({
					id,
					name: title,
					genre: 'Rock',
					kind: 'songs',
					limit: 10000,
					sort: 'title',
					order: 'asc'
				})
			);
			localStorage.setItem(
				'dn.mobile.home-pins.v1.' + owner,
				JSON.stringify({
					pins: [{ id, title, kind: 'smart' }]
				})
			);
		},
		{ server, title }
	);
	await page.route(server + '/api/v3/**', async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.split('/api/v3/')[1];
		if (path === 'auth/providers') return route.fulfill({ json: { local: true, oidc: false } });
		if (path === 'auth/login') return route.fulfill({ json: { token: 'fixture' } });
		if (path === 'me')
			return route.fulfill({ json: { id: 'listener', display_name: 'Listener', role: 'user' } });
		if (path === 'library/tracks' && url.searchParams.get('genre') === 'Rock') {
			const offset = Number(url.searchParams.get('after') || 0);
			if (offset && requested.length === 1) await secondPage;
			requested.push(offset);
			const total = 12000;
			const size = Math.min(Number(url.searchParams.get('limit')), total - offset);
			const items = Array.from({ length: size }, (_, i) => {
				const id = String(i + offset + 1).padStart(5, '0');
				return {
					id,
					title: 'Recording ' + id,
					genre: 'Rock',
					artist_name: 'Artist',
					album_title: 'Album',
					duration_seconds: 90,
					art_missing: true
				};
			});
			return route.fulfill({
				json: { items, total, next: offset + size < total ? String(offset + size) : null }
			});
		}
		if (path.startsWith('stream/local/')) {
			streams.push(path.split('/').pop()!);
			return route.fulfill({ body: silentWav(), contentType: 'audio/wav' });
		}
		if (await emptyBoardRead(route)) return;
		return route.fulfill({ status: 404 });
	});
	await localSignIn(page, server);
	await page
		.getByRole('region', { name: 'Pinned to Home' })
		.getByRole('button', { name: new RegExp(title) })
		.click();
	const list = page.getByRole('list', { name: 'Tracks results' });
	try {
		await expect(
			list.getByRole('button', { name: 'Play Recording 00001', exact: true })
		).toBeVisible();
		expect(requested).toEqual([0]);
		const play = page.getByRole('button', { name: 'Play all', exact: true });
		await play.click();
		await page.getByRole('button', { name: 'Cancel preparation' }).click();
		await expect(play).toBeEnabled();
		expect(streams).toEqual([]);
	} finally {
		release();
	}
	await expect(list).toHaveAttribute('data-loaded', '10000', { timeout: 20000 });
	expect(Math.max(...requested)).toBeLessThan(10000);
	const target = 9500;
	await list.evaluate((grid, index) => {
		const main = grid.closest('main')!;
		main.scrollTop +=
			grid.getBoundingClientRect().top -
			main.getBoundingClientRect().top +
			(grid.clientHeight * index) / 10000;
	}, target - 1);
	await list.getByRole('button', { name: 'Play Recording 09500', exact: true }).click();
	await expect.poll(() => streams.includes('09500'), { timeout: 15000 }).toBe(true);
	expect(await list.getByRole('listitem').count()).toBeLessThan(100);
});
