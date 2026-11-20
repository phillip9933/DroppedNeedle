import type { PlaybackBridge, PlayerState } from '../player';

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

	async function playAt(index: number, play = true) {
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
			if (play) await audio.play();
		} catch (error) {
			if (request.signal.aborted) return;
			state.error = 'This track could not be played.';
			throw error;
		}
	}

	audio.onended = () => {
		if (state.repeat === 'one') {
			audio.currentTime = 0;
			void audio.play().catch(() => {
				state.error = 'This track could not be played.';
			});
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
				if (token !== options.token || serverUrl !== options.serverUrl)
					throw new Error('This queue belongs to a different session.');
				const at = options.placement === 'next' ? state.index + 1 : state.tracks.length;
				state.tracks = [...state.tracks.slice(0, at), ...options.tracks, ...state.tracks.slice(at)];
				return snapshot();
			}
			serverUrl = options.serverUrl;
			token = options.token;
			state.tracks = options.tracks;
			await playAt(options.index);
			return snapshot();
		},
		async command({ action, value, to }) {
			if (action === 'clear' || (action === 'remove' && value === 0 && state.tracks.length === 1)) {
				unload();
				token = serverUrl = '';
				state = { ...state, repeat: 'off', tracks: [], index: -1, error: null };
			} else if (state.tracks.length) {
				if (action === 'seek' && Number.isFinite(value)) audio.currentTime = Math.max(0, value!);
				if (action === 'skipTo' && Number.isInteger(value)) await playAt(value!);
				if (action === 'next' && (state.index + 1 < state.tracks.length || state.repeat === 'all'))
					await playAt((state.index + 1) % state.tracks.length);
				if (action === 'previous') {
					if (audio.currentTime > 3 || state.index === 0) audio.currentTime = 0;
					else await playAt(state.index - 1);
				}
				if (action === 'cycleRepeat')
					state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
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
					if (audio.paused && (!objectUrl || state.error)) await playAt(state.index);
					else if (audio.paused) await audio.play();
					else audio.pause();
				}
			}
			return snapshot();
		}
	};
}
