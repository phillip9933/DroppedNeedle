import { expect, test, type Page } from '@playwright/test';

test('a listener can edit their DN profile, save visibility and revoke a different device', async ({
	page
}) => {
	const server = 'https://library.example/dn';
	let display = 'Listener',
		visibility = 'offline',
		removed = false;
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			p = new URL(req.url()).pathname.slice('/dn/api/v3'.length);
		const json = (obj: unknown) => route.fulfill({ json: obj });
		if (p === '/home') return json({ sections: [] });
		if (p === '/auth/providers') return json({ local: true, oidc: false });
		if (p === '/auth/login') return json({ token: 'fixture' });
		expect(req.headers().authorization).toBe('Bearer fixture');
		if (p === '/library/albums') return json({ items: [], next: null });
		if (p === '/me') {
			if (req.method() === 'PATCH') display = req.postDataJSON().display_name;
			return json({ id: 'demo', role: 'user', display_name: display });
		}
		if (p === '/me/scrobble-preferences') {
			if (req.method() === 'PUT') {
				expect(req.postDataJSON()).toEqual({ now_playing_visibility: 'track_hidden' });
				visibility = 'track_hidden';
			}
			return json({
				now_playing_visibility: visibility,
				scrobble_to_lastfm: false,
				scrobble_to_listenbrainz: true
			});
		}
		if (p === '/auth/sessions')
			return json({
				sessions: [
					{ id: 'current', label: 'Phone', current: true, last_seen_at: 1000 },
					...(removed
						? []
						: [{ id: 'old', label: 'Old tablet', current: false, last_seen_at: 1000 }])
				]
			});
		if (p === '/auth/sessions/old' && req.method() === 'DELETE') {
			removed = true;
			return route.fulfill({ status: 204 });
		}
		throw Error('Unexpected account operation ' + p);
	});
	await openAccount(page, server);
	await expect(page.getByText('Library health and scans')).toHaveCount(0);
	const newName = '🎵'.repeat(40);
	await page.getByLabel('Display name').fill('a'.repeat(65));
	await expect(page.getByRole('button', { name: 'Save name' })).toBeDisabled();
	await page.getByLabel('Display name').fill(newName);
	await page.getByRole('button', { name: 'Save name' }).click();
	await expect(page.getByRole('status')).toHaveText('Display name saved.');
	await page.getByRole('button', { name: 'Listening', exact: true }).click();
	await page.getByLabel('Now playing visibility').selectOption('track_hidden');
	await page.getByRole('button', { name: 'Save preferences' }).click();
	await expect(page.getByRole('status')).toHaveText('Listening preferences saved.');
	await page.getByRole('button', { name: 'Devices', exact: true }).click();
	await page.getByRole('button', { name: 'Sign out Old tablet' }).click();
	await page.getByRole('button', { name: 'Confirm sign out' }).click();
	await expect(page.getByText('Old tablet', { exact: true })).toHaveCount(0);
	expect(removed).toBeTruthy();
	expect(display).toBe(newName);
});

async function openAccount(page: Page, server: string) {
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('demo');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByText('Account on DroppedNeedle', { exact: true }).click();
}

test('an administrator can inspect library health and confirm an incremental scan', async ({
	page
}) => {
	const server = 'https://library.example/dn';
	let started = false;
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			p = new URL(req.url()).pathname.slice('/dn/api/v3'.length);
		const json = (obj: unknown) => route.fulfill({ json: obj });
		if (p === '/home') return json({ sections: [] });
		if (p === '/auth/providers') return json({ local: true, oidc: false });
		if (p === '/auth/login') return json({ token: 'fixture' });
		expect(req.headers().authorization).toBe('Bearer fixture');
		if (p === '/me') return json({ id: 'demo', role: 'admin', display_name: 'Demo' });
		if (p === '/library/albums') return json({ items: [], next: null });
		if (p === '/settings/library') return json({ enabled: true, policy_revision: 'revision-1' });
		if (p === '/library/stats')
			return json({ total_artists: 10, total_albums: 20, total_tracks: 100 });
		if (p === '/library/scan/runs/current')
			return json({ active: null, queued: started ? { state: 'queued' } : null });
		if (p === '/library/scan/runs/history') return json({ items: [], next: null });
		if (p === '/library/scan/runs' && req.method() === 'POST') {
			expect(req.postDataJSON()).toEqual({
				kind: 'incremental',
				scope_ids: [],
				expected_policy_revision: 'revision-1'
			});
			started = true;
			return json({ disposition: 'queued' });
		}
		throw Error('Unexpected admin operation ' + p);
	});
	await openAccount(page, server);
	await page.getByText('Library health and scans', { exact: true }).click();
	await expect(page.getByText('10 artists · 20 albums · 100 songs')).toBeVisible();
	await page.getByRole('button', { name: 'Scan for changes' }).click();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(started).toBeFalsy();
	await page.getByRole('button', { name: 'Scan for changes' }).click();
	await page.getByRole('button', { name: 'Start scan' }).click();
	await expect(page.getByRole('status')).toHaveText('Scan queued.');
	await expect(page.getByText('No scan running. A scan is queued.')).toBeVisible();
});
