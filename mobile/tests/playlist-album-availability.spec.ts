import { chooseOption } from './fixtures/inlineChoice';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { touchRange } from './fixtures/touchRange';
import { localSignIn } from './fixtures/localSignIn';
import { seedOfflineMusic } from './fixtures/offlineMusic';
import { silentWav } from './fixtures/silentWav';
import type { OfflineOrigin } from '../src/lib/offline/tracks';

const server = 'https://partial-collection.example';
const secondServer = 'https://partial-mirror.example';
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const album = {
	id: 'paper',
	title: 'Paper worlds',
	artist_name: 'Ada',
	art_missing: true,
	track_count: 4
};
const songs = ['Dawn', 'Noon', 'Dusk', 'Night'].map((title, index) => ({
	id: 'file-' + index,
	title,
	artist: 'Ada',
	album: album.title,
	albumId: album.id,
	artistId: 'ada',
	trackNumber: index + 1,
	streamUrl: '/api/v3/stream/local/file-' + index
}));
const saved = songs.slice(0, 3).map((track, i) => ({
	track,
	origin: (['downloaded', 'automatic', 'cached'] as OfflineOrigin[])[i]
}));
const playlist = {
	id: 'repeat',
	name: 'On repeat',
	is_owner: true,
	can_edit: true,
	can_delete: true,
	is_redacted: false,
	cover_urls: [],
	track_count: 5
};
async function connect(page: Page, totals: Record<string, number> = {}) {
	await page.setViewportSize({ width: 320, height: 780 });
	const paths: string[] = [],
		attempts: string[] = [],
		edits: { track_id: string; new_position: number }[] = [];
	const entries = [0, -1, 1, 3, 0].map((n, i) => ({
		id: 'e' + i,
		track_name: songs[n]?.title ?? 'Remote interlude',
		artist_name: 'Ada',
		album_name: album.title,
		source_type: n < 0 ? 'plex' : 'local',
		track_source_id: n < 0 ? 'remote' : songs[n].id,
		library_file_id: n < 0 ? null : songs[n].id
	}));
	let blocked = false,
		owner = 'listener';
	const fixtureURL = (url: URL) =>
		[server, secondServer].includes(url.origin) && url.pathname.startsWith('/api/v3/');
	await page.route(fixtureURL, async (route) => {
		const path = new URL(route.request().url()).pathname.slice(7),
			send = (data: unknown) => route.fulfill({ json: data });
		if (path === '/auth/providers') return send({ local: true, oidc: false });
		if (path === '/auth/login') {
			owner = route.request().postDataJSON().username;
			return send({ token: 'fixture' });
		}
		if (path === '/me') return send({ id: owner, display_name: 'Listener', role: 'user' });
		if (blocked) {
			attempts.push(path);
			return route.abort();
		}
		paths.push(path);
		if (path === '/library/albums')
			return send({
				items: [{ ...album, track_count: totals[owner] ?? album.track_count }],
				total: 1,
				next: null
			});
		if (path === '/library/albums/match/paper')
			return send({
				items: songs.map((t) => ({
					id: t.id,
					title: t.title,
					artist_name: t.artist,
					album_title: t.album,
					album_id: t.albumId,
					disc_number: 1,
					track_number: t.trackNumber,
					art_missing: true
				})),
				total: 4,
				limit: 200,
				offset: 0
			});
		if (path === '/playlists') return send({ playlists: [playlist] });
		if (path === '/playlists/repeat') return send({ ...playlist, tracks: entries });
		if (path === '/playlists/repeat/tracks/reorder') {
			const edit = route.request().postDataJSON();
			edits.push(edit);
			const from = entries.findIndex((e) => e.id === edit.track_id);
			entries.splice(edit.new_position, 0, ...entries.splice(from, 1));
			return send({ status: 'ok', message: 'Moved', new_position: edit.new_position });
		}
		if (path === '/ratings/lookup') return send({ artists: {}, albums: {}, tracks: {} });
		if (path.endsWith('/lyrics')) return send({ lines: [] });
		if (path.startsWith('/stream/local/'))
			return route.fulfill({ contentType: 'audio/wav', body: silentWav() });
		if (await emptyBoardRead(route)) return;
		return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
	});
	await localSignIn(page, server);
	await seedOfflineMusic(page, server, 'listener', false, saved);
	await button(page, 'Library').click();
	return {
		paths,
		attempts,
		edits,
		block: () => {
			blocked = true;
		}
	};
}
const availability = (page: Page) =>
	page.getByRole('combobox', { name: 'Track availability', exact: true });
