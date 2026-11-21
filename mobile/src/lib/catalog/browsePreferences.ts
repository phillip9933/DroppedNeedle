import type { SearchScope } from './catalog';
import type { Session } from '../connection';
import { createSubscriber } from 'svelte/reactivity';
import { availabilityLabels, type Availability } from '../offline/library';
import { categories, defaultSort, orderChoices, type Category } from './libraryBrowse';

export type BrowsePreferences = {
	layout: 'list' | 'grid';
	columns: number;
	compact: boolean;
	sort: string;
	order: 'asc' | 'desc';
};
export type CollectionDisplay = Pick<BrowsePreferences, 'layout' | 'columns' | 'compact'>;
export type CollectionEdits = Partial<Record<Category, Partial<CollectionDisplay>>>;
const storagePrefix = 'dn.mobile.library-browse.v1.';
const subscribeDisplay = createSubscriber((update) => {
	const storageChanged = (event: StorageEvent) => {
		if (event.key === null || event.key.startsWith(storagePrefix)) update();
	};
	window.addEventListener('dn-collection-display', update);
	window.addEventListener('storage', storageChanged);
	return () => {
		window.removeEventListener('dn-collection-display', update);
		window.removeEventListener('storage', storageChanged);
	};
});
function key(session: Session, category: Category | 'availability' | `search-${SearchScope}`) {
	return storagePrefix + JSON.stringify([session.serverUrl, session.userId, category]);
}
export function readAvailability(session: Session): Availability {
	try {
		const value = session.userId && localStorage.getItem(key(session, 'availability'));
		return value && value !== 'all' && Object.hasOwn(availabilityLabels, value) ? 'offline' : 'all';
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
function displayOptions(
	stored: Partial<CollectionDisplay>,
	defaults: CollectionDisplay
): CollectionDisplay {
	return {
		layout: stored.layout === 'list' || stored.layout === 'grid' ? stored.layout : defaults.layout,
		columns:
			typeof stored.columns === 'number' &&
			Number.isInteger(stored.columns) &&
			stored.columns >= 1 &&
			stored.columns <= 6
				? stored.columns
				: defaults.columns,
		compact: typeof stored.compact === 'boolean' ? stored.compact : defaults.compact
	};
}

export function readSearchDisplay(
	session: Session,
	scope: SearchScope,
	category?: Category
): CollectionDisplay {
	subscribeDisplay();
	const defaults: CollectionDisplay = category
		? readBrowsePreferences(session, category)
		: { layout: 'list', columns: 2, compact: false };
	try {
		const saved = session.userId && localStorage.getItem(key(session, `search-${scope}`));
		return saved ? displayOptions(JSON.parse(saved), defaults) : defaults;
	} catch {
		return defaults;
	}
}

export function saveSearchDisplay(
	session: Session,
	scope: SearchScope,
	display: CollectionDisplay
) {
	if (!session.userId) return false;
	try {
		const { layout, columns, compact } = display;
		localStorage.setItem(
			key(session, `search-${scope}`),
			JSON.stringify({ layout, columns, compact })
		);
		window.dispatchEvent(new Event('dn-collection-display'));
		return true;
	} catch {
		return false;
	}
}

export function readBrowsePreferences(session: Session, category: Category): BrowsePreferences {
	subscribeDisplay();
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
			...displayOptions(stored, defaults),
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
	if (!session.userId) return false;
	try {
		localStorage.setItem(key(session, category), JSON.stringify(settings));
		window.dispatchEvent(new Event('dn-collection-display'));
		return true;
	} catch {
		return false;
	}
}

export function saveCollectionEdits(
	session: Session,
	edits: CollectionEdits,
	saveSections: () => void
) {
	// Page settings and shelves share Save and Cancel. Restore earlier writes if the device runs out of space.
	const previous = new Map<string, string | null>();
	try {
		for (const category of categories) {
			const changes = edits[category];
			if (!changes) continue;
			if (!session.userId) throw Error('Could not identify this listener.');
			const id = key(session, category);
			const before = localStorage.getItem(id);
			const next = { ...readBrowsePreferences(session, category), ...changes };
			localStorage.setItem(id, JSON.stringify(next));
			previous.set(id, before);
		}
		saveSections();
	} catch (error) {
		for (const [id, value] of [...previous].reverse()) {
			if (value === null) localStorage.removeItem(id);
			else localStorage.setItem(id, value);
		}
		throw error;
	}
	if (previous.size) window.dispatchEvent(new Event('dn-collection-display'));
}
