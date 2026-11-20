import type { LibraryFilter } from '../boards/filteredSections';
import type { PlayerTrack } from '../player';

export type BrowseFilters = Omit<LibraryFilter, 'kind' | 'query'> & {
	q: string;
	order: 'asc' | 'desc';
};
export function requestFilters(f: BrowseFilters) {
	return {
		q: f.q.trim() || undefined,
		sort: f.sort,
		order: f.order,
		favorites: f.favorites ? 'true' : undefined,
		rating: f.rating || undefined,
		rating_mode: f.rating ? f.ratingMode : undefined,
		formats: f.formats.join(',') || undefined,
		format_mode: f.formats.length ? f.formatMode : undefined
	};
}

function folded(value: string) {
	return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}
export function matchesDeviceTrack(track: PlayerTrack, f: BrowseFilters, confirmed = false) {
	if (f.favorites && !(track.favorite ?? confirmed)) return false;
	if (f.rating) {
		const r = track.rating;
		if (
			r === undefined
				? !confirmed
				: r === 0 || (f.ratingMode === 'at_most' ? r > f.rating : r < f.rating)
		)
			return false;
	}
	if (f.formats.length) {
		if (!track.format) {
			if (!confirmed) return false;
		} else if (f.formats.includes(track.format.toLowerCase()) !== (f.formatMode === 'with'))
			return false;
	}
	if (!f.q.trim()) return true;
	const names = [folded(track.title), folded(track.artist), folded(track.album)];
	return folded(f.q)
		.trim()
		.split(/\s+/)
		.every((word) => names.some((s) => s.includes(word)));
}

export function deviceTrackOrder(f: Pick<BrowseFilters, 'sort' | 'order'>) {
	const dir = f.order === 'desc' ? -1 : 1;
	const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	return (a: PlayerTrack, b: PlayerTrack) => {
		if (f.sort === 'title')
			return dir * (compare(folded(a.title), folded(b.title)) || compare(a.id, b.id));
		if (f.sort === 'date_added')
			return dir * ((a.dateAdded ?? 0) - (b.dateAdded ?? 0) || compare(a.id, b.id));
		const artist = f.sort === 'artist' ? compare(folded(a.artist), folded(b.artist)) : 0;
		const album =
			artist ||
			compare(folded(a.album), folded(b.album)) ||
			compare(a.albumId ?? '', b.albumId ?? '');
		// DN keeps each album's disc and track sequence even when album order is descending.
		return (
			dir * album ||
			(a.discNumber ?? 0) - (b.discNumber ?? 0) ||
			(a.trackNumber ?? 0) - (b.trackNumber ?? 0) ||
			compare(a.id, b.id)
		);
	};
}