async function queue(page: Page) {
	await button(page, 'Show play queue').click();
	return page.locator('[data-part=play-queue]');
}

test('album details label every source, update without rereading DN and play only the selected matches', async ({
	page
}) => {
	await page.addInitScript(() => {
		const original = IDBIndex.prototype.getAll;
		const testWindow = window as Window & { inventoryReads?: number };
		testWindow.inventoryReads = 0;
		IDBIndex.prototype.getAll = function (...args) {
			if (
				this.objectStore.transaction.db.name === 'dn.mobile.offline.v1' &&
				this.objectStore.name === 'tracks' &&
				this.name === 'scope'
			)
				testWindow.inventoryReads = (testWindow.inventoryReads ?? 0) + 1;
			return original.apply(this, args);
		};
	});
	const reads = () =>
		page.evaluate(() => (window as Window & { inventoryReads?: number }).inventoryReads ?? 0);
	const { paths } = await connect(page);
	await button(page, 'Browse Albums').click();
	await expect(button(page, album.title)).toBeVisible();
	const beforeDetail = await reads();
	await button(page, album.title).click();
	const list = page.locator('[data-album-sheet=true]');
	await expect(page.getByText('3 of 4 playable tracks available on this device.')).toBeVisible();
	expect(await reads()).toBe(beforeDetail + 1);
	for (const [i, status] of [
		'Downloaded',
		'Automatically saved',
		'Playback cache',
		'Online only'
	].entries())
		await expect(button(page, 'Play ' + songs[i].title)).toHaveAccessibleDescription(status);
	await chooseOption(availability(page), 'cached');
	await expect(list.locator('strong')).toHaveText(['Dusk']);
	await expect(button(page, 'Play Dusk')).toContainText('3');
	expect(await reads()).toBe(beforeDetail + 1);
	await seedOfflineMusic(page, server, 'listener', false, [{ track: songs[3], origin: 'cached' }]);
	await expect(page.getByText('4 of 4 playable tracks available on this device.')).toBeVisible();
	await expect(list.locator('strong')).toHaveText(['Dusk', 'Night']);
	await button(page, 'Select items').click();
	await button(page, 'Select loaded').click();
	await expect(page.getByText('2 selected')).toBeVisible();
	await seedOfflineMusic(page, server, 'listener', false, [
		{ track: songs[2], origin: 'downloaded' }
	]);
	await expect(page.getByText('1 selected')).toBeVisible();
	await expect(list.locator('strong')).toHaveText(['Night']);
	await button(page, 'Cancel selection').click();
	await chooseOption(availability(page), 'automatic');
	await button(page, 'Play album').click();
	await expect((await queue(page)).locator('strong')).toHaveText(['Noon']);
	expect(paths.filter((p) => p === '/library/albums/match/paper')).toHaveLength(1);
});

