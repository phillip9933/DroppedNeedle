import type { PlayerTrack } from '../player';
import type { OfflineItem, OfflineOrigin, OfflineSnapshot } from './tracks';

export type Availability = 'all' | 'offline' | OfflineOrigin;
export type OfflineInventory = {
	items: OfflineItem[];
	byId: Map<string, OfflineItem>;
	offlineOnly: boolean;
};

export function inventory(snapshot: OfflineSnapshot): OfflineInventory {
	return {
		items: snapshot.items,
		byId: new Map(snapshot.items.map((item) => [item.track.id, item])),
		offlineOnly: snapshot.options.offlineOnly
	};
}

export function matchesAvailability(data: OfflineInventory, id: string, filter: Availability) {
	if (filter === 'all') return true;
	const entry = data.byId.get(id);
	return !!entry && (filter === 'offline' || filter === entry.origin);
}

export function availableTracks(
	data: OfflineInventory,
	filter: Availability = 'offline'
): PlayerTrack[] {
	return data.items
		.filter((i) => matchesAvailability(data, i.track.id, filter))
		.map((i) => i.track);
}
