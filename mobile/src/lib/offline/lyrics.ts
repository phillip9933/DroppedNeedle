import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { DnError, getJson, type Session } from '../connection';
import { path } from '../catalog/catalog';
import { preferredOffline } from './media';
import { companion } from './companions';
import { cachedValue, storeValue, removeCachedValue } from './viewedMedia';

type Lyrics = components['schemas']['LyricsView'];
const freshFor = 7 * 24 * 60 * 60 * 1000;
function readStored(source?: string): Lyrics | null {
	if (!source) return null;
	try {
		const lyrics = JSON.parse(source);
		return lyrics && Array.isArray(lyrics.lines) && typeof lyrics.is_synced === 'boolean'
			? lyrics
			: null;
	} catch {
		return null;
	}
}

export async function trackLyrics(
	session: Session,
	track: string,
	signal: AbortSignal,
	refresh: boolean
) {
	const stored = await cachedValue(session, 'lyrics', track).catch(() => undefined);
	const prepared = stored?.source
		? undefined
		: await companion(session, 'lyrics', track).catch(() => undefined);
	const lyrics = readStored(stored?.source ?? prepared);
	signal.throwIfAborted();
	if (!navigator.onLine || (await preferredOffline(session).catch(() => false))) {
		if (prepared === 'null') return null;
		if (!lyrics) throw new Error('Lyrics for this track have not been saved on this device.');
		return lyrics;
	}
	if (!refresh && stored?.fetched && Date.now() - stored.fetched < freshFor && lyrics)
		return lyrics;
	try {
		const next = await getJson<Lyrics>(
			session,
			path('/api/v3/library/tracks/{id}/lyrics', { id: track }),
			signal
		);
		signal.throwIfAborted();
		if (stored)
			await storeValue(session, 'lyrics', track, JSON.stringify(next), stored.revision).catch(
				() => {}
			);
		return next;
	} catch (cause) {
		signal.throwIfAborted();
		if (cause instanceof DnError && cause.status === 404) {
			if (stored?.source)
				await removeCachedValue(session, 'lyrics', track, stored.revision).catch(() => {});
			return null;
		}
		if (lyrics && !refresh && (!(cause instanceof DnError) || cause.status >= 500)) return lyrics;
		throw cause;
	}
}
