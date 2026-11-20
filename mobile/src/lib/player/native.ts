import { registerPlugin } from '@capacitor/core';
import type { PlaybackBridge, PlayerAccess, PlayerState } from '../player';
import type { Network, Profiles } from './streaming';
import type { EqualizerBridge } from './equalizer';

export type OutputDevice = { id: string; name: string };
type OutputState = { destination: string };
interface OutputBridge {
	outputState(): Promise<OutputState>;
	findOutputs(): Promise<{ devices: OutputDevice[] }>;
	castTo(options: { id: string }): Promise<OutputState>;
	googleCast(): Promise<OutputState>;
	stopCasting(): Promise<OutputState>;
	castScreen(): Promise<void>;
}
interface FadeBridge {
	getTrackFade(): Promise<{ milliseconds: number }>;
	setTrackFade(options: { milliseconds: number }): Promise<void>;
}
export const nativePlayer = registerPlugin<
	PlaybackBridge &
		EqualizerBridge &
		OutputBridge &
		FadeBridge & {
			restore(access: PlayerAccess & { profiles: Profiles }): Promise<PlayerState>;
			getStreamNetwork(): Promise<{ network: Network }>;
			setStreamProfiles(
				options: Pick<PlayerAccess, 'serverUrl' | 'userId'> & Profiles
			): Promise<void>;
		}
>('DNPlayer');
export const nativeOutput: OutputBridge = nativePlayer;
export const nativeFades: FadeBridge = nativePlayer;
export const airplay = registerPlugin<{ choose(): Promise<void> }>('DNOutputs');
