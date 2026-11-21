import { Capacitor } from '@capacitor/core';
import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, type Session } from '../connection';
import { path } from '../catalog/catalog';
import type { PlayerAccess } from '../player';
import { nativeFades, nativePlayer } from './native';

export const rates = [64, 96, 128, 160, 192, 256, 320] as const;
export type Format = 'original' | 'mp3' | 'opus';
export type Quality = { format: Format; rate: number };
export type Network = 'wifi' | 'cellular' | 'offline' | 'unknown';
export type Profile = 'wifi' | 'cellular';
export type Profiles = Record<Profile, Quality>;
type Account = Pick<PlayerAccess, 'serverUrl' | 'userId'>;
export const original: Quality = { format: 'original', rate: 192 };

function storageKey(account: Account, version: number) {
	return (
		'dn.mobile.stream.v' + version + '.' + JSON.stringify([account.serverUrl, account.userId ?? ''])
	);
}
function quality(value: unknown, fallback: Quality): Quality {
	if (
		value &&
		typeof value === 'object' &&
		'format' in value &&
		'rate' in value &&
		(value.format === 'original' || value.format === 'mp3' || value.format === 'opus') &&
		typeof value.rate === 'number' &&
		rates.some((rate) => rate === value.rate)
	)
		return { format: value.format, rate: value.rate };
	return { ...fallback };
}
function read(key: string): unknown {
	try {
		return JSON.parse(localStorage.getItem(key) || 'null');
	} catch {
		return null;
	}
}
export function streamProfiles(account: Account): Profiles {
	const legacy = quality(read(storageKey(account, 1)), original);
	const stored = read(storageKey(account, 2));
	return {
		wifi: quality(
			stored && typeof stored === 'object' && 'wifi' in stored ? stored.wifi : null,
			legacy
		),
		cellular: quality(
			stored && typeof stored === 'object' && 'cellular' in stored ? stored.cellular : null,
			legacy
		)
	};
}
export async function saveProfiles(account: Account, profiles: Profiles) {
	const key = storageKey(account, 2);
	const previous = localStorage.getItem(key);
	localStorage.setItem(key, JSON.stringify(profiles));
	if (!Capacitor.isNativePlatform()) {
		window.dispatchEvent(new Event('dn-stream-profiles'));
		return;
	}
	try {
		await nativePlayer.setStreamProfiles({
			serverUrl: account.serverUrl,
			userId: account.userId,
			...profiles
		});
	} catch (error) {
		if (previous === null) localStorage.removeItem(key);
		else localStorage.setItem(key, previous);
		throw error;
	}
}
type ConnectionInfo = EventTarget & { type?: string };
export function browserConnection(): ConnectionInfo | undefined {
	return (navigator as Navigator & { connection?: ConnectionInfo }).connection;
}
export function browserNetwork(): Network {
	if (!navigator.onLine) return 'offline';
	const type = browserConnection()?.type;
	if (type === 'wifi' || type === 'ethernet') return 'wifi';
	if (type === 'cellular') return 'cellular';
	return 'unknown';
}
export async function streamNetwork(): Promise<Network> {
	return Capacitor.isNativePlatform()
		? (await nativePlayer.getStreamNetwork()).network
		: browserNetwork();
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
	if (quality.format !== 'original') {
		url.searchParams.set('format', quality.format);
		url.searchParams.set('max_bitrate', String(quality.rate));
	}
	return url.href;
}

export const fadeLengths = [0, 500, 2000, 4000, 8000] as const;
export type TrackFades = { fadeInMs: number; fadeOutMs: number; smart: boolean };
export const defaultFades: TrackFades = { fadeInMs: 0, fadeOutMs: 0, smart: false };
const fadeKey = 'dn.mobile.track-fades.v2';
function validFade(value: unknown) {
	return fadeLengths.find((ms) => ms === value) ?? 0;
}
function normalizeFades(value: Partial<TrackFades> & { milliseconds?: number }): TrackFades {
	return {
		fadeInMs: validFade(value.fadeInMs ?? value.milliseconds),
		fadeOutMs: validFade(value.fadeOutMs ?? value.milliseconds),
		smart: value.smart === true
	};
}
export function browserFade(): TrackFades {
	const stored = read(fadeKey);
	return normalizeFades(
		stored && typeof stored === 'object'
			? stored
			: {
					milliseconds: Number(localStorage.getItem('dn.mobile.track-fades.v1'))
				}
	);
}
export async function readTrackFade(): Promise<TrackFades> {
	return Capacitor.isNativePlatform()
		? normalizeFades(await nativeFades.getTrackFade())
		: browserFade();
}
export async function setTrackFade(fades: TrackFades) {
	const value = normalizeFades(fades);
	if (Capacitor.isNativePlatform()) await nativeFades.setTrackFade(value);
	else {
		localStorage.setItem(fadeKey, JSON.stringify(value));
		window.dispatchEvent(new Event('dn-track-fade'));
	}
}
