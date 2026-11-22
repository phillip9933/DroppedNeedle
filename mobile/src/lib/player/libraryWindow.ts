import { Capacitor } from '@capacitor/core';
import { getJson, type Session } from '../connection';
import { localSong, path } from '../catalog/catalog';
import {
	maxQueueTracks,
	prepareLibraryQueue,
	queueSizeCheck,
	type TrackPage
} from '../catalog/libraryQueue';
import type { PlayerTrack } from '../player';
import { shuffled, shuffleInPlace } from './shuffle';

export interface LibraryContinuation {
	smartSnapshot?: string;
	browserSmartShuffled?: boolean;
	filters: Record<string, string>;
	after: string | null;
	loaded: number;
	total: number;
}
export interface LibraryWindowStatus {
	extras?: number[];
	loaded: number;
	total: number;
	offset: number;
	more: boolean;
	problem?: string;
}
export const retainedHistory = 50,
	refillAt = 25,
	refillSize = 100;
const keys = new Set([
	'q',
	'sort',
	'order',
	'album_id',
	'artist_id',
	'genre',
	'formats',
	'format_mode',
	'rating',
	'rating_mode',
	'favorites'
]);
const changed = 'The matching library changed. Start Play all again to use the updated list.';
function query(filters: Record<string, string | number | undefined>) {
	return Object.fromEntries(
		Object.entries(filters)
			.filter(([k, v]) => keys.has(k) && v !== undefined)
			.map(([k, v]) => [k, String(v)])
	);
}
function read(
	session: Session,
	filters: Record<string, string>,
	after: string | null,
	limit: number,
	signal: AbortSignal
) {
	return getJson<TrackPage>(
		session,
		path('/api/v3/library/tracks', {}, { ...filters, limit, after: after ?? undefined }),
		signal
	);
}
function batch(
	page: TrackPage,
	filters: Record<string, string>,
	loaded: number,
	used: Set<string>,
	previous: string | null,
	limit: number
) {
	if (
		!Array.isArray(page.items) ||
		!Number.isSafeInteger(page.total) ||
		page.total < 0 ||
		page.items.length > limit ||
		(page.next != null &&
			(typeof page.next !== 'string' ||
				!page.next ||
				page.next.length > 8192 ||
				page.next === previous))
	)
		throw Error(changed);
	const tracks: PlayerTrack[] = [];
	for (const row of page.items) {
		if (
			typeof row.id !== 'string' ||
			!row.id ||
			row.id === '.' ||
			row.id === '..' ||
			typeof row.title !== 'string'
		)
			throw Error(changed);
		if (used.has(row.id)) continue;
		used.add(row.id);
		tracks.push(localSong(row));
	}
	const count = loaded + tracks.length;
	if (
		count > page.total ||
		(page.next ? count >= page.total || !tracks.length : count !== page.total)
	)
		throw Error(changed);
	return {
		tracks,
		continuation: { filters, after: page.next ?? null, loaded: count, total: page.total }
	};
}
export async function prepareLibraryPlayback(
	session: Session,
	filters: Record<string, string | number | undefined>,
	signal: AbortSignal,
	progress?: (n: number, total: number) => void
): Promise<{ tracks: PlayerTrack[]; continuation?: LibraryContinuation }> {
	signal.throwIfAborted();
	const params = query(filters),
		first = await read(session, params, null, 200, signal);
	signal.throwIfAborted();
	if (first.total <= maxQueueTracks || Capacitor.getPlatform() === 'ios') {
		const tracks = await prepareLibraryQueue(session, params, signal, progress, true, first);
		signal.throwIfAborted();
		if (params.sort !== 'random') return { tracks };
		const order = await shuffled(tracks, session, 'server');
		signal.throwIfAborted();
		return { tracks: order };
	}
	const result = batch(first, params, 0, new Set(), null, 200);
	result.tracks.forEach(queueSizeCheck(session.serverUrl));
	if (params.sort === 'random') {
		result.tracks = await shuffled(result.tracks, session, 'server');
		signal.throwIfAborted();
	}
	progress?.(result.tracks.length, first.total);
	return result;
}
// Browser playback keeps an immutable membership snapshot for as long as its queue or
// previous queue is live. Android stores the same pages with its encrypted playback archive.
const browserSnapshots = new WeakMap<LibraryContinuation, PlayerTrack[]>();
export function attachBrowserSmartSnapshot(cursor: LibraryContinuation, ordered: PlayerTrack[]) {
	browserSnapshots.set(cursor, ordered);
}

export function toggleBrowserSmartOrder(
	current: LibraryContinuation,
	displayed: PlayerTrack[],
	index: number,
	extras: Set<PlayerTrack>,
	upNext: Set<PlayerTrack>
) {
	const snapshot = browserSnapshots.get(current);
	if (!snapshot) throw Error('Reopen this smart playlist to continue playback.');
	const visible = new Set(displayed.filter((t) => !extras.has(t)).map((t) => t.smartIndex));
	const keep = displayed.filter((t, i) => i <= index || upNext.has(t) || extras.has(t));
	const queued = keep.filter((t) => !extras.has(t));
	const prefix = [
		...snapshot.slice(0, current.loaded).filter((t) => !visible.has(t.smartIndex)),
		...queued
	];
	const taken = new Set(prefix.map((t) => t.smartIndex));
	const remaining = snapshot
		.filter((t) => !taken.has(t.smartIndex))
		.sort((a, b) => a.smartIndex! - b.smartIndex!);
	const enabled = !current.browserSmartShuffled;
	if (enabled) shuffleInPlace(remaining);
	const loaded = prefix.length;
	const continuation = {
		...current,
		loaded,
		after: loaded < current.total ? String(loaded) : null,
		browserSmartShuffled: enabled
	};
	attachBrowserSmartSnapshot(continuation, [...prefix, ...remaining]);
	return { tracks: keep, continuation };
}

export async function nextLibraryBatch(
	session: Session,
	current: LibraryContinuation,
	retained: PlayerTrack[],
	signal: AbortSignal
) {
	if (current.smartSnapshot) {
		signal.throwIfAborted();
		const snapshot = browserSnapshots.get(current);
		if (!snapshot) throw Error('Reopen this smart playlist to continue playback.');
		const start = current.after === null ? 0 : current.loaded;
		const ordered =
			start === 0 && current.browserSmartShuffled === false
				? [...snapshot].sort((a, b) => a.smartIndex! - b.smartIndex!)
				: snapshot;
		const tracks = ordered.slice(start, start + refillSize);
		const loaded = start + tracks.length;
		const continuation = {
			...current,
			loaded,
			after: loaded === current.total ? null : String(loaded)
		};
		attachBrowserSmartSnapshot(continuation, ordered);
		return { tracks, continuation };
	}
	const restart = current.after === null;
	const p = await read(session, current.filters, current.after, refillSize, signal);
	signal.throwIfAborted();
	if (p.total !== current.total) throw Error(changed);
	const next = batch(
		p,
		current.filters,
		restart ? 0 : current.loaded,
		new Set(restart ? [] : retained.map((t) => t.id)),
		current.after,
		refillSize
	);
	const base = session.serverUrl.replace(/\/+$/, '');
	return {
		...next,
		tracks: next.tracks.map((t) => ({
			...t,
			streamUrl: base + t.streamUrl,
			artworkUrl: t.artworkUrl ? base + t.artworkUrl : undefined
		}))
	};
}
