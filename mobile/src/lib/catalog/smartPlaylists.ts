import { accountId } from '../boards/layout';
import { libraryFilter } from '../boards/filteredSections';
import { postJson, type Session } from '../connection';
import type { PlayerTrack } from '../player';
import { trackPages } from './libraryQueue';
import { localSong, path } from './catalog';
import { deviceTrackOrder, foldSearchText } from './trackFilters';
import { savedMatches, storeMatches, type SmartMatches } from './smartMatchCache';
import {
	maxSmartTracks,
	playlistRules,
	validRules,
	planRules,
	matchesRules,
	trackMatches,
	type PlaylistFilters,
	type PlayStat
} from './smartRules';
import { offlineInventory } from '../offline/media';
import type { components } from '../../../../frontend/src/lib/api/v3/openapi';

export type SmartPlaylist = PlaylistFilters & {
	id: string;
	name: string;
	limit: number;
	order: 'asc' | 'desc';
};
function optionalInteger(value: unknown, min: number, max: number, name: string) {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
		throw Error(name + ' must be a whole number between ' + min + ' and ' + max + '.');
	return value;
}

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
	if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > maxSmartTracks)
		throw new Error('Choose a playlist limit between 1 and 10,000 tracks.');
	const genre = value.genre?.trim();
	if (genre && genre.length > 160) throw Error('Choose a genre up to 160 characters.');
	const yearFrom = optionalInteger(value.yearFrom, 1, 9999, 'Earliest year');
	const yearTo = optionalInteger(value.yearTo, 1, 9999, 'Latest year');
	const minPlays = optionalInteger(value.minPlays, 0, 1_000_000, 'Minimum plays');
	const maxPlays = optionalInteger(value.maxPlays, 0, 1_000_000, 'Maximum plays');
	const notPlayedDays = optionalInteger(value.notPlayedDays, 1, 36_500, 'Days since last play');
	if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo)
		throw Error('Earliest year must come before or match latest year.');
	if (minPlays !== undefined && maxPlays !== undefined && minPlays > maxPlays)
		throw Error('Minimum plays cannot exceed maximum plays.');
	return {
		...libraryFilter({ ...value, kind: 'songs' }),
		id: value.id,
		name,
		limit,
		order: value.order === 'desc' ? 'desc' : 'asc',
		genre: genre || undefined,
		yearFrom,
		yearTo,
		minPlays,
		maxPlays,
		notPlayedDays,
		rules: value.rules === undefined ? undefined : validRules(value.rules)
	};
}
function matchDefinition(playlist: SmartPlaylist) {
	return JSON.stringify([playlist.sort, playlist.order, playlist.limit, playlistRules(playlist)]);
}
function sameDefinition(stored: string | null | undefined, expected: string) {
	if (stored === expected) return true;
	if (!stored?.startsWith('{')) return false;
	try {
		// The first on-device cache stored the entire playlist, including its display name.
		return matchDefinition(rule(JSON.parse(stored))) === expected;
	} catch {
		return false;
	}
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
	// During edits, keep observed per-track history and ratings for offline evaluation.
	// Verified membership is reused only when the current rules, sort and limit still agree.
	if (!previous || !stored) {
		localStorage.removeItem(key + '.matches');
		await storeMatches(key);
	}
}

