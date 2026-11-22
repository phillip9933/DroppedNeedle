import { expect, test } from '@playwright/test';
import { localSignIn } from './fixtures/localSignIn';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { seedOfflineMusic } from './fixtures/offlineMusic';

test('nested genre rules include secondary DN tags, apply exact personal ratings and respect later offline rating edits', async ({
	page
}) => {
	const server = 'https://smart-rules.example/dn';
	const name = 'Four stars in rock or punk';
	const titles = ['Alternate', 'B-side', 'Cover', 'Demo', 'Encore'];
	await page.addInitScript(
		({ server, name }) => {
			const id = 'smart-secondary';
			localStorage.setItem(
				'dn.mobile.smart-playlists.v1.' + JSON.stringify([server, 'listener']) + '.' + id,
				JSON.stringify({
					id,
					name,
					limit: 10000,
					order: 'asc',
					rules: {
						match: 'all',
						rules: [
							{ field: 'rating', op: 'is', value: 4 },
							{
								match: 'any',
								rules: [
									{ field: 'genre', op: 'is', value: 'Rock' },
									{ field: 'genre', op: 'is', value: 'Punk' }
								]
							},
							{ field: 'year', op: 'atLeast', value: 1990 }
						]
					}
				})
			);
		},
		{ server, name }
	);
	const songs = titles.map((title, i) => ({
		id: 't' + i,
		title,
		genre: 'Jazz',
		year: i === 2 ? 1970 : 2000,
		album_title: 'Record',
		artist_name: 'Band',
		art_missing: true
	}));
	const calls = new Set<string>();
	await page.route(server + '/api/v3/**', async (route) => {
		const url = new URL(route.request().url()),
			path = url.pathname.split('/api/v3/')[1];
		if (path === 'auth/providers') return route.fulfill({ json: { local: true, oidc: false } });
		if (path === 'auth/login') return route.fulfill({ json: { token: 'fixture' } });
		if (path === 'me')
			return route.fulfill({ json: { id: 'listener', display_name: 'Listener', role: 'user' } });
		if (path === 'ratings/lookup') {
			const ids = route.request().postDataJSON().track_ids as string[];
			return route.fulfill({
				json: { tracks: Object.fromEntries(ids.map((id) => [id, id === 't1' ? 5 : 4])) }
			});
		}
		if (path === 'library/tracks' && url.searchParams.has('rating')) {
			const genre = url.searchParams.get('genre') || '';
			calls.add(genre);
			const tracks =
				genre === 'Rock'
					? [songs[0], songs[1], songs[2]]
					: genre === 'Punk'
						? [songs[0], songs[3]]
						: songs;
			const offset = Number(url.searchParams.get('after') ?? 0);
			return route.fulfill({
				json: {
					items: tracks.slice(offset, offset + 2),
					next: offset + 2 < tracks.length ? String(offset + 2) : null,
					total: tracks.length
				}
			});
		}
		if (await emptyBoardRead(route)) return;
		return route.fulfill({ status: 404 });
	});
	await localSignIn(page, server);
	const button = (s: string) => page.getByRole('button', { name: s, exact: true });
	await button('Library').click();
	await button('Browse Playlists').click();
	await button(name).click();
	await expect(button('Play Alternate')).toBeVisible();
	await expect(button('Play Demo')).toBeVisible();
	for (const title of ['B-side', 'Cover', 'Encore'])
		await expect(button('Play ' + title)).toHaveCount(0);
	expect([...calls].sort()).toEqual(['', 'Punk', 'Rock']);
	await button('Back to Playlists').click();
	await seedOfflineMusic(
		page,
		server,
		'listener',
		true,
		songs.map((t) => ({
			origin: 'downloaded',
			track: {
				id: t.id,
				title: t.title,
				artist: 'Band',
				album: 'Record',
				genre: t.genre,
				year: t.year,
				rating: t.id === 't3' ? 3 : undefined,
				streamUrl: '/api/v3/stream/local/' + t.id
			}
		}))
	);
	await expect(page.getByRole('group', { name: 'Offline availability' })).toBeVisible();
	await button(name).click();
	await expect(button('Play Alternate')).toBeVisible();
	for (const title of ['B-side', 'Cover', 'Demo', 'Encore'])
		await expect(button('Play ' + title)).toHaveCount(0);
});

test('renaming a legacy listening-history playlist offline preserves its verified matches after saving the new rule groups', async ({
	page
}) => {
	const server = 'https://legacy-rules.example/dn';
	await page.route(server + '/api/v3/**', async (route) => {
		const path = new URL(route.request().url()).pathname.split('/api/v3/')[1];
		if (path === 'auth/providers') return route.fulfill({ json: { local: true, oidc: false } });
		if (path === 'auth/login') return route.fulfill({ json: { token: 'fixture' } });
		if (path === 'me')
			return route.fulfill({ json: { id: 'listener', display_name: 'Listener', role: 'user' } });
		if (await emptyBoardRead(route)) return;
		return route.fulfill({ status: 404 });
	});
	await localSignIn(page, server);
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	await button('Library').click();
	await button('Browse Playlists').click();
	await page.evaluate((server) => {
		const id = 'smart-history';
		const key = 'dn.mobile.smart-playlists.v1.' + JSON.stringify([server, 'listener']) + '.' + id;
		const definition = JSON.stringify({
			kind: 'songs',
			query: '',
			favorites: false,
			sort: 'title',
			rating: 5,
			ratingMode: 'at_least',
			formats: [],
			formatMode: 'with',
			id,
			name: 'Five-star repeats',
			limit: 50,
			order: 'asc',
			minPlays: 2
		});
		localStorage.setItem(key, definition);
		localStorage.setItem(
			key + '.matches',
			JSON.stringify({
				definition,
				ids: ['a'],
				stats: { a: { play_count: 3 }, b: { play_count: 1 } }
			})
		);
	}, server);
	await seedOfflineMusic(
		page,
		server,
		'listener',
		true,
		['a', 'b'].map((id) => ({
			origin: 'downloaded',
			track: {
				id,
				title: id === 'a' ? 'Keep this track' : 'Only played once',
				artist: 'Band',
				album: 'Record',
				streamUrl: '/api/v3/stream/local/' + id
			}
		}))
	);
	await button('More options for Five-star repeats').click();
	await page.getByRole('dialog').getByRole('button', { name: 'Edit smart playlist' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Playlist name').fill('Offline repeats');
	await dialog.getByRole('button', { name: 'Save playlist' }).click();
	await button('Offline repeats').click();
	await expect(button('Play Keep this track')).toBeVisible();
	await expect(button('Play Only played once')).toHaveCount(0);
});
