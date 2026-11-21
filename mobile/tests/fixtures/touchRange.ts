import type { Locator, Page } from '@playwright/test';

/** Genuine touch input, including the browser's native scroll and long-press arbitration. */
export async function touchRange(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	async function point(item: Locator) {
		const box = await item.boundingBox();
		if (!box) throw new Error('The touch target is not visible');
		return {
			x: Math.round(box.x + Math.min(75, box.width / 2)),
			y: Math.round(box.y + box.height / 2)
		};
	}
	function moveTo(x: number, y: number) {
		return cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
	}
	function holdAt(x: number, y: number) {
		return cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
	}
	return {
		point,
		holdAt,
		hold: async (item: Locator) => {
			const { x, y } = await point(item);
			return holdAt(x, y);
		},
		move: async (item: Locator) =>
			cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [await point(item)] }),
		moveTo,
		lift: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
		cancel: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
		close: () => cdp.detach()
	};
}
