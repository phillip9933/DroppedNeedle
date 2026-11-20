import { accountId } from '../boards/layout';
import { libraryFilter, type LibraryFilter } from '../boards/filteredSections';
import type { Session } from '../connection';
import type { PlayerTrack } from '../player';
import { maxQueueTracks, prepareLibraryQueue } from './libraryQueue';
import { deviceTrackOrder, matchesDeviceTrack, requestFilters } from './trackFilters';

export type SmartPlaylist = LibraryFilter & {
	id: string;
	name: string;
	limit: number;
	order: 'asc' | 'desc';
};

async function prefix(session: Session) {
	return (
		'dn.mobile.smart-playlists.v1.' +
		JSON.stringify([session.serverUrl, await accountId(session)]) +
		'.'
	);
}
function rule(value: Partial<SmartPlaylist>): SmartPlaylist {
	if (!value || typeof value.id !== 'string' || !/^smart-[a-z0-9-]{1,64}$/i.test(value.id))
		throw new Error('This smart playlist has an invalid ID.');
	const name = typeof value.name === 'string' ? value.name.trim() : '';
	if (!name || name.length > 64)
		throw new Error('Give the playlist a name of up to 64 characters.');
	const limit = value.limit;
	if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > maxQueueTracks)
		throw new Error('Choose a playlist limit between 1 and 2,000 tracks.');
	return {
		...libraryFilter({ ...value, kind: 'songs' }),
		id: value.id,
		name,
		limit,
		order: value.order === 'desc' ? 'desc' : 'asc'
	};
}
export async function readSmartPlaylists(session: Session): Promise<SmartPlaylist[]> {
	const namespace = await prefix(session);
	const lists: SmartPlaylist[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (!key?.startsWith(namespace) || key.endsWith('.matches')) continue;
		try {
			const item = rule(JSON.parse(localStorage.getItem(key) ?? 'null'));
			if (key === namespace + item.id) lists.push(item);
		} catch {
			// A damaged rule should not hide other playlists on the device.
		}
	}
	return lists.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function writeSmartPlaylist(
	session: Session,
	next: SmartPlaylist | null,
	previous?: SmartPlaylist
) {
	const stored = next && rule(next);
	const id = previous?.id ?? stored?.id;
	if (!id || (stored && stored.id !== id)) throw new Error('Choose a smart playlist to edit.');
	const key = (await prefix(session)) + id;
	const current = localStorage.getItem(key);
	if (
		previous
			? !current || JSON.stringify(rule(JSON.parse(current))) !== JSON.stringify(rule(previous))
			: !!current
	)
		throw new Error('This playlist changed. Reopen it before saving your edits.');
	if (stored) localStorage.setItem(key, JSON.stringify(stored));
	else localStorage.removeItem(key);
	localStorage.removeItem(key + '.matches');
}

export async function smartPlaylistTracks(
	session: Session,
	playlist: SmartPlaylist,
	signal = new AbortController().signal,
	availableTracks?: PlayerTrack[]
) {
	const item = rule(playlist);
	const filters = { ...item, q: item.query };
	const key = (await prefix(session)) + item.id;
	const definition = JSON.stringify(item);
	signal.throwIfAborted();
	if (availableTracks) {
		let ids: string[] = [];
		try {
			const known = JSON.parse(localStorage.getItem(key + '.matches') ?? 'null');
			if (known?.definition === definition && Array.isArray(known.ids)) ids = known.ids;
		} catch {
			/* Device metadata can still be filtered without a saved match list. */
		}
		const confirmed = new Set(ids);
		return availableTracks
			.filter((t) => matchesDeviceTrack(t, filters, confirmed.has(t.id)))
			.sort(deviceTrackOrder(filters))
			.slice(0, item.limit);
	}
	const tracks = await prepareLibraryQueue(
		session,
		requestFilters(filters),
		signal,
		undefined,
		true,
		{ limit: item.limit }
	);
	signal.throwIfAborted();
	try {
		// An offline copy can predate rating and format metadata. Remember only verified matches.
		if (localStorage.getItem(key) === definition)
			localStorage.setItem(
				key + '.matches',
				JSON.stringify({ definition, ids: tracks.map((t) => t.id) })
			);
	} catch {
		/* A full device can still play the online result. */
	}
	return tracks;
}
