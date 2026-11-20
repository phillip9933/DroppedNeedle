import type { components } from '../../../../frontend/src/lib/api/v3/openapi';

type Schema = components['schemas'];
export type LibraryKind = 'albums' | 'artists' | 'songs';
export type LibraryFilter = {
	kind: LibraryKind;
	query: string;
	favorites: boolean;
	sort: string;
	rating: number;
	ratingMode: Schema['RatingMode'];
	formats: string[];
	formatMode: Schema['FormatMode'];
};
export type FilterSection = LibraryFilter & { id: string; name: string };
export const sorts = {
	albums: [
		['name', 'Album title'],
		['date_added', 'Recently added'],
		['artist', 'Artist'],
		['year', 'Release year']
	],
	artists: [
		['name', 'Artist name'],
		['album_count', 'Album count'],
		['date_added', 'Recently added']
	],
	songs: [
		['title', 'Song title'],
		['artist', 'Artist'],
		['album', 'Album'],
		['date_added', 'Recently added']
	]
} as const;

export const isFilteredSection = (id: string) => /^library-filter-[a-z0-9-]{1,64}$/i.test(id);
export function libraryFilter(value: Partial<LibraryFilter> = {}): LibraryFilter {
	const kind = value.kind === 'artists' || value.kind === 'albums' ? value.kind : 'songs';
	return {
		kind,
		query: typeof value.query === 'string' ? value.query.trim().slice(0, 150) : '',
		favorites: value.favorites === true,
		sort: sorts[kind].some(([key]) => key === value.sort) ? value.sort! : sorts[kind][0][0],
		rating:
			kind !== 'artists' &&
			value.rating &&
			Number.isInteger(value.rating) &&
			value.rating >= 1 &&
			value.rating <= 5
				? value.rating
				: 0,
		ratingMode: value.ratingMode === 'at_most' ? 'at_most' : 'at_least',
		formats:
			kind !== 'artists' && Array.isArray(value.formats)
				? [
						...new Set(
							value.formats
								.filter(
									(f): f is string => typeof f === 'string' && /^[a-z0-9][\w.+-]{0,31}$/i.test(f)
								)
								.map((f) => f.toLowerCase())
						)
					]
				: [],
		formatMode: value.formatMode === 'without' ? 'without' : 'with'
	};
}
export function filterFromFields(config: LibraryFilter, formats: string): LibraryFilter {
	const parts = [
		...new Set(
			formats
				.split(',')
				.map((value) => value.trim().toLowerCase())
				.filter(Boolean)
		)
	];
	const normalized = libraryFilter({ ...config, formats: parts });
	if (config.kind !== 'artists' && normalized.formats.length !== parts.length)
		throw new Error('Enter audio formats separated by commas, such as flac, mp3.');
	return normalized;
}

export function filterSummary(filter: LibraryFilter) {
	const kind = { songs: 'Songs', artists: 'Artists', albums: 'Albums' }[filter.kind];
	return [
		kind,
		filter.query ? '“' + filter.query + '”' : null,
		filter.favorites ? 'Favorites' : null,
		filter.rating
			? (filter.ratingMode === 'at_most' ? 'Up to ' : filter.rating === 5 ? '' : 'At least ') +
				filter.rating +
				(filter.rating === 1 ? ' star' : ' stars')
			: null,
		filter.formats.length
			? (filter.formatMode === 'without' ? 'Exclude ' : '') +
				filter.formats.join(', ').toUpperCase()
			: null
	]
		.filter(Boolean)
		.join(' · ');
}
