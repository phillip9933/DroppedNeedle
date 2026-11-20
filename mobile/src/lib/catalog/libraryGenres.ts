import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { DnError, getJson, type Session } from '../connection';
import type { PlayerTrack } from '../player';
import { localSong, path } from './catalog';
import { prepareLibraryQueue, queueSizeCheck } from './libraryQueue';

type Schema = components['schemas'];
type Name = [string, number];
interface Scan {
	after: string | null;
	seen: Set<string>;
	count: number;
	total: number;
	names: Map<string, Name>;
	done: boolean;
	updated: number;
	revision?: string;
}
const scans = new WeakMap<Session, Scan>();
const checks = new WeakMap<Session, { at: number; revision?: string }>();
const day = 24 * 60 * 60_000;
const empty = (revision?: string): Scan => ({
	after: null,
	seen: new Set(),
	count: 0,
	total: 0,
	names: new Map(),
	done: false,
	updated: Date.now(),
	revision
});
const key = (s: Session) =>
	s.userId ? 'dn.mobile.genres.v1.' + JSON.stringify([s.serverUrl, s.userId]) : undefined;
const folded = (s: string) => s.toLocaleLowerCase();
const tag = (t: Schema['TrackView']) => t.genre?.trim() ?? '';
export function displayTag(old: string, next: string) {
	// Prefer an existing capitalized spelling when case variants of one tag occur.
	return old === old.toLocaleLowerCase() && next !== next.toLocaleLowerCase() ? next : old;
}
function remember(session: Session, s: Scan) {
	const k = key(session);
	if (!k) return;
	try {
		localStorage.setItem(
			k,
			JSON.stringify({ ...s, seen: [...s.seen], names: [...s.names.values()] })
		);
	} catch {
		/* Current-session indexing also works when storage is full. */
	}
}
function restore(session: Session) {
	const k = key(session);
	if (!k) return;
	try {
		const v = JSON.parse(localStorage.getItem(k) ?? 'null');
		if (
			!v ||
			!Number.isSafeInteger(v.updated) ||
			!Number.isSafeInteger(v.count) ||
			v.count < 0 ||
			!Number.isSafeInteger(v.total) ||
			v.total < v.count ||
			!Array.isArray(v.names) ||
			!Array.isArray(v.seen) ||
			!v.seen.every((s: unknown) => typeof s === 'string') ||
			typeof v.done !== 'boolean' ||
			!(v.after === null || typeof v.after === 'string') ||
			!(v.revision === undefined || typeof v.revision === 'string')
		)
			return;
		const names = new Map<string, Name>();
		let count = 0;
		for (const entry of v.names) {
			if (
				!Array.isArray(entry) ||
				typeof entry[0] !== 'string' ||
				!Number.isSafeInteger(entry[1]) ||
				entry[1] <= 0
			)
				return;
			names.set(folded(entry[0]), [entry[0], entry[1]]);
			count += entry[1];
		}
		if (
			count !== v.count ||
			(v.done ? v.after !== null || v.count !== v.total : v.count > 0 && !v.after)
		)
			return;
		return { ...v, seen: new Set<string>(v.seen), names } as Scan;
	} catch {
		return;
	}
}
async function revisionFor(s: Session, signal: AbortSignal) {
	const old = checks.get(s);
	if (old && Date.now() - old.at < 60_000) return old.revision;
	let revision: string | undefined;
	try {
		const stats = await getJson<Schema['StatsView']>(s, path('/api/v3/library/stats'), signal);
		if (Number.isSafeInteger(stats.total_tracks) && stats.total_tracks >= 0)
			revision = JSON.stringify([stats.last_scan_at ?? null, stats.total_tracks]);
	} catch (e) {
		signal.throwIfAborted();
		if (e instanceof DnError && (e.status === 401 || e.status === 403)) throw e;
	}
	checks.set(s, { at: Date.now(), revision });
	return revision;
}
function page(session: Session, signal: AbortSignal, after: string | null, genre?: string) {
	return getJson<Schema['TrackListPage']>(
		session,
		path(
			'/api/v3/library/tracks',
			{},
			{
				limit: genre ? 48 : 500,
				sort: genre ? 'album' : 'title',
				order: 'asc',
				genre,
				after: after ?? undefined
			}
		),
		signal
	);
}

export async function readLibraryGenres(
	session: Session,
	signal: AbortSignal,
	progress?: (count: number, total: number) => void
): Promise<Name[]> {
	const revision = await revisionFor(session, signal);
	signal.throwIfAborted();
	let scan = scans.get(session) ?? restore(session);
	// Even servers that do not report scan timestamps can change tags without changing their track count.
	const reliable = revision && JSON.parse(revision)[0] != null;
	if (
		!scan ||
		(revision !== undefined && revision !== scan.revision) ||
		Date.now() - scan.updated > (reliable ? 30 * day : day)
	)
		scan = empty(revision);
	scans.set(session, scan);
	if (scan.count) progress?.(scan.count, scan.total);
	while (!scan.done) {
		const after = scan.after,
			result = await page(session, signal, after);
		signal.throwIfAborted();
		if (scan.done || scan.after !== after) continue;
		if (
			(scan.count && scan.total !== result.total) ||
			(result.next && (!result.items.length || scan.seen.has(result.next))) ||
			scan.count + result.items.length > result.total ||
			(!result.next && scan.count + result.items.length !== result.total)
		) {
			const fresh = empty(revision);
			scans.set(session, fresh);
			remember(session, fresh);
			throw Error('The library changed during genre indexing. Try again.');
		}
		for (const row of result.items) {
			const name = tag(row),
				id = folded(name),
				n = scan.names.get(id);
			if (n) {
				n[0] = displayTag(n[0], name);
				n[1]++;
			} else scan.names.set(id, [name, 1]);
		}
		scan.count += result.items.length;
		scan.total = result.total;
		scan.after = result.next ?? null;
		scan.done = !scan.after;
		scan.updated = Date.now();
		if (scan.after) scan.seen.add(scan.after);
		remember(session, scan);
		progress?.(scan.count, scan.total);
	}
	return Array.from(scan.names.values());
}

export async function genreTracksPage(
	session: Session,
	genre: string,
	after: string | null,
	signal: AbortSignal
) {
	const cursors = new Set<string>();
	let next = after;
	do {
		const result = await page(session, signal, next, genre || undefined);
		signal.throwIfAborted();
		const tracks = (genre ? result.items : result.items.filter((t) => !tag(t))).map((t) =>
			localSong(t)
		);
		next = result.next ?? null;
		if (next && (next === after || cursors.has(next)))
			throw Error('The library changed while reading this genre. Try again.');
		if (next) cursors.add(next);
		if (tracks.length || !next) return { tracks, next, total: genre ? result.total : undefined };
	} while (next);
	return { tracks: [], next: null, total: undefined };
}
export async function tracksInGenre(
	session: Session,
	genre: string,
	signal: AbortSignal,
	forQueue: boolean
) {
	if (genre)
		return prepareLibraryQueue(
			session,
			{ genre, sort: 'album', order: 'asc' },
			signal,
			undefined,
			forQueue
		);
	const out: PlayerTrack[] = [],
		seen = new Set<string>(),
		size = forQueue ? queueSizeCheck(session.serverUrl) : undefined;
	let next: string | null = null;
	do {
		const result = await genreTracksPage(session, genre, next, signal);
		for (const t of result.tracks) {
			size?.(t);
			out.push(t);
		}
		next = result.next;
		if (next && seen.has(next))
			throw Error('The library changed while reading this genre. Try again.');
		if (next) seen.add(next);
	} while (next);
	return out;
}
