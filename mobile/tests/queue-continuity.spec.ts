import { expect, test } from '@playwright/test';
import { silentWav } from './fixtures/silentWav';
import { resolve } from 'node:path';
import type { PlaybackBridge, PlayerTrack } from '../src/lib/player';

declare global {
	interface Window {
		continuityPlayer: PlaybackBridge;
		continuityTracks: PlayerTrack[];
	}
}
const server = 'https://continuity.example/dn';
const access = { serverUrl: server, token: 'test', userId: 'one' };

let bundle = '';
test.beforeAll(async () => {
	const { build } = await import('vite');
	const built = await build({
		configFile: false,
		logLevel: 'silent',
		build: {
			write: false,
			lib: {
				entry: resolve('src/lib/player/browser.ts'),
				formats: ['es'],
				fileName: 'queue-fixture'
			},
			rollupOptions: { output: { inlineDynamicImports: true } }
		}
	});
	const output = Array.isArray(built) ? built[0] : built;
	if (!('output' in output) || output.output[0].type !== 'chunk')
		throw Error('Missing browser player fixture.');
	bundle = output.output[0].code;
});
test.beforeEach(async ({ page }) => {
	await page.route('**/queue-fixture.js', (route) =>
		route.fulfill({ contentType: 'application/javascript', body: bundle })
	);
	await page.route(server + '/api/v3/stream/local/**', (route) =>
		route.fulfill({
			contentType: 'audio/wav',
			body: silentWav()
		})
	);
	await page.goto('/');
	await page.evaluate(async (server) => {
		const source = '/queue-fixture.js';
		window.continuityPlayer = (await import(source)).browserPlayer();
		window.continuityTracks = ['one', 'two', 'one', 'three', 'four'].map((id, occurrence) => ({
			id,
			title: String(occurrence),
			artist: 'Artist',
			album: 'Album',
			duration: 60,
			genre: 'Jazz',
			recordingMbid: '10000000-0000-0000-0000-00000000000' + (id === 'one' ? 0 : occurrence),
			streamUrl: server + '/api/v3/stream/local/' + id
		}));
	}, server);
});
test('shuffle keeps the active occurrence and a paused replacement can restore its previous queue', async ({
	page
}) => {
	const result = await page.evaluate(async (access) => {
		const p = window.continuityPlayer,
			tracks = window.continuityTracks;
		await p.setQueue({ ...access, tracks, index: 0, playing: false });
		await p.command({ action: 'shuffleUpcoming' });
		const order = (await p.getState()).tracks.map((t) => t.title);
		await p.command({ action: 'skipTo', value: order.indexOf('2') });
		await p.command({ action: 'toggle' });
		await p.command({ action: 'seek', value: 0.05 });
		const original = await p.command({ action: 'shuffleUpcoming' });
		await p.setQueue({ ...access, tracks: [tracks[3]], index: 0, playing: false });
		const restored = await p.command({ action: 'restorePreviousQueue' });
		await p.setQueue({ ...access, userId: 'other', tracks: [tracks[3]], index: 0, playing: false });
		return { order, original, restored, other: await p.getState() };
	}, access);
	expect(result.order).not.toEqual(['0', '1', '2', '3', '4']);
	for (const s of [result.original, result.restored]) {
		expect(s.tracks.map((t) => t.title)).toEqual(['0', '1', '2', '3', '4']);
		expect(s.index).toBe(2);
		expect(s.playing).toBe(false);
		expect(s.position).toBeCloseTo(0.05);
	}
	expect(result.other.hasPreviousQueue).toBe(false);
});

test('two possible upcoming orders alternate for one listener and undo preserves the queue', async ({
	page
}) => {
	const orders = await page.evaluate(async (account) => {
		const player = window.continuityPlayer;
		const [first, second, , third] = window.continuityTracks;
		const tracks = [first, second, third];
		const start = async (userId: string) => {
			await player.setQueue({ ...account, userId, tracks, index: 0, playing: false });
			const order = await player.command({ action: 'shuffleUpcoming' });
			const undone = await player.command({ action: 'shuffleUpcoming' });
			return [order.tracks.map((t) => t.id), undone.tracks.map((t) => t.id)];
		};
		return [
			await start(account.userId),
			await start('another listener'),
			await start(account.userId)
		];
	}, access);
	const original = ['one', 'two', 'three'];
	expect(orders[0][0]).toEqual(['one', 'three', 'two']);
	expect(orders[1][0]).toEqual(orders[0][0]);
	expect(orders[2][0]).toEqual(original);
	expect(orders.map(([, undone]) => undone)).toEqual([original, original, original]);
});

