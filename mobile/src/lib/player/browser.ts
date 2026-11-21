import {
	browserConnection,
	browserFade,
	browserNetwork,
	streamProfiles,
	streamAddress
} from './streaming';
import {
	nextLibraryBatch,
	retainedHistory,
	refillAt,
	type LibraryContinuation
} from './libraryWindow';
import { queueSizeCheck } from '../catalog/libraryQueue';
import type { PlaybackBridge, PlayerState, PlayerTrack } from '../player';
import { cacheWebPlayback, isAudio, webLocalAudio, webPlaybackPolicy } from '../offline/web';
import { identifyAudio, setBrowserWaveformSource } from './waveform';

import { albumSequence, maxOverlap, smartOverlap } from './smartFades';

export function browserPlayer(): PlaybackBridge {
	let audio = new Audio();
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
			else fadeVolume();
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
			const finish = state.sleepTimer.finishTrack && (!audio.paused || audio.ended);
			cancelSleep();
			if (finish && state.tracks[state.index]) {
				sleepingTrack = state.tracks[state.index];
				state.sleepTimer = { mode: 'track', remaining: 1 };
				return;
			}
			pauseRevision++;
			waitingAtEnd = false;
			blockAdvance = true;
			audio.pause();
		}
	}
	// A background tab may throttle timers. Media events and foregrounding also check the deadline.
	document.addEventListener('visibilitychange', checkSleep);
	window.addEventListener('pageshow', checkSleep);

	let fades = browserFade();
	let fadeTimer: ReturnType<typeof setTimeout> | undefined;
	let sourceBlob: Blob | undefined;
	let preserveIntro = false;
	type Prepared = {
		current: PlayerTrack;
		next: PlayerTrack;
		request: AbortController;
		media?: HTMLAudioElement;
		url?: string;
		source?: Awaited<ReturnType<typeof loadTrack>>;
		overlap?: number | null;
		mixStart?: number;
	};
	let prepared: Prepared | undefined;
	function release(element: HTMLAudioElement, url?: string) {
		element.pause();
		element.removeAttribute('src');
		element.load();
		if (url) URL.revokeObjectURL(url);
	}
	function discardNext() {
		if (!prepared) return;
		const old = prepared;
		prepared = undefined;
		old.request.abort();
		if (old.media) release(old.media, old.url);
	}
	function upcoming() {
		if (state.repeat === 'one' || state.sleepTimer || state.tracks.length < 2) return;
		return (
			state.tracks[state.index + 1] ??
			(state.repeat === 'all' && !windowCursor ? state.tracks[0] : undefined)
		);
	}
	async function prepareNext(pair: Prepared, outgoing: Blob) {
		const { request, current, next } = pair;
		try {
			const source = await loadTrack(next, request);
			if (request.signal.aborted) return;
			pair.source = source;
			pair.media = new Audio();
			pair.media.preload = 'auto';
			pair.media.volume = 0;
			pair.url = URL.createObjectURL(source.blob);
			pair.media.src = pair.url;
			pair.overlap = await smartOverlap(outgoing, current, source.blob, next, request.signal).catch(
				() => null
			);
		} catch {
			pair.overlap = null;
		}
		if (!request.signal.aborted) fadeVolume();
	}
	function fadeVolume() {
		clearTimeout(fadeTimer);
		const current = state.tracks[state.index];
		const next = fades.smart ? upcoming() : undefined;
		if (prepared && (current !== prepared.current || next !== prepared.next)) discardNext();
		const position = audio.currentTime || 0;
		const duration = Number.isFinite(audio.duration) ? audio.duration : (current?.duration ?? 0);
		const left = duration - position;
		if (
			!prepared &&
			current &&
			next &&
			sourceBlob &&
			duration > 0 &&
			left <= maxOverlap * 2 &&
			!audio.paused &&
			!audio.ended &&
			!blockAdvance
		) {
			prepared = { current, next, request: new AbortController() };
			void prepareNext(prepared, sourceBlob);
		}
		const pair = prepared;
		const controlled =
			!!next && (typeof pair?.overlap === 'number' || albumSequence(current, next));
		const fadeIn = preserveIntro && fades.smart ? 0 : fades.fadeInMs / 1000;
		const fadeOut = controlled ? 0 : fades.fadeOutMs / 1000;
		const scale = duration > 0 && fadeIn + fadeOut > duration ? duration / (fadeIn + fadeOut) : 1;
		let gain = Math.min(
			1,
			fadeIn ? position / (fadeIn * scale) : 1,
			fadeOut && duration > 0 ? Math.max(0, left) / (fadeOut * scale) : 1
		);
		if (
			pair?.overlap &&
			pair.media &&
			!audio.paused &&
			!audio.ended &&
			!audio.seeking &&
			!blockAdvance
		) {
			if (
				pair.mixStart === undefined &&
				left > 0 &&
				left <= pair.overlap &&
				pair.media.readyState >= 3
			) {
				pair.mixStart = position;
				pair.media.playbackRate = audio.playbackRate;
				void pair.media.play().catch(() => {
					if (pair === prepared) {
						pair.overlap = null;
						delete pair.mixStart;
						fadeVolume();
					}
				});
			}
			if (pair.mixStart !== undefined && !pair.media.paused) {
				const progress = Math.max(
					0,
					Math.min(1, (position - pair.mixStart) / Math.max(0.001, duration - pair.mixStart))
				);
				gain *= Math.cos(Math.PI * 0.5 * progress);
				pair.media.volume = Math.sin(Math.PI * 0.5 * progress);
			}
		}
		if (audio.volume !== gain) audio.volume = gain;
		if (audio.paused || audio.ended || !sourceBlob || duration <= 0) return;
		const endWindow = next ? maxOverlap * 2 : fadeOut * scale;
		if (position < fadeIn * scale || (endWindow && left <= endWindow)) {
			fadeTimer = setTimeout(fadeVolume, 50);
		} else if (endWindow) {
			fadeTimer = setTimeout(
				fadeVolume,
				Math.max(16, ((left - endWindow) * 1000) / audio.playbackRate)
			);
		}
	}
	function invalidateNext() {
		discardNext();
		fadeVolume();
	}
	const fadeEvents = ['play', 'playing', 'durationchange', 'ratechange', 'seeked'];
	function attach(element: HTMLAudioElement) {
		element.addEventListener('timeupdate', checkSleep);
		for (const e of fadeEvents) element.addEventListener(e, fadeVolume);
		element.addEventListener('seeking', invalidateNext);
		element.addEventListener('pause', stopped);
		element.onended = ended;
		element.onerror = mediaError;
	}
	function stopped() {
		if (audio.paused && !audio.ended) discardNext();
		fadeVolume();
	}
	function detach(element: HTMLAudioElement) {
		element.removeEventListener('timeupdate', checkSleep);
		for (const e of fadeEvents) element.removeEventListener(e, fadeVolume);
		element.removeEventListener('seeking', invalidateNext);
		element.removeEventListener('pause', stopped);
		element.onended = null;
		element.onerror = null;
	}
	window.addEventListener('dn-track-fade', () => {
		fades = browserFade();
		invalidateNext();
	});
	window.addEventListener('dn-offline-policy', invalidateNext);
	window.addEventListener('dn-stream-profiles', invalidateNext);
	browserConnection()?.addEventListener('change', invalidateNext);
	window.addEventListener('offline', invalidateNext);
	window.addEventListener('online', invalidateNext);

	function unload() {
		discardNext();
		sourceBlob = undefined;
		preserveIntro = false;
		clearTimeout(fadeTimer);
		setBrowserWaveformSource(null);
		state.quality = null;
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

	async function loadTrack(track: PlayerTrack, request: AbortController) {
		// A web preview cannot attach a bearer header to an audio element.
		const account = userId ? { serverUrl, userId } : null;
		const accessToken = token;
		const profiles = streamProfiles({ serverUrl, userId });
		const profile = browserNetwork() === 'wifi' ? profiles.wifi : profiles.cellular;
		let cache: (() => void) | undefined;
		let blob = account ? await webLocalAudio(account, track.id).catch(() => null) : null;
		if (!blob) {
			const policy = account ? await webPlaybackPolicy(account, track.id).catch(() => null) : null;
			const options = policy?.options;
			if (options?.offlineOnly) throw Error('This song is not stored on this device.');
			const source = new URL(streamAddress(track.streamUrl, profile));
			const load = (url: URL) =>
				fetch(url, {
					headers: { Authorization: 'Bearer ' + accessToken },
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
				cache = () => {
					void cacheWebPlayback(account, track, blob!, policy.revision);
				};
		}
		return { blob, cache };
	}

	async function playAt(index: number, play = true) {
		const track = state.tracks[index];
		if (!track) throw new Error('This track is outside the play queue.');
		if (sleepingTrack && sleepingTrack !== track) cancelSleep();
		if (state.sleepTimer?.mode === 'track') sleepingTrack = track;
		blockAdvance = false;
		const playRevision = pauseRevision;
		unload();
		state = { ...state, index, error: null };
		waitingAtEnd = false;
		if (play) void extendWindow();
		const request = new AbortController();
		active = request;
		try {
			const source = await loadTrack(track, request);
			if (request.signal.aborted) return;
			source.cache?.();
			const blob = source.blob;
			sourceBlob = blob;
			setBrowserWaveformSource({ serverUrl, userId, id: track.id, blob });
			const quality = await identifyAudio(blob, track.duration).catch(() => null);
			if (request.signal.aborted) return;
			state.quality = quality;
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

	function ended() {
		if (blockAdvance) return;
		const playRevision = pauseRevision;
		checkSleep();
		if (pauseRevision !== playRevision) return;
		if (state.sleepTimer?.mode === 'track') {
			const left = (state.sleepTimer.remaining ?? 1) - 1;
			if (left < 1) {
				cancelSleep();
				blockAdvance = true;
				audio.pause();
				return;
			}
			state.sleepTimer = { mode: 'track', remaining: left };
			sleepingTrack = state.repeat === 'one' ? state.tracks[state.index] : undefined;
			if (state.repeat === 'off' && !windowCursor?.after && state.index + 1 >= state.tracks.length)
				cancelSleep();
		}
		if (state.repeat === 'one') {
			preserveIntro = false;
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
			const index = (state.index + 1) % state.tracks.length;
			const next = state.tracks[index];
			const pair = prepared;
			const gapless =
				fades.smart && !state.sleepTimer && albumSequence(state.tracks[state.index], next);
			if (pair?.next === next && pair.media && !pair.media.error && pair.source) {
				prepared = undefined;
				pair.request.abort();
				detach(audio);
				release(audio, objectUrl);
				audio = pair.media;
				objectUrl = pair.url;
				sourceBlob = pair.source.blob;
				active?.abort();
				const request = new AbortController();
				active = request;
				state = { ...state, index, error: null, quality: null };
				preserveIntro = typeof pair.overlap === 'number' || gapless;
				setBrowserWaveformSource({ serverUrl, userId, id: next.id, blob: sourceBlob });
				pair.source.cache?.();
				void identifyAudio(sourceBlob, next.duration)
					.then((quality) => {
						if (!request.signal.aborted) state.quality = quality;
					})
					.catch(() => {});
				attach(audio);
				fadeVolume();
				if (audio.paused)
					void audio.play().catch(() => {
						if (!request.signal.aborted) state.error = 'This track could not be played.';
					});
				void extendWindow();
			} else {
				const result = playAt(index);
				preserveIntro = gapless;
				void result.catch(() => {});
			}
		}
	}
	function mediaError() {
		if (audio.hasAttribute('src')) state.error = 'This audio format could not be played.';
	}
	attach(audio);
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
				fadeVolume();
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
			if (action !== 'retryLibraryWindow') discardNext();
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
				fadeVolume();
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
				const count = value ?? 1;
				if (action === 'sleepAfterTrack' && (!Number.isInteger(count) || count < 1 || count > 99))
					throw Error('Choose between 1 and 99 tracks.');
				cancelSleep();
				if (action === 'sleepAfterTrack') {
					sleepingTrack = current;
					state.sleepTimer = { mode: 'track', remaining: count };
				} else {
					const ms = value! * 60_000;
					state.sleepTimer = { mode: 'minutes', endsAt: Date.now() + ms, finishTrack: to === 1 };
					sleepAlarm = setTimeout(checkSleep, ms);
				}
				fadeVolume();
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
			fadeVolume();
			return snapshot();
		}
	};
}
