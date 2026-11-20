import { getJson, type Session } from '../connection';
import { discoveryWidgets, defaultDiscoveryWidgets } from '../catalog/discoveryWidgets';
import { libraryWidgets } from '../catalog/libraryWidgets';
import { isPlayerText } from '../player/composition';
import { playerWidgets, playerDefaults, playerFields } from '../player/layout';

export type Board = 'home' | 'library' | 'discover';
export type LayoutTarget = Board | 'player';
export type Section = {
	id: string;
	title: string;
	preview: boolean;
	sameRow?: boolean;
	width?: 1 | 2 | 3;
	align?: 'start' | 'center' | 'end';
	textSize?: 'small' | 'normal' | 'large';
	template?: string;
};
export const boardNames = {
	home: 'Home',
	library: 'Library',
	discover: 'Discover',
	player: 'Now Playing'
} as const;
const widgets: readonly { id: string; label: string }[] = [
	...libraryWidgets,
	...discoveryWidgets,
	...playerWidgets,
	...playerFields
];

export function available(board: LayoutTarget) {
	return widgets.filter((w) =>
		board === 'home' ? !w.id.startsWith('player-') : w.id.startsWith(board + '-')
	);
}

export function sectionTitle(section: Section) {
	return (
		section.title ||
		widgets.find((w) => w.id === section.id)?.label ||
		(isPlayerText(section.id) ? 'Custom text' : section.id)
	);
}

export function defaults(board: LayoutTarget): Section[] {
	if (board === 'player') return playerDefaults();
	const ids =
		board === 'home'
			? ['library-recently-added', 'library-recently-played', 'discover-top_picks']
			: board === 'library'
				? libraryWidgets.map((w) => w.id)
				: defaultDiscoveryWidgets;
	return ids.map((id, index) => ({
		id,
		title: '',
		preview:
			board === 'discover' || index === 0 || (board === 'home' && id === 'library-recently-played')
	}));
}

const accounts = new WeakMap<Session, Promise<string>>();
export function accountId(session: Session): Promise<string> {
	if (session.userId) return Promise.resolve(session.userId);
	const pending = accounts.get(session);
	if (pending) return pending;
	// Installed versions before 0.3 kept the display name, which listeners can change.
	const lookup = getJson<{ id: string }>(session, '/api/v3/me')
		.then((me) => {
			if (typeof me.id !== 'string' || !me.id) throw new Error('Could not identify this listener.');
			return me.id;
		})
		.catch((error) => {
			accounts.delete(session);
			throw error;
		});
	accounts.set(session, lookup);
	return lookup;
}

function key(server: string, user: string, board: LayoutTarget) {
	return 'dn.mobile.layout.v1.' + JSON.stringify([server, user, board]);
}

export function loadLayout(server: string, user: string, board: LayoutTarget): Section[] {
	const raw = localStorage.getItem(key(server, user, board));
	if (raw === null) return defaults(board);
	let entries: unknown;
	try {
		entries = JSON.parse(raw);
	} catch {
		return defaults(board);
	}
	if (!Array.isArray(entries)) return defaults(board);
	const allowed = new Set(available(board).map((w) => w.id));
	const sections: Section[] = [];
	const seen = new Set<string>();
	for (const item of entries) {
		if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue;
		if (!allowed.has(item.id) && !(board === 'player' && isPlayerText(item.id))) continue;
		seen.add(item.id);
		const section: Section = {
			id: item.id,
			title: typeof item.title === 'string' ? item.title.trim().slice(0, 64) : '',
			preview: item.preview !== false
		};
		if (board === 'player') {
			if (item.sameRow === true) section.sameRow = true;
			if ([1, 2, 3].includes(item.width)) section.width = item.width;
			if (['start', 'center', 'end'].includes(item.align)) section.align = item.align;
			if (['small', 'normal', 'large'].includes(item.textSize)) section.textSize = item.textSize;
			if (isPlayerText(item.id) && typeof item.template === 'string')
				section.template = item.template.slice(0, 512);
		}
		sections.push(section);
	}
	return sections;
}

export function saveLayout(server: string, user: string, board: LayoutTarget, sections: Section[]) {
	localStorage.setItem(
		key(server, user, board),
		JSON.stringify(sections.map((s) => ({ ...s, title: s.title.trim() })))
	);
	window.dispatchEvent(new CustomEvent('dn-layout-change', { detail: { server, user, board } }));
}
