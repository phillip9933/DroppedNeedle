import {
	EQ_FREQUENCIES,
	EQ_PRESETS,
	type EqPresetName
} from '../../../../frontend/src/lib/features/player/state/eqPresets';

export {
	EQ_PRESET_NAMES,
	type EqPresetName
} from '../../../../frontend/src/lib/features/player/state/eqPresets';
export interface EqualizerState {
	available: true;
	enabled: boolean;
	/** Android's millihertz and millibels, retained without rounding on the bridge. */
	centers: number[];
	levels: number[];
	minimum: number;
	maximum: number;
	preset: string;
}
export type EqualizerResult = EqualizerState | { available: false; reason: string };
export interface EqualizerBridge {
	getEqualizer(): Promise<EqualizerResult>;
	setEqualizer(
		value: Pick<EqualizerState, 'enabled' | 'centers' | 'levels' | 'preset'>
	): Promise<EqualizerResult>;
}

export function presetLevels(state: EqualizerState, name: EqPresetName): number[] {
	const gains = EQ_PRESETS[name];
	return state.centers.map((center) => {
		const hz = center / 1000;
		const right = EQ_FREQUENCIES.findIndex((freq) => freq >= hz);
		let gain: number;
		if (right < 0) gain = gains[gains.length - 1];
		else if (right === 0) gain = gains[0];
		else {
			const left = right - 1;
			const fraction =
				Math.log(hz / EQ_FREQUENCIES[left]) /
				Math.log(EQ_FREQUENCIES[right] / EQ_FREQUENCIES[left]);
			gain = gains[left] + fraction * (gains[right] - gains[left]);
		}
		return Math.min(state.maximum, Math.max(state.minimum, Math.round(gain * 100)));
	});
}

export function bandLabel(center: number) {
	const hz = center / 1000;
	return hz >= 1000 ? Number((hz / 1000).toFixed(2)) + ' kHz' : Number(hz.toFixed(1)) + ' Hz';
}
