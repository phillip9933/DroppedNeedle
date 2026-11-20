import type { PlaybackBridge, PlayerState } from '../player';

export function browserPlayer(): PlaybackBridge {
	const audio = new Audio();
	let state: PlayerState = {
		tracks: [],
		index: -1,
		playing: false,
		position: 0,
		duration: 0,
		error: null
	};
	let token = '';
	let active: AbortController | undefined;
	let objectUrl: string | undefined;

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
		return {
			...state,
			playing: !audio.paused,
			position: audio.currentTime || 0,
			duration: Number.isFinite(audio.duration)
				? audio.duration
				: (state.tracks[state.index]?.duration ?? 0)
		};
	}

	async function playAt(index: number) {
		const track = state.tracks[index];
		if (!track) throw new Error('This track is outside the play queue.');
		unload();
		state = { ...state, index, error: null };
		const request = new AbortController();
		active = request;
		try {
			// A web preview cannot attach a bearer header to an audio element.
			const response = await fetch(track.streamUrl, {
				headers: { Authorization: 'Bearer ' + token },
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: request.signal
			});
			if (!response.ok) throw new Error('DroppedNeedle could not serve this track.');
			const blob = await response.blob();
			if (request.signal.aborted) return;
			objectUrl = URL.createObjectURL(blob);
			audio.src = objectUrl;
			await audio.play();
		} catch (error) {
			if (request.signal.aborted) return;
			state.error = 'This track could not be played.';
			throw error;
		}
	}

	audio.onended = () => {
		if (state.index + 1 < state.tracks.length) void playAt(state.index + 1).catch(() => {});
	};
	audio.onerror = () => {
		if (audio.hasAttribute('src')) state.error = 'This audio format could not be played.';
	};
	return {
		async getState() {
			return snapshot();
		},
		async setQueue(options) {
			token = options.token;
			state.tracks = options.tracks;
			await playAt(options.index);
			return snapshot();
		},
		async command({ action, value }) {
			if (action === 'clear') {
				unload();
				token = '';
				state = { ...state, tracks: [], index: -1, error: null };
			} else if (state.tracks.length) {
				if (action === 'seek' && Number.isFinite(value)) audio.currentTime = Math.max(0, value!);
				if (action === 'skipTo' && Number.isInteger(value)) await playAt(value!);
				if (action === 'next' && state.index + 1 < state.tracks.length)
					await playAt(state.index + 1);
				if (action === 'previous') {
					if (audio.currentTime > 3 || state.index === 0) audio.currentTime = 0;
					else await playAt(state.index - 1);
				}
				if (action === 'toggle') {
					if (audio.paused && (!objectUrl || state.error)) await playAt(state.index);
					else if (audio.paused) await audio.play();
					else audio.pause();
				}
			}
			return snapshot();
		}
	};
}
