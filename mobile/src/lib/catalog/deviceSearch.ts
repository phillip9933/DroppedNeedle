import type { Session } from '../connection';
import type { OfflineInventory } from '../offline/library';
import { availableTracks } from '../offline/library';
import {
	browsePage,
	defaultSort,
	localBrowse,
	type BrowseItem,
	type BrowseFilters,
	type BrowseSnapshot,
	type Category
} from './libraryBrowse';
import type { SearchScope } from './catalog';
import { foldSearchText } from './trackFilters';

export const deviceScopes = {
	tracks: 'Tracks',
	artists: 'Artists',
	albums: 'Albums',
	genres: 'Genres',
	playlists: 'Playlists'
} as const;
export type DeviceBucket = { category: Category; items: BrowseItem[] };
type SearchRow = { item: BrowseItem; text: string };
const order: Category[] = ['Tracks', 'Artists', 'Albums', 'Genres', 'Playlists'];
function searchable(category: Category, item: BrowseItem) {
	const names: (string | number | undefined)[] = [item.title];
	if (item.track)
		names.push(
			item.track.artist,
			item.track.albumArtist,
			item.track.album,
			item.track.genre,
			item.track.year
		);
	else if (category === 'Albums') names.push(item.subtitle, item.year);
	return foldSearchText(names.filter(Boolean).join('\u0000'));
}

// The immutable inventory includes completed files for one authenticated listener.
// Build normalized, sorted categories on demand and reuse them while the query changes.
export class DeviceSearchIndex {
	private readonly tracks;
	private readonly categories = new Map<Category, Promise<SearchRow[]>>();
	constructor(
		private readonly session: Session,
		inventory: OfflineInventory
	) {
		this.tracks = session.userId ? availableTracks(inventory) : [];
	}
	private async category(category: Category) {
		const known = this.categories.get(category);
		if (known) return known;
		const read = async () => {
			const filters: BrowseFilters = {
				q: '',
				sort: defaultSort[category],
				order: 'asc',
				favorites: false,
				rating: 0,
				ratingMode: 'at_least',
				formats: [],
				formatMode: 'with'
			};
			let items: BrowseItem[];
			if (!this.session.userId) return [];
			if (category === 'Playlists') {
				const snapshot: BrowseSnapshot = {};
				await browsePage(
					this.session,
					category,
					filters,
					null,
					new AbortController().signal,
					this.tracks,
					undefined,
					snapshot
				);
				items = snapshot.items ?? [];
			} else items = localBrowse(category, this.tracks, filters);
			return items.map((item) => ({ item, text: searchable(category, item) }));
		};
		const loading = read().catch((cause) => {
			this.categories.delete(category);
			throw cause;
		});
		this.categories.set(category, loading);
		return loading;
	}
	async query(scope: SearchScope, term: string): Promise<DeviceBucket[]> {
		const words = foldSearchText(term).trim().split(/\s+/).filter(Boolean);
		const categories = scope === 'top' ? order : [deviceScopes[scope]];
		return Promise.all(
			categories.map(async (category) => ({
				category,
				items: (await this.category(category))
					.filter((row) => words.every((word) => row.text.includes(word)))
					.map((row) => row.item)
			}))
		);
	}
	async find(category: Category, id: string) {
		return (await this.category(category)).find((row) => row.item.id === id)?.item;
	}
}
