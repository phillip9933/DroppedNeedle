import type { PlayerTrack } from '../player';

export const maxOverlap = 8;
const binSeconds = 0.1;
const quietLevel = 0.063;

export function albumSequence(a: PlayerTrack, b: PlayerTrack) {
	const artist = a.albumArtist || a.artist;
	const sameAlbum =
		a.albumId && b.albumId
			? a.albumId === b.albumId
			: a.album &&
				a.album.toLowerCase() === b.album.toLowerCase() &&
				artist &&
				artist.toLowerCase() === (b.albumArtist || b.artist).toLowerCase();
	const disc = a.discNumber || 1,
		nextDisc = b.discNumber || 1;
	return (
		!!sameAlbum &&
		!!a.trackNumber &&
		!!b.trackNumber &&
		((disc === nextDisc && b.trackNumber === a.trackNumber + 1) ||
			(nextDisc === disc + 1 && b.trackNumber === 1))
	);
}

type Edges = { duration: number; head: number[]; tail: number[] };
const measured = new WeakMap<Blob, Edges>();
async function edges(blob: Blob, duration: number | undefined, signal: AbortSignal) {
	const previous = measured.get(blob);
	if (previous) return previous;
	if (signal.aborted || blob.size > 128 * 1024 * 1024 || (duration ?? 0) > 3600) return null;
	const context = new OfflineAudioContext(1, 1, 8000);
	const bytes = await blob.arrayBuffer();
	if (signal.aborted) return null;
	const audio = await context.decodeAudioData(bytes);
	if (signal.aborted || !audio.length || !audio.numberOfChannels) return null;
	const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
		audio.getChannelData(i)
	);
	const frames = Math.round(audio.sampleRate * binSeconds);
	const limit = Math.min(Math.floor(audio.length / frames), Math.round(maxOverlap / binSeconds));
	function levels(tail: boolean) {
		const result: number[] = [];
		for (let bins = 0; bins < limit; bins++) {
			const start = tail ? audio.length - (bins + 1) * frames : bins * frames;
			let sum = 0;
			for (const channel of channels) {
				for (let i = start; i < start + frames; i++) sum += channel[i] * channel[i];
			}
			result.push(Math.sqrt(sum / (frames * channels.length)));
		}
		return result;
	}
	const result = { duration: audio.duration, head: levels(false), tail: levels(true) };
	measured.set(blob, result);
	return result;
}

function quietSeconds(levels: number[]) {
	const loud = levels.findIndex((v) => v > quietLevel);
	const bins = loud < 0 ? levels.length : loud;
	return bins >= 2 ? bins * binSeconds : 0;
}

function regularPulses(chronological: number[]) {
	const hits: number[] = [];
	for (let i = 1; i < chronological.length; i++) {
		const level = chronological[i],
			previous = chronological[i - 1];
		if (
			level >= 0.09 &&
			level - previous >= 0.035 &&
			level >= 1.45 * previous &&
			(!hits.length || i - hits[hits.length - 1] >= 3)
		)
			hits.push(i);
	}
	if (hits.length < 5) return null;
	const period = (hits[hits.length - 1] - hits[0]) / (hits.length - 1);
	if (
		period < 3 ||
		period > 10 ||
		hits.some((v, i) => i > 0 && Math.abs(v - hits[i - 1] - period) > 1)
	)
		return null;
	return { hits, period };
}

// Anchor the first incoming attack on one of the last outgoing attacks at the original tempo.
function rhythmicOverlap(tail: number[], head: number[], cap: number) {
	const a = regularPulses([...tail].reverse()),
		b = regularPulses(head);
	if (!a || !b || Math.abs(a.period - b.period) > 0.1 * Math.min(a.period, b.period)) return 0;
	for (let count = 4; count >= 2; count--) {
		const seconds = (tail.length - a.hits[a.hits.length - count] + b.hits[0]) * binSeconds;
		if (seconds >= 0.4 && seconds <= cap) return seconds;
	}
	return 0;
}

// null means analysis was unavailable. A measured zero keeps an already clean boundary at unity.
export async function smartOverlap(
	outgoing: Blob,
	current: PlayerTrack,
	incoming: Blob,
	next: PlayerTrack,
	signal: AbortSignal
) {
	if (albumSequence(current, next)) return 0;
	const tail = await edges(outgoing, current.duration, signal);
	if (!tail || signal.aborted) return null;
	const head = await edges(incoming, next.duration, signal);
	if (!head || signal.aborted) return null;
	const cap = Math.min(maxOverlap, tail.duration / 2, head.duration / 2);
	const quiet = Math.min(cap, quietSeconds(tail.tail) + quietSeconds(head.head));
	return quiet >= 0.4 ? quiet : rhythmicOverlap(tail.tail, head.head, cap);
}
