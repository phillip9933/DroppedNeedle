import type { BrowserContext } from '@playwright/test';

// Give every new app instance the same shuffle draws while leaving keys and IVs alone.
export function repeatShuffleDraws(context: BrowserContext) {
	return context.addInitScript(() => {
		Math.random = () => 0.25;
		const original = crypto.getRandomValues.bind(crypto);
		crypto.getRandomValues = (values) => {
			if (values instanceof Uint32Array) {
				values.fill(0x41414141);
				return values;
			}
			return original(values);
		};
	});
}
