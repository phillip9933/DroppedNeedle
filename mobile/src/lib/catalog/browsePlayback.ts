import type { PlayerTrack } from '../player';
import { retainedHistory, refillSize, type LibraryContinuation } from '../player/libraryWindow';
import { queueSizeCheck, maxQueueTracks } from './libraryQueue';

export interface PageEnd {
	end: number;
	after: string | null;
}
export function tappedPlayback(
	server: string,
	tracks: PlayerTrack[],
	index: number,
	pages: PageEnd[],
	total?: number,
	filters?: Record<string, string | number | undefined>
) {
	if (index < 0 || index >= tracks.length) throw Error('This track is no longer in the list.');
	const last = pages.at(-1);
	const complete = last?.after === null && (total === undefined || tracks.length === total);
	if (!filters && tracks.length <= maxQueueTracks) {
		const check = queueSizeCheck(server);
		tracks.forEach(check);
		return { tracks, index, continuation: undefined };
	}
	const bounded = tracks.length > 200;
	const page = bounded ? (pages.find((p) => p.end >= index + refillSize) ?? last) : last;
	const start = bounded ? Math.max(0, index - retainedHistory) : 0;
	const end = page?.end ?? Math.min(tracks.length, index + refillSize);
	const selection = tracks.slice(start, end);
	const check = queueSizeCheck(server);
	selection.forEach(check);
	let continuation: LibraryContinuation | undefined;
	if (
		filters &&
		page &&
		total !== undefined &&
		Number.isSafeInteger(total) &&
		total >= page.end &&
		((!!page.after && page.end < total) || (!page.after && page.end === total)) &&
		(!complete || bounded)
	) {
		const query = Object.fromEntries(
			Object.entries(filters)
				.filter(([, v]) => v !== undefined)
				.map(([k, v]) => [k, String(v)])
		);
		continuation = { filters: query, loaded: page.end, after: page.after, total };
	}
	return { tracks: selection, index: index - start, continuation };
}
