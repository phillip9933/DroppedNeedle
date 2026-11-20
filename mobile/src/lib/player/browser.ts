import { browserFade, browserNetwork, streamProfiles, streamAddress } from './streaming';
import {
	nextLibraryBatch,
	retainedHistory,
	refillAt,
	type LibraryContinuation
} from './libraryWindow';
import { queueSizeCheck } from '../catalog/libraryQueue';
import type { PlaybackBridge, PlayerState, PlayerTrack } from '../player';
import { cacheWebPlayback, isAudio, webLocalAudio, webPlaybackPolicy } from '../offline/web';

export function browserPlayer(): PlaybackBridge {
	const audio = new Audio();
	let state: PlayerState = {
		repeat: 'off',
		tracks: [],
		index: -1,
		playing: false,
		position: 0,
		duration: 0,
		error: null
	};
	let token = '';
	let serverUrl = '';
	let userId: string | undefined;
	let active: AbortController | undefined;
	let objectUrl: string | undefined;

	let windowCursor: LibraryContinuation | undefined;
	let loadingWindow: AbortController | undefined;
	let windowProblem: string | undefined,
		waitingAtEnd = false;
	let retryAlarm: ReturnType<typeof setTimeout> | undefined;
	function detachWindow() {
		loadingWindow?.abort();
		loadingWindow = undefined;
		windowCursor = undefined;
		windowProblem = undefined;
		waitingAtEnd = false;
		clearTimeout(retryAlarm);
	}
	async function extendWindow(retry = false) {
		const cursor = windowCursor;
		if (!cursor || loadingWindow || (windowProblem && !retry)) return;
		if (
			cursor.after
				? state.tracks.length - state.index - 1 > refillAt
				: !waitingAtEnd || state.repeat !== 'all'
		)
			return;
		const request = new AbortController();
		loadingWindow = request;
		clearTimeout(retryAlarm);
		windowProblem = undefined;
		try {
			const policy = userId
				? await webPlaybackPolicy({ serverUrl, userId }, state.tracks[state.index]?.id ?? '').catch(
						() => null
					)
				: null;
			if (policy?.options.offlineOnly)
				throw Error('Turn off offline-only mode to load more library tracks.');
			const batch = await nextLibraryBatch(
				{ serverUrl, userId, token, displayName: '' },
				cursor,
				state.tracks,
				request.signal
			);
			if (request.signal.aborted || windowCursor !== cursor) return;
			const restart = cursor.after === null;
			if (
				restart
					? !waitingAtEnd || state.repeat !== 'all'
					: state.tracks.length - state.index - 1 > refillAt
			)
				return;
			const trim = restart ? state.tracks.length : Math.max(0, state.index - retainedHistory);
			const old = state.tracks.length - trim;
			const tracks = [...state.tracks.slice(trim), ...batch.tracks];
			tracks.forEach(queueSizeCheck(serverUrl));
			state.tracks = tracks;
			state.index = restart ? 0 : state.index - trim;
			windowCursor = batch.continuation;
			const resume = waitingAtEnd;
			waitingAtEnd = false;
			if (resume) await playAt(old);
		} catch (e) {
			if (request.signal.aborted || cursor !== windowCursor) return;
			windowProblem = e instanceof Error ? e.message : 'Could not load more library tracks.';
			if (!retry)
				retryAlarm = setTimeout(() => {
					if (waitingAtEnd || !audio.paused) void extendWindow(true);
				}, 2200);
		} finally {
			if (loadingWindow === request) loadingWindow = undefined;
		}
	}
	window.addEventListener('online', () => {
		if (windowProblem && (waitingAtEnd || !audio.paused)) void extendWindow(true);
	});

	let sleepAlarm: ReturnType<typeof setTimeout> | undefined;
	let sleepingTrack: PlayerTrack | undefined;
	let pauseRevision = 0,
		blockAdvance = false;
	function cancelSleep() {
		clearTimeout(sleepAlarm);
		sleepAlarm = undefined;
		sleepingTrack = undefined;
		state.sleepTimer = null;
	}
	function checkSleep() {
		if (state.sleepTimer?.mode === 'minutes' && Date.now() >= state.sleepTimer.endsAt) {
			cancelSleep();
			pauseRevision++;
			waitingAtEnd = false;
			blockAdvance = true;
			audio.pause();
		}
	}
	// A background tab may throttle timers. Media events and foregrounding also check the deadline.
	audio.addEventListener('timeupdate', checkSleep);
	document.addEventListener('visibilitychange', checkSleep);
	window.addEventListener('pageshow', checkSleep);

	let fadeMs = browserFade();
	let fadeTimer: ReturnType<typeof setTimeout> | undefined;
	function fadeVolume() {
		clearTimeout(fadeTimer);
		const position = (audio.currentTime || 0) * 1000;
		const duration =
			(Number.isFinite(audio.duration)
				? audio.duration
				: (state.tracks[state.index]?.duration ?? 0)) * 1000;
		const ramp = duration > 0 ? Math.min(fadeMs, duration / 2) : fadeMs;
		const distance = duration > 0 ? Math.min(position, duration - position) : position;
		const level = ramp > 0 ? Math.max(0, Math.min(1, distance / ramp)) : 1;
		if (audio.volume !== level) audio.volume = level;
		if (!ramp || audio.paused || audio.ended) return;
		const beforeEnd = duration - ramp - position;
		if (position >= ramp && duration <= 0) return;
		fadeTimer = setTimeout(
			fadeVolume,
			position < ramp || beforeEnd <= 0 ? 50 : Math.max(16, beforeEnd / audio.playbackRate)
		);
	}
	for (const event of [
		'play',
		'pause',
		'seeking',
		'seeked',
		'ended',
		'durationchange',
		'ratechange'
	])
		audio.addEventListener(event, fadeVolume);
	window.addEventListener('dn-track-fade', () => {
		fadeMs = browserFade();
		fadeVolume();
	});

	function unload() {
		active?.abort();
		active = undefined;
		audio.pause();
		audio.removeAttribute('src');
		audio.load();
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = undefined;
	}

	function snapshot(): PlayerState {
		checkSleep();
		return {
			...state,
			libraryWindow: windowCursor
				? {
						loaded: windowCursor.loaded,
						total: windowCursor.total,
						offset: windowCursor.loaded - state.tracks.length,
						more: !!windowCursor.after,
						problem: windowProblem
					}
				: null,
			playing: waitingAtEnd || !audio.paused,
			position: audio.currentTime || 0,
			duration: Number.isFinite(audio.duration)
				? audio.duration
				: (state.tracks[state.index]?.duration ?? 0)
		};
	}

	async function playAt(index: number, play = true) {
		const track = state.tracks[index];
		if (!track) throw new Error('This track is outside the play queue.');
		if (sleepingTrack && sleepingTrack !== track) cancelSleep();
		blockAdvance = false;
		const playRevision = pauseRevision;
		unload();
		state = { ...state, index, error: null };
		waitingAtEnd = false;
		if (play) void extendWindow();
		const request = new AbortController();
		active = request;
		try {
			// A web preview cannot attach a bearer header to an audio element.
			const account = userId ? { serverUrl, userId } : null;
			let blob = account ? await webLocalAudio(account, track.id).catch(() => null) : null;
			if (!blob) {
				const policy = account
					? await webPlaybackPolicy(account, track.id).catch(() => null)
					: null;
				const options = policy?.options;
				if (options?.offlineOnly) throw Error('This song is not stored on this device.');
				const profiles = streamProfiles({ serverUrl, userId });
				const profile = browserNetwork() === 'wifi' ? profiles.wifi : profiles.cellular;
				const source = new URL(streamAddress(track.streamUrl, profile));
				const load = (url: URL) =>
					fetch(url, {
						headers: { Authorization: 'Bearer ' + token },
						credentials: 'omit',
						redirect: 'error',
						referrerPolicy: 'no-referrer',
						signal: request.signal
					});
				let response = await load(source);
				if (
					response.status === 409 &&
					['opus', 'mp3'].includes(source.searchParams.get('format') ?? '')
				) {
					await response.body?.cancel();
					source.search = '?format=raw';
					response = await load(source);
				}
				if (!response.ok) throw new Error('DroppedNeedle could not serve this track.');
				blob = await response.blob();
				if (
					account &&
					policy?.options.autoCache &&
					!source.searchParams.has('start_seconds') &&
					blob.size &&
					response.status === 200 &&
					isAudio(response.headers.get('content-type')) &&
					!request.signal.aborted
				)
					void cacheWebPlayback(account, track, blob, policy.revision);
			}
			if (request.signal.aborted) return;
			objectUrl = URL.createObjectURL(blob);
			audio.src = objectUrl;
			fadeVolume();
			checkSleep();
			if (play && playRevision === pauseRevision) await audio.play();
		} catch (error) {
			if (request.signal.aborted) return;
			state.error = 'This track could not be played.';
			throw error;
		}
	}

	audio.onended = () => {
		if (sleepingTrack) {
			cancelSleep();
			blockAdvance = true;
			audio.pause();
			return;
		}
		if (blockAdvance) return;
		const playRevision = pauseRevision;
		checkSleep();
		if (pauseRevision !== playRevision) return;
		if (state.repeat === 'one') {
			audio.currentTime = 0;
			void audio.play().catch(() => {
				state.error = 'This track could not be played.';
			});
		} else if (
			windowCursor &&
			state.index + 1 === state.tracks.length &&
			(windowCursor.after || state.repeat === 'all')
		) {
			waitingAtEnd = true;
			void extendWindow();
		} else if (state.index + 1 < state.tracks.length || state.repeat === 'all') {
			void playAt((state.index + 1) % state.tracks.length).catch(() => {});
		}
	};
	audio.onerror = () => {
		if (audio.hasAttribute('src')) state.error = 'This audio format could not be played.';
	};
	return {
		async getState() {
			return snapshot();
		},
		async setQueue(options) {
			if (options.placement && state.tracks.length) {
				if (token !== options.token || serverUrl !== options.serverUrl || userId !== options.userId)
					throw new Error('This queue belongs to a different session.');
				detachWindow();
				const at = options.placement === 'next' ? state.index + 1 : state.tracks.length;
				state.tracks = [...state.tracks.slice(0, at), ...options.tracks, ...state.tracks.slice(at)];
				return snapshot();
			}
			if (serverUrl !== options.serverUrl || userId !== options.userId || token !== options.token)
				cancelSleep();
			detachWindow();
			windowCursor = options.continuation;
			serverUrl = options.serverUrl;
			userId = options.userId;
			token = options.token;
			state.tracks = options.tracks;
			await playAt(options.index);
			return snapshot();
		},
		async command({ action, value, to }) {
			if (action === 'retryLibraryWindow') {
				await extendWindow(true);
				return snapshot();
			}
			if (['move', 'remove', 'clearUpcoming', 'shuffleUpcoming', 'clear'].includes(action))
				detachWindow();
			if (action === 'toggle' && waitingAtEnd) {
				waitingAtEnd = false;
				audio.pause();
				return snapshot();
			}
			if (
				action === 'next' &&
				windowCursor &&
				state.index + 1 === state.tracks.length &&
				(windowCursor.after || state.repeat === 'all')
			) {
				waitingAtEnd = true;
				await extendWindow(true);
				return snapshot();
			}
			if (action === 'cancelSleepTimer') {
				cancelSleep();
				return snapshot();
			}
			if (action === 'setSleepMinutes' || action === 'sleepAfterTrack') {
				const current = state.tracks[state.index];
				if (!current) throw Error('Choose a track first.');
				if (
					action === 'setSleepMinutes' &&
					(!Number.isInteger(value) || value! < 1 || value! > 240)
				)
					throw Error('Choose a whole number from 1 to 240 minutes.');
				cancelSleep();
				if (action === 'sleepAfterTrack') {
					sleepingTrack = current;
					state.sleepTimer = { mode: 'track' };
				} else {
					const ms = value! * 60_000;
					state.sleepTimer = { mode: 'minutes', endsAt: Date.now() + ms };
					sleepAlarm = setTimeout(checkSleep, ms);
				}
				return snapshot();
			}
			if (action === 'clear' || (action === 'remove' && value === 0 && state.tracks.length === 1)) {
				cancelSleep();
				unload();
				token = serverUrl = '';
				userId = undefined;
				state = { ...state, repeat: 'off', tracks: [], index: -1, error: null };
			} else if (state.tracks.length) {
				if (action === 'seek' && Number.isFinite(value)) {
					waitingAtEnd = false;
					audio.currentTime = Math.max(0, value!);
				}
				if (action === 'skipTo' && Number.isInteger(value)) await playAt(value!);
				if (action === 'next' && (state.index + 1 < state.tracks.length || state.repeat === 'all'))
					await playAt((state.index + 1) % state.tracks.length);
				if (action === 'previous') {
					waitingAtEnd = false;
					if (audio.currentTime > 3 || state.index === 0) audio.currentTime = 0;
					else await playAt(state.index - 1);
				}
				if (action === 'cycleRepeat') {
					state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
					if (windowCursor?.after === null && state.repeat !== 'all') waitingAtEnd = false;
				}
				if (action === 'clearUpcoming') state.tracks = state.tracks.slice(0, state.index + 1);
				if (action === 'shuffleUpcoming') {
					for (let i = state.tracks.length - 1; i > state.index + 1; i--) {
						const j = state.index + 1 + Math.floor(Math.random() * (i - state.index));
						[state.tracks[i], state.tracks[j]] = [state.tracks[j], state.tracks[i]];
					}
				}
				if (
					(action === 'move' || action === 'remove') &&
					value !== undefined &&
					Number.isInteger(value) &&
					state.tracks[value]
				) {
					const current = state.tracks[state.index];
					if (action === 'move' && to !== undefined && Number.isInteger(to) && state.tracks[to]) {
						state.tracks.splice(to, 0, ...state.tracks.splice(value, 1));
						state.index = state.tracks.indexOf(current);
					}
					if (action === 'remove') {
						const play = !audio.paused;
						state.tracks.splice(value, 1);
						if (value === state.index) await playAt(Math.min(value, state.tracks.length - 1), play);
						else state.index = state.tracks.indexOf(current);
					}
				}
				if (action === 'toggle') {
					blockAdvance = !audio.paused;
					if (audio.paused && (audio.ended || !objectUrl || state.error)) await playAt(state.index);
					else if (audio.paused) await audio.play();
					else audio.pause();
				}
			}
			return snapshot();
		}
	};
}
