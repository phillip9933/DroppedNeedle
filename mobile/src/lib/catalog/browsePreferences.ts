import type { Session } from '../connection';
import { availabilityLabels, type Availability } from '../offline/library';
import { defaultSort, orderChoices, type Category } from './libraryBrowse';

export type BrowsePreferences = {
	layout: 'list' | 'grid';
	columns: number;
	compact: boolean;
	sort: string;
	order: 'asc' | 'desc';
};
function key(session: Session, category: Category | 'availability') {
	return (
		'dn.mobile.library-browse.v1.' + JSON.stringify([session.serverUrl, session.userId, category])
	);
}
export function readAvailability(session: Session): Availability {
	try {
		const value = session.userId && localStorage.getItem(key(session, 'availability'));
		return value && Object.hasOwn(availabilityLabels, value) ? (value as Availability) : 'all';
	} catch {
		return 'all';
	}
}
export function saveAvailability(session: Session, value: Availability) {
	if (!session.userId) return;
	try {
		localStorage.setItem(key(session, 'availability'), value);
	} catch {
		/* Storage can be unavailable in a restricted browser. */
	}
}
export function readBrowsePreferences(session: Session, category: Category): BrowsePreferences {
	const defaults: BrowsePreferences = {
		layout: category === 'Tracks' || category === 'Genres' ? 'list' : 'grid',
		columns: category === 'Artists' ? 3 : 2,
		compact: false,
		sort: defaultSort[category],
		order: 'asc'
	};
	try {
		if (!session.userId) return defaults;
		const stored = JSON.parse(localStorage.getItem(key(session, category)) || '{}');
		return {
			layout:
				stored.layout === 'list' || stored.layout === 'grid' ? stored.layout : defaults.layout,
			columns:
				Number.isInteger(stored.columns) && stored.columns >= 1 && stored.columns <= 6
					? stored.columns
					: defaults.columns,
			compact: stored.compact === true,
			sort: orderChoices[category].some(([s]) => s === stored.sort) ? stored.sort : defaults.sort,
			order: stored.order === 'desc' ? 'desc' : 'asc'
		};
	} catch {
		return defaults;
	}
}
export function saveBrowsePreferences(
	session: Session,
	category: Category,
	settings: BrowsePreferences
) {
	if (!session.userId) return;
	try {
		localStorage.setItem(key(session, category), JSON.stringify(settings));
	} catch {
		/* A restricted browser can still use the current view. */
	}
}
