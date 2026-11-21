import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Capacitor } from '@capacitor/core';
import type { Session } from '../connection';
import { nativePlayer } from './native';

type Account = Pick<Session, 'serverUrl' | 'userId'>;
type Entry = [membership: string, order: string];
const maxCollections = 128;
const memory = new Map<string, Entry[]>();
const encoder = new TextEncoder();

function fingerprint(ids: string[]) {
	return bytesToHex(sha256(encoder.encode(JSON.stringify(ids))));
}

function history(key: string): Entry[] {
	const unsaved = memory.get(key);
	if (unsaved) return unsaved;
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
		if (Array.isArray(stored))
			return stored
				.slice(-maxCollections)
				.filter(
					(entry): entry is Entry =>
						Array.isArray(entry) && entry.length === 2 && entry.every((v) => typeof v === 'string')
				);
	} catch {
		// Storage can be unavailable in a private browser.
	}
	return [];
}

/** Fisher–Yates. Reject the incomplete range so each remaining position has equal probability. */
export function shuffleInPlace<T>(items: T[]) {
	const range = 0x1_0000_0000;
	const random = new Uint32Array(Math.min(items.length, 128));
	let used = random.length;
	for (let remaining = items.length; remaining > 1; remaining--) {
		const limit = range - (range % remaining);
		let draw: number;
		do {
			if (used === random.length) {
				crypto.getRandomValues(random);
				used = 0;
			}
			draw = random[used++];
		} while (draw >= limit);
		const next = draw % remaining;
		[items[remaining - 1], items[next]] = [items[next], items[remaining - 1]];
	}
}

export function shuffleLocally<T extends { id: string }>(
	tracks: T[],
	account: Account,
	mode: 'playlist' | 'upcoming' | 'server' = 'playlist'
): T[] {
	const source = [...tracks];
	const different = source.findIndex((track) => track.id !== source[0].id);
	if (different < 0) return source;

	const key = 'dn.mobile.shuffle.v1.' + JSON.stringify([account.serverUrl, account.userId]);
	const recent = account.userId ? history(key) : (memory.get(key) ?? []);
	const ids = source.map((t) => t.id);
	const membership = fingerprint([...ids].sort());
	const last = recent.find(([set]) => set === membership)?.[1];
	const excluded = last ?? (mode === 'upcoming' ? fingerprint(ids) : undefined);
	let serverOrder = mode === 'server';
	for (;;) {
		const result = [...source];
		if (!serverOrder) shuffleInPlace(result);
		const order = fingerprint(result.map((t) => t.id));
		if (order !== excluded) {
			const updated = recent.filter(([set]) => set !== membership);
			updated.push([membership, order]);
			const kept = updated.slice(-maxCollections);
			if (account.userId) {
				try {
					localStorage.setItem(key, JSON.stringify(kept));
					memory.delete(key);
				} catch {
					memory.set(key, kept);
				}
			} else memory.set(key, kept);
			return result;
		}
		// Redraw the whole permutation. Alternating the input also prevents identical
		// draws after a cold start from continually producing the rejected sequence.
		[source[0], source[different]] = [source[different], source[0]];
		serverOrder = false;
	}
}

export async function shuffled<T extends { id: string }>(
	tracks: T[],
	account: Account,
	mode: 'playlist' | 'server' = 'playlist'
): Promise<T[]> {
	if (tracks.length < 2) return [...tracks];
	if (Capacitor.getPlatform() !== 'android' || !account.userId)
		return shuffleLocally(tracks, account, mode);
	const { indices } = await nativePlayer.shuffleSelection({
		serverUrl: account.serverUrl,
		userId: account.userId,
		ids: tracks.map((t) => t.id),
		serverOrder: mode === 'server'
	});
	if (
		indices.length !== tracks.length ||
		new Set(indices).size !== tracks.length ||
		!indices.every((i) => Number.isInteger(i) && i >= 0 && i < tracks.length)
	)
		throw Error('Could not shuffle every entry in this selection.');
	return indices.map((i) => tracks[i]);
}