test('playlist filtering keeps duplicate occurrences, their playable positions and the complete editing order', async ({
	page
}) => {
	const state = await connect(page);
	await button(page, 'Browse Playlists').click();
	await button(page, playlist.name).click();
	await expect(page.getByText('3 of 4 playable tracks available on this device.')).toBeVisible();
	await expect(page.getByText('1 entry has no playable file in DN.')).toBeVisible();
	await expect(button(page, 'Remote interlude, unavailable in your library')).toBeDisabled();
	await chooseOption(availability(page), 'cached');
	await expect(page.getByText('No tracks match this availability.')).toBeVisible();
	await expect(button(page, 'Play playlist')).toBeDisabled();
	await chooseOption(availability(page), 'downloaded');
	const rows = page.locator('[data-entry]');
	await expect(rows).toHaveCount(2);
	await expect(rows.last()).toHaveAttribute('data-entry', 'e4');
	await button(page, 'Select items').click();
	await button(page, 'Select loaded').click();
	await expect(page.getByText('2 selected')).toBeVisible();
	await button(page, 'Cancel selection').click();
	await button(page, 'Edit playlist').click();
	await expect(rows).toHaveCount(5);
	const grip = button(page, 'Reorder Dawn, position 5');
	await grip.click();
	const move = page.getByRole('dialog', { name: 'Move Dawn' });
	await move.getByLabel('Track position', { exact: false }).fill('2');
	await move.getByRole('button', { name: 'Move track' }).click();
	await expect(rows.nth(1)).toHaveAttribute('data-entry', 'e4');
	expect(state.edits).toEqual([{ track_id: 'e4', new_position: 1 }]);
	await button(page, 'Done editing').click();
	await expect(availability(page)).toHaveAttribute('data-value', 'downloaded');
	await expect(rows).toHaveCount(2);
	await rows.last().getByRole('button', { name: 'Play Dawn', exact: true }).click();
	const playQueue = await queue(page);
	await expect(playQueue.locator('strong')).toHaveText(['Dawn', 'Dawn']);
	await expect(playQueue.locator('li').nth(1).locator('[aria-current=true]')).toBeVisible();
	expect(state.paths.filter((p) => p === '/playlists/repeat')).toHaveLength(2);
});

test('a device-filtered category carries its source into album and known playlist details and can switch locally', async ({
	page
}) => {
	const state = await connect(page);
	await button(page, 'Browse Playlists').click();
	await button(page, playlist.name).click();
	await expect(page.getByText('3 of 4 playable tracks available on this device.')).toBeVisible();
	await button(page, 'Back to playlists').click();
	await button(page, 'Back to Library').click();
	await chooseOption(
		page.getByRole('combobox', { name: 'Availability', exact: true }),
		'downloaded'
	);
	await seedOfflineMusic(page, server, 'listener', false, [
		{
			origin: 'downloaded',
			track: {
				...songs[0],
				id: 'extra',
				title: 'One take',
				album: 'Basement tape',
				albumId: 'basement'
			}
		}
	]);
	state.block();
	await button(page, 'Browse Albums').click();
	await button(page, 'Basement tape').click();
	await expect(
		page.getByText('1 track available on this device. Full library count unknown.')
	).toBeVisible();
	await button(page, 'Back to Albums').click();
	await button(page, album.title).click();
	await expect(availability(page)).toHaveAttribute('data-value', 'downloaded');
	await expect(button(page, 'Play Dawn')).toBeVisible();
	await expect(button(page, 'Play Noon')).toHaveCount(0);
	await chooseOption(availability(page), 'cached');
	await expect(button(page, 'Play Dusk')).toHaveAccessibleDescription('Playback cache');
	await expect(button(page, 'Play Dawn')).toHaveCount(0);
	await button(page, 'Back to Albums').click();
	await button(page, 'Back to Library').click();
	await button(page, 'Browse Playlists').click();
	await button(page, playlist.name).click();
	await expect(availability(page)).toHaveAttribute('data-value', 'downloaded');
	await expect(page.getByText('3 of 4 playable tracks available on this device.')).toBeVisible();
	await expect(button(page, 'Play Dawn')).toHaveCount(2);
	await chooseOption(availability(page), 'automatic');
	await expect(button(page, 'Play Noon')).toHaveAccessibleDescription('Automatically saved');
	await expect(button(page, 'Play Dawn')).toHaveCount(0);
	expect(state.attempts).toEqual([]);
	await button(page, 'Play all').click();
	await expect((await queue(page)).locator('strong')).toHaveText(['Noon']);
	expect(state.attempts.filter((p) => !p.endsWith('/lyrics') && p !== '/ratings/lookup')).toEqual(
		[]
	);
});