export async function smartPlaylistTracks(
	session: Session,
	playlist: SmartPlaylist,
	signal = new AbortController().signal,
	availableTracks?: PlayerTrack[],
	onPage?: (newMatches: PlayerTrack[]) => void
) {
	const item = rule(playlist),
		root = playlistRules(item);
	const { params, assured, mandatory, leaves } = planRules(root);
	const key = (await prefix(session)) + item.id,
		definition = matchDefinition(item);
	const current = () => sameDefinition(localStorage.getItem(key), definition);
	const now = Date.now() / 1000;
	signal.throwIfAborted();
	if (availableTracks) {
		const cache = await savedMatches(key);
		signal.throwIfAborted();
		const same = sameDefinition(cache?.definition, definition);
		const confirmed = new Set(same ? cache?.ids : []);
		const observedGenres = new Set(cache?.genreFields);
		const result = availableTracks
			.filter((track) => {
				const id = track.id;
				const storedRating = cache?.ratings?.[id];
				const rated =
					track.rating === undefined && typeof storedRating === 'number'
						? { ...track, rating: storedRating }
						: track;
				const genres = cache?.genres?.[id];
				return matchesRules(root, (r) => {
					const verified = confirmed.has(id) && mandatory.has(r);
					// TrackView only carries the first genre. DN matches against every tag.
					if (r.field === 'genre' && verified && assured.has(r)) return true;
					return trackMatches(
						r,
						rated,
						cache?.stats?.[id],
						now,
						verified,
						r.field === 'genre' &&
							Array.isArray(genres) &&
							(observedGenres.has(foldSearchText(String(r.value))) || (same && !assured.has(r)))
							? new Set(genres)
							: undefined
					);
				});
			})
			.sort(deviceTrackOrder(item))
			.slice(0, item.limit);
		if (result.length) onPage?.(result);
		return result;
	}

	const needsStats = leaves.some((r) => r.field === 'plays' || r.field === 'lastPlayed');
	const needsRatings = leaves.some((r) => r.field === 'rating' && !assured.has(r));
	const filters = { ...params, sort: item.sort, order: item.order };
	const localIds =
		(needsStats || needsRatings || leaves.some((r) => r.field === 'genre' && !assured.has(r))) &&
		session.userId
			? (await offlineInventory(session).catch(() => undefined))?.byId
			: undefined;
	// Each filtered listing is a subsequence of the same DN sort order. Keep its next ID
	// and advance only when the main listing reaches it, including for secondary genre tags.
	const byGenre = new Map<
		string,
		{ peek: () => Promise<string | undefined>; advance: () => void }
	>();
	for (const r of leaves) {
		if (r.field !== 'genre' || assured.has(r)) continue;
		const name = String(r.value),
			genre = foldSearchText(name);
		if (byGenre.has(genre)) continue;
		const pages = trackPages(session, { ...filters, genre: name }, signal);
		let ids: string[] = [],
			index = 0,
			done = false;
		const peek = async () => {
			while (!done && index === ids.length) {
				const next = await pages.next();
				done = !!next.done;
				ids = next.done ? [] : next.value.items.map((row) => row.id);
				index = 0;
			}
			return ids[index];
		};
		byGenre.set(genre, {
			peek,
			advance: () => {
				index++;
			}
		});
	}
	const matches: PlayerTrack[] = [];
	const history: Record<string, PlayStat> = Object.create(null);
	const ratings: Record<string, number> = Object.create(null);
	const genres: Record<string, string[]> = Object.create(null);
	const batchSize = leaves.every((r) => assured.has(r)) ? Math.min(200, item.limit) : 200;
	for await (const page of trackPages(
		session,
		{ ...filters, include_play_stats: needsStats ? 'true' : undefined },
		signal,
		batchSize
	)) {
		if (needsStats && !page.play_stats)
			throw Error('Update your DN server to use play count and last-played rules.');
		const lookup =
			needsRatings && page.items.length
				? await postJson<components['schemas']['RatingLookupResponse']>(
						session,
						path('/api/v3/ratings/lookup'),
						{ track_ids: page.items.map((t) => t.id) },
						signal
					)
				: undefined;
		if (needsRatings && page.items.length && (!lookup?.tracks || typeof lookup.tracks !== 'object'))
			throw Error('DN did not return track ratings.');
		signal.throwIfAborted();
		const batch: PlayerTrack[] = [];
		for (const row of page.items) {
			const track: PlayerTrack = localSong(row);
			if (lookup) track.rating = Object.hasOwn(lookup.tracks, row.id) ? lookup.tracks[row.id] : 0;
			const played = page.play_stats
				? Object.hasOwn(page.play_stats, row.id)
					? page.play_stats[row.id]
					: { play_count: 0 }
				: undefined;
			const tags = new Set<string>();
			for (const [genre, cursor] of byGenre) {
				if ((await cursor.peek()) === row.id) {
					tags.add(genre);
					cursor.advance();
				}
			}
			const hit = matchesRules(
				root,
				(r) => assured.has(r) || trackMatches(r, track, played, now, false, tags)
			);
			if (hit || localIds?.has(row.id)) {
				if (played) history[row.id] = played;
				if (track.rating !== undefined) ratings[row.id] = track.rating;
				if (byGenre.size) genres[row.id] = [...tags];
			}
			if (hit) {
				matches.push(track);
				batch.push(track);
			}
			if (matches.length === item.limit) break;
		}
		if (batch.length) onPage?.(batch);
		if (matches.length === item.limit) break;
	}
	if (matches.length < item.limit) {
		for (const cursor of byGenre.values())
			if ((await cursor.peek()) !== undefined)
				throw Error('The track list changed while loading. Try again.');
	}
	signal.throwIfAborted();
	if (current()) {
		const data: SmartMatches = {
			definition,
			ids: matches.map((t) => t.id),
			stats: needsStats ? history : undefined,
			ratings: needsRatings ? ratings : undefined,
			genres: byGenre.size ? genres : undefined,
			genreFields: byGenre.size ? [...byGenre.keys()] : undefined
		};
		await storeMatches(key, data, () => !signal.aborted && current());
	}
	signal.throwIfAborted();
	return matches;
}
