import type { Page } from '@playwright/test';
import type { PlayerTrack } from '../../src/lib/player';
import type { OfflineOrigin } from '../../src/lib/offline/tracks';
import { silentWav } from './silentWav';
export async function seedOfflineMusic(
	page: Page,
	address: string,
	who: string,
	force: boolean,
	tracks: { track: PlayerTrack; origin: OfflineOrigin }[]
) {
	const wav = silentWav(3).toString('base64');
	await page.evaluate(
		async ({ who, force, address, wav, tracks }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open('dn.mobile.offline.v1', 1);
				req.onupgradeneeded = () => {
					req.result
						.createObjectStore('tracks', { keyPath: ['scope', 'id'] })
						.createIndex('scope', 'scope');
					req.result.createObjectStore('options');
				};
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
			const tx = db.transaction(['tracks', 'options'], 'readwrite'),
				scope = JSON.stringify([address, who]),
				audio = new Blob([Uint8Array.from(atob(wav), (c) => c.charCodeAt(0))], {
					type: 'audio/wav'
				});
			tx.objectStore('options').put(
				{
					offlineOnly: force,
					autoDownload: 'off',
					autoCache: false,
					cacheMiB: 64,
					downloadMiB: 256,
					unmeteredOnly: false
				},
				scope
			);
			for (const [i, { track, origin }] of tracks.entries()) {
				const id = track.id;
				tx.objectStore('tracks').put({
					scope,
					id,
					track,
					origin,
					pinned: origin === 'downloaded',
					used: i,
					bytes: audio.size,
					audio
				});
			}
			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			db.close();
			window.dispatchEvent(new Event('dn-offline-policy'));
			window.dispatchEvent(new Event('dn-offline-media'));
		},
		{ who, force, address, wav, tracks }
	);
}