test('autoplay asks DN for fresh local recordings and cancels a pending plan on pause', async ({
	page
}) => {
	const plans: unknown[] = [];
	await page.route(server + '/api/v3/discover/radio/plan', async (route) => {
		plans.push(route.request().postDataJSON());
		const row = {
			artist_name: 'Artist',
			artist_mbid: '10000000-0000-0000-0000-000000000005',
			track_name: 'Fresh',
			in_library: true,
			local_file_id: 'fresh',
			recording_mbid: '20000000-0000-0000-0000-000000000004'
		};
		await route.fulfill({
			json: {
				tracks: [
					{ ...row, local_file_id: 'one' },
					{
						...row,
						local_file_id: 'alternate',
						recording_mbid: '10000000-0000-0000-0000-000000000000'
					},
					{ ...row, in_library: false, local_file_id: 'remote' },
					row,
					row
				]
			}
		});
	});
	const first = await page.evaluate(async (access) => {
		const p = window.continuityPlayer,
			tracks = window.continuityTracks;
		await p.setQueue({ ...access, tracks, index: 4, playing: false });
		const off = await p.command({ action: 'next' });
		await p.command({ action: 'setAutoplay', value: 1 });
		const on = await p.command({ action: 'next' });
		return { off, on };
	}, access);
	expect(first.off.tracks).toHaveLength(5);
	expect(first.on.tracks.map((t) => t.id)).toEqual(['one', 'two', 'one', 'three', 'four', 'fresh']);
	expect(first.on.index).toBe(5);
	expect(plans).toHaveLength(1);
	expect(plans[0]).toMatchObject({
		seed_type: 'genre',
		seed_id: 'Jazz',
		mode: 'library',
		count: 25
	});
	await page.route(server + '/api/v3/discover/radio/plan', (route) => {
		plans.push(route.request().postDataJSON());
		return new Promise<void>((resolve) =>
			setTimeout(() => {
				void route
					.fulfill({ json: { tracks: [] } })
					.catch(() => {})
					.finally(resolve);
			}, 300)
		);
	});
	await page.evaluate(() => {
		void window.continuityPlayer.command({ action: 'next' });
	});
	await expect.poll(() => plans.length).toBe(2);
	const last = await page.evaluate(async () => {
		const p = window.continuityPlayer;
		await p.command({ action: 'setPlaying', value: 0 });
		return p.getState();
	});
	expect(last.playing).toBe(false);
	expect(last.autoplayProblem).toBeUndefined();
});

test('offline listening and a DN without radio keep the completed queue available', async ({
	page,
	context
}) => {
	let requests = 0;
	await page.route(server + '/api/v3/discover/radio/plan', (route) => {
		requests++;
		return route.fulfill({ status: 404, json: {} });
	});
	await page.evaluate(async (access) => {
		const p = window.continuityPlayer;
		await p.setQueue({ ...access, tracks: window.continuityTracks, index: 4, playing: false });
		await p.command({ action: 'setAutoplay', value: 1 });
	}, access);
	await context.setOffline(true);
	const offline = await page.evaluate(() => window.continuityPlayer.command({ action: 'next' }));
	expect(offline.autoplayProblem).toMatch(/online/i);
	expect(requests).toBe(0);
	await context.setOffline(false);
	const unsupported = await page.evaluate(() =>
		window.continuityPlayer.command({ action: 'retryAutoplay' })
	);
	expect(unsupported.autoplayProblem).toMatch(/404/);
	expect(unsupported.tracks).toHaveLength(5);
	expect(unsupported.index).toBe(4);
	expect(unsupported.playing).toBe(false);
	expect(requests).toBe(1);
});
