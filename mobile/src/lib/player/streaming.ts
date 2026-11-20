import { Capacitor } from '@capacitor/core';
import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, type Session } from '../connection';
import { path } from '../catalog/catalog';
import type { PlayerAccess } from '../player';
import { nativeFades } from './native';

export const rates = [96, 128, 192, 256, 320] as const;
export type Format = 'original' | 'mp3' | 'opus';
export type Quality = { format: Format; rate: number };
export const conversionSupported = Capacitor.getPlatform() !== 'ios';
const original: Quality = { format: 'original', rate: 192 };
const key = (a: PlayerAccess) =>
	'dn.mobile.stream.v1.' + JSON.stringify([a.serverUrl, a.userId ?? '']);
export function streamQuality(account: PlayerAccess): Quality {
	try {
		const q = JSON.parse(localStorage.getItem(key(account)) || 'null');
		if (q && ['original', 'mp3', 'opus'].includes(q.format) && rates.some((r) => r === q.rate))
			return { format: q.format, rate: q.rate };
	} catch {
		/* A damaged preference uses the original audio. */
	}
	return { ...original };
}
export function saveQuality(account: PlayerAccess, q: Quality) {
	localStorage.setItem(key(account), JSON.stringify(q));
}
export function conversionState(session: Session) {
	return getJson<components['schemas']['PlaybackConversion']>(
		session,
		path('/api/v3/playback/conversion')
	);
}
export function streamAddress(address: string, quality: Quality) {
	const url = new URL(address);
	for (const key of ['format', 'max_bitrate', 'start_seconds', 'estimate_content_length'])
		url.searchParams.delete(key);
	if (conversionSupported && quality.format !== 'original') {
		url.searchParams.set('format', quality.format);
		url.searchParams.set('max_bitrate', String(quality.rate));
	}
	return url.href;
}

export const fadeLengths = [0, 500, 2000, 4000, 8000] as const;
const fadeKey = 'dn.mobile.track-fades.v1';
function validFade(value: number) {
	return fadeLengths.some((ms) => ms === value) ? value : 0;
}
export function browserFade() {
	return validFade(Number(localStorage.getItem(fadeKey)));
}
export async function readTrackFade() {
	return Capacitor.isNativePlatform()
		? validFade((await nativeFades.getTrackFade()).milliseconds)
		: browserFade();
}
export async function setTrackFade(milliseconds: number) {
	const value = validFade(milliseconds);
	if (Capacitor.isNativePlatform()) await nativeFades.setTrackFade({ milliseconds: value });
	else {
		localStorage.setItem(fadeKey, String(value));
		window.dispatchEvent(new Event('dn-track-fade'));
	}
}
