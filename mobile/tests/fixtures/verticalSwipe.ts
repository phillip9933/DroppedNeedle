import type { Page } from '@playwright/test';

export async function verticalSwipe(page: Page, x: number, y: number, dy: number) {
	const touch = await page.context().newCDPSession(page);
	try {
		await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
		for (let i = 1; i <= 8; i++)
			await touch.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x, y: y + (dy * i) / 8 }]
			});
		await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	} finally {
		await touch.detach();
	}
}
