import { expect, test } from '@playwright/test';
import { presetLevels, type EqualizerState } from '../src/lib/player/equalizer';

test('web presets map onto Android band centers and respect the reported gain range', () => {
	const capabilities: EqualizerState = {
		available: true,
		enabled: true,
		centers: [16000, 62000, 125000, 250000, 8000000, 20000000],
		levels: [],
		minimum: -400,
		maximum: 500,
		preset: 'Flat'
	};
	expect(presetLevels(capabilities, 'Flat')).toEqual([0, 0, 0, 0, 0, 0]);
	expect(presetLevels(capabilities, 'Bass Boost')).toEqual([500, 500, 400, 200, 0, 0]);
	const middle = presetLevels(
		{ ...capabilities, centers: [Math.sqrt(125 * 250) * 1000] },
		'Bass Boost'
	);
	expect(middle).toEqual([300]);
});
