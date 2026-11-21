import { Capacitor, registerPlugin } from '@capacitor/core';
import { writable } from 'svelte/store';
import type { Session } from '../connection';

type Account = Pick<Session, 'serverUrl' | 'userId'>;
const native = registerPlugin<{
	pinPlaylist(options: Account & { id: string; name: string }): Promise<void>;
	takePlaylist(options: Account): Promise<{ id?: string }>;
}>('DNLauncher');
export const launcherShortcuts = Capacitor.getPlatform() === 'android';
export const pendingShortcut = writable<{ session: Session; id: string } | null>(null);
export function pinPlaylist(session: Session, id: string, name: string) {
	return native.pinPlaylist({ serverUrl: session.serverUrl, userId: session.userId, id, name });
}
export function takePlaylistShortcut(session: Session) {
	return native.takePlaylist({ serverUrl: session.serverUrl, userId: session.userId });
}
