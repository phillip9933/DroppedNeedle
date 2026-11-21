import { test, expect } from '@playwright/test';
import type { components } from '../../frontend/src/lib/api/v3/openapi';
import { localSignIn } from './fixtures/localSignIn';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { silentWav } from './fixtures/silentWav';

test('an opted-in phone accepts a paused queue then sends its live position to a peer', async ({
	page
}) => {
	type Schema = components['schemas'];
	const server = 'https://library.example/dn',
		remote = crypto.randomUUID(),
		receive = crypto.randomUUID();
	const tracks = ['one', 'two', 'one'].map((id, i) => ({
		id,
		title: 'Track ' + i,
		artist: 'Artist',
		album: 'Album'
	}));
	let command: Schema['DeviceCommand'] | undefined, sent: Schema['TransferQueue'] | undefined;
	let phone = '',
		starts = 0,
		importing = false;
	await page.route(server + '/api/v3/**', async (route) => {
		const request = route.request(),
			path = new URL(request.url()).pathname.replace('/dn/api/v3', '');
		const json = (value: unknown) => route.fulfill({ json: value });
		if (path === '/auth/providers') return json({ local: true, oidc: false });
		if (path === '/auth/login') return json({ token: 'phone-session' });
		expect(request.headers().authorization).toBe('Bearer phone-session');
		if (path === '/me') return json({ id: 'listener', display_name: 'Listener', role: 'user' });
		if (path.startsWith('/stream/local/'))
			return route.fulfill({ body: silentWav(60), contentType: 'audio/wav' });
		if (path === '/playback/devices/control') {
			const action = request.postDataJSON() as Schema['DeviceControlRequest'];
			if (action.target === remote) {
				expect(action.destination).toBe(phone);
				command = {
					id: receive,
					action: 'transfer',
					queue: { tracks, index: 2, position_ms: 14500, playing: false }
				};
				importing = true;
			} else {
				expect(action.target).toBe(phone);
				expect(action.destination).toBe(remote);
				command = { id: action.id, action: 'transfer' };
			}
			return route.fulfill({ status: 204 });
		}
		if (path === '/playback/devices/sync') {
			const hb = request.postDataJSON() as Schema['DeviceHeartbeat'];
			starts++;
			phone = hb.id;
			if (hb.receipt) {
				expect(hb.receipt.error).toBeFalsy();
				if (hb.receipt.queue) sent = hb.receipt.queue;
				command = undefined;
			}
			const devices = [
				{ ...hb, busy: false },
				{
					id: remote,
					name: 'Desktop',
					title: 'Track 2',
					playing: false,
					can_transfer: true,
					busy: false
				}
			];
			return json({ devices, command });
		}
		if (await emptyBoardRead(route)) return;
		throw Error('Unexpected DN operation ' + path);
	});
	await localSignIn(page, server);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Player handoff', exact: true }).click();
	expect(starts).toBe(0);
	await page.getByRole('checkbox', { name: /Allow other signed-in/ }).check();
	await page.getByRole('button', { name: 'Continue here' }).click();
	await expect.poll(() => importing).toBe(true);
	await expect(page.getByLabel('Playing on this device')).toHaveText(
		'This player · Track 2 · Paused'
	);
	await page.getByRole('button', { name: 'Move queue there' }).click();
	await expect.poll(() => sent?.index).toBe(2);
	expect(sent?.tracks.map((t) => t.id)).toEqual(['one', 'two', 'one']);
	expect(sent?.position_ms).toBeCloseTo(14500, -1);
	expect(sent?.playing).toBe(false);
	expect(JSON.stringify(sent)).not.toMatch(/phone-session|https:|streamUrl/);
});
