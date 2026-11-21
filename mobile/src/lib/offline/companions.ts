import { Capacitor } from '@capacitor/core';
import { nativeMedia } from './nativeMedia';
import type { OfflineAccount } from './tracks';
import { confirmedFeedback, feedbackRows, feedbackScope } from './feedbackStore';

export async function companion(owner: OfflineAccount, kind: 'artwork' | 'lyrics', key: string) {
	if (Capacitor.getPlatform() !== 'android' || !owner.userId) return;
	return (
		await nativeMedia.companion({ serverUrl: owner.serverUrl, userId: owner.userId, kind, key })
	).source;
}

export async function refreshOfflineMetadata(owner: OfflineAccount) {
	if (!owner.userId) throw Error('Reconnect to refresh saved music.');
	const account = { serverUrl: owner.serverUrl, userId: owner.userId },
		scope = feedbackScope(owner);
	const observed = (await feedbackRows(scope)).filter((row) => row.state === 'confirmed');
	const result = await nativeMedia.refreshMetadata({
		...account,
		observedIds: [...new Set(observed.map((row) => row.id))]
	});
	for (const row of observed) {
		const value = result.confirmed?.[row.id]?.[row.field];
		if (typeof value === 'number' || typeof value === 'boolean')
			await confirmedFeedback(scope, row.id, row.field, value, row);
	}
	window.dispatchEvent(new Event('dn-offline-media'));
	return result;
}
