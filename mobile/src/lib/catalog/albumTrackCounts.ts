import type { Session } from '../connection';

// A saved collection may be opened after its DN album was browsed in this session.
const counts = new WeakMap<Session, Map<string, number>>();
export function rememberAlbumCount(session: Session, id: string, total: number) {
	if (!Number.isSafeInteger(total) || total < 0) return;
	const current = counts.get(session) ?? new Map<string, number>();
	if (current.size >= 512 && !current.has(id)) current.delete(current.keys().next().value!);
	current.set(id, total);
	counts.set(session, current);
}
export function albumTrackCount(session: Session, id?: string) {
	return id ? counts.get(session)?.get(id) : undefined;
}
