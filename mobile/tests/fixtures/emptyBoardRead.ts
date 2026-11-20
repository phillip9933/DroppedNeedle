import type { Route } from '@playwright/test';

// Strict feature fixtures can serve other visible board shelves after their own routes.
export async function emptyBoardRead(route: Route) {
	const req = route.request();
	if (req.method() !== 'GET') return false;
	const path = new URL(req.url()).pathname.split('/api/v3/')[1];
	if (!path) return false;
	if (
		/^(library\/(artists|albums)\/[^/]+\/artwork|covers\/(artist|release-group)\/[^/]+)$/.test(path)
	) {
		await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
		return true;
	}
	switch (path) {
		case 'discover':
		case 'home':
			await route.fulfill({ json: { sections: [], refreshing: false } });
			return true;
		case 'me/section-prefs':
			await route.fulfill({ json: { pages: { home: [], discover: [] } } });
			return true;
		case 'library/albums':
		case 'library/artists':
		case 'library/tracks':
			await route.fulfill({ json: { items: [], next: null, total: 0 } });
			return true;
		case 'playlists':
			await route.fulfill({ json: { playlists: [] } });
			return true;
		default:
			return false;
	}
}