test('after a cold start each offline account sees its own last DN album count', async ({
	page
}) => {
	const observed = '2025-12-31T14:00:00.000Z';
	await page.clock.setFixedTime(new Date(observed));
	const state = await connect(page, { second: 2 });
	await button(page, 'Browse Albums').click();
	await expect(button(page, album.title)).toBeVisible();
	await localSignIn(page, server, 'second');
	await seedOfflineMusic(page, server, 'second', false, saved.slice(0, 1));
	await button(page, 'Library').click();
	await button(page, 'Browse Albums').click();
	await expect(button(page, album.title)).toBeVisible();

	for (const who of ['listener', 'second']) await seedOfflineMusic(page, server, who, true, []);
	await seedOfflineMusic(page, secondServer, 'listener', true, saved.slice(0, 1));
	state.block();
	await page.clock.setFixedTime(new Date('2026-01-02T14:00:00.000Z'));
	for (const [address, who, message] of [
		[server, 'listener', '3 tracks available on this device. DN last showed 4 playable tracks on'],
		[server, 'second', '1 track available on this device. DN last showed 2 playable tracks on'],
		[secondServer, 'listener', '1 track available on this device. Full library count unknown.']
	]) {
		// The web preview keeps credentials in memory. Only sign-in endpoints are available after reload.
		await page.context().setOffline(false);
		await page.reload();
		await page.getByLabel('Server address').fill(address);
		await button(page, 'Continue').click();
		await page.getByLabel('Username', { exact: true }).fill(who);
		await page.getByLabel('Password', { exact: true }).fill('fixture');
		await button(page, 'Sign in').click();
		await expect(page.getByRole('heading', { name: 'Offline music', exact: true })).toBeVisible();
		await page.context().setOffline(true);
		await button(page, 'Library').click();
		await button(page, 'Browse Albums').click();
		await button(page, album.title).click();
		await expect(page.getByText(message)).toBeVisible();
		const date = page.locator('.device-tracks time');
		if (address === server) await expect(date).toHaveAttribute('datetime', observed);
		else await expect(date).toHaveCount(0);
		if (who === 'second') {
			await seedOfflineMusic(page, server, who, true, saved);
			await expect(
				page.getByText('3 tracks available on this device. Full library count unknown.')
			).toBeVisible();
		}
	}
	expect(state.attempts.filter((path) => path.startsWith('/library/'))).toEqual([]);
});

test('held ranges work on album tracks, repeated playlist entries and songs saved to the device', async ({
	page
}) => {
	await connect(page);
	const touch = await touchRange(page);
	async function chooseRange(first: Locator, last: Locator, length: number) {
		await first.scrollIntoViewIfNeeded();
		await touch.hold(first);
		await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
		await touch.move(last);
		await expect(page.getByText(length + ' selected', { exact: true })).toBeVisible();
		await touch.lift();
	}
	await button(page, 'Browse Albums').click();
	await button(page, album.title).click();
	const albumRows = page.locator('[data-part=track-list]:visible [data-selectable]');
	await expect(albumRows).toHaveCount(4);
	await chooseRange(albumRows.nth(0), albumRows.nth(2), 3);
	await button(page, 'Select items').click();
	await button(page, 'Library').click();
	await button(page, 'Browse Playlists').click();
	await button(page, playlist.name).click();
	const rows = page.locator('[data-entry]:visible [data-selectable]');
	await expect(rows).toHaveCount(4);
	await chooseRange(rows.first(), rows.last(), 4);
	await expect(
		page.locator(
			'[data-entry=e0] button[aria-pressed=true], [data-entry=e4] button[aria-pressed=true]'
		)
	).toHaveCount(2);
	await button(page, 'Select items').click();
	await seedOfflineMusic(page, server, 'listener', false, [
		{ track: songs[3], origin: 'downloaded' }
	]);
	await button(page, 'Library').click();
	await button(page, 'Offline music').click();
	const offline = page.getByRole('region', { name: 'Offline music' });
	const local = offline.locator('[data-selectable]');
	await expect(local).toHaveCount(2);
	await chooseRange(local.first(), local.last(), 2);
	await offline.getByRole('button', { name: 'Select songs', exact: true }).click();
	await expect(offline.getByRole('group', { name: 'Selected offline songs' })).toHaveCount(0);
	await touch.close();
});
