import { api } from '$lib/api/client';
import { ApiError } from '$lib/api/errors';
import { v3 } from '$lib/api/v3/endpoint';
import { withBasePath } from '$lib/utils/basePath';
import { playerStore } from '../state/player.svelte';
import {
	connectDeviceLink,
	transferMbid,
	transferableQueue,
	type DeviceAdapter,
	type TransferQueue
} from '../playback/deviceLink';
import { localGainTags, type QueueItem } from '../playback/types';

function snapshot(): TransferQueue {
	const { queue, currentIndex, shuffleEnabled, shuffleOrder, progress, isPlaying } = playerStore;
	const ordered = shuffleEnabled ? shuffleOrder.map((index) => queue[index]) : queue;
	if (
		ordered.length !== queue.length ||
		ordered.some((t) => !t || t.isPreview || t.sourceType !== 'local')
	) {
		throw Error('Handoff needs a queue of local DN tracks.');
	}
	return {
		tracks: ordered.map((t) => ({
			id: t.trackSourceId,
			title: t.trackName,
			artist: t.artistName,
			album: t.albumName,
			album_id: t.albumId || undefined,
			artist_id: t.artistId || undefined,
			duration: t.duration,
			format: t.format,
			track_number: t.trackNumber,
			disc_number: t.discNumber,
			...t.localGain,
			artist_mbid: transferMbid(t.localArtistMbid),
			release_group_mbid: transferMbid(t.localReleaseGroupMbid),
			recording_mbid: transferMbid(t.recordingIds?.local)
		})),
		index: shuffleEnabled ? shuffleOrder.indexOf(currentIndex) : currentIndex,
		position_ms: Math.round(progress * 1000),
		playing: isPlaying
	};
}

export function connectWebDevice(userId: string) {
	const heartbeat: DeviceAdapter['heartbeat'] = async (body, signal) => {
		try {
			return await api.v3.POST(v3('/api/v3/playback/devices/sync'), body, { signal });
		} catch (e) {
			if (e instanceof ApiError && (e.status === 404 || e.status === 405))
				throw Error('Update your DN server to use player handoff.', { cause: e });
			throw e;
		}
	};
	return connectDeviceLink({
		scope: JSON.stringify([withBasePath('/'), userId]),
		name: 'Web player',
		heartbeat,
		command: (body, signal) =>
			api.v3.POST(v3('/api/v3/playback/devices/control'), body, { signal }),
		status: () => {
			let possible = false;
			try {
				possible = transferableQueue(snapshot());
			} catch {
				/* External sources stay on the web player. */
			}
			return {
				title: playerStore.currentQueueItem?.trackName,
				playing: playerStore.isPlaying,
				can_transfer: possible
			};
		},
		capture: snapshot,
		restore: async (q) => {
			const tracks: QueueItem[] = q.tracks.map((t) => ({
				trackSourceId: t.id,
				trackName: t.title,
				artistName: t.artist,
				albumName: t.album,
				albumId: t.album_id ?? '',
				artistId: t.artist_id ?? undefined,
				trackNumber: t.track_number ?? 0,
				discNumber: t.disc_number ?? undefined,
				format: t.format ?? undefined,
				duration: t.duration ?? undefined,
				sourceType: 'local',
				localGain: localGainTags(t),
				localArtistMbid: t.artist_mbid ?? undefined,
				localReleaseGroupMbid: t.release_group_mbid ?? undefined,
				recordingIds: t.recording_mbid ? { local: t.recording_mbid } : undefined,
				coverUrl: t.album_id
					? withBasePath(v3('/api/v3/library/albums/{id}/artwork', { path: { id: t.album_id } }))
					: null
			}));
			await playerStore.playQueue(tracks, q.index, false, {
				seconds: q.position_ms / 1000,
				playing: q.playing
			});
			if (playerStore.playbackState === 'error')
				throw Error('The web player could not open this track.');
		},
		playing: async (play) => {
			if (play) playerStore.play();
			else playerStore.pause();
		},
		skip: async (forward) => {
			if (forward) playerStore.nextTrack();
			else playerStore.previousTrack();
		}
	});
}
