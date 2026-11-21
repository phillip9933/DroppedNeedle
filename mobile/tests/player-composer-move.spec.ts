import { chooseOption } from './fixtures/inlineChoice';
import type { Section } from '../src/lib/boards/layout';
import { GRID_COLUMNS, GRID_ROWS, type GridRect } from '../src/lib/player/grid';
import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { expect, test, type Page } from '@playwright/test';

type Point = { x: number; y: number };
async function touchDrag(page: Page, from: Point, to: Point) {
	const cdp = await page.context().newCDPSession(page);
	try {
		const press = page.evaluate(
			() =>
				new Promise<number>((resolve) => {
					document.addEventListener('pointerdown', (event) => resolve(event.pointerId), {
						once: true,
						capture: true
					});
				})
		);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
		const pointerId = await press;
		await page.waitForTimeout(450);
		// Android's long-click recognizer cancels the pointer stream while touch contact continues.
		expect(
			await page.evaluate(
				({ point, pointerId }) => {
					const target = document.elementFromPoint(point.x, point.y)!;
					const options = {
						pointerId,
						pointerType: 'touch',
						clientX: point.x,
						clientY: point.y,
						bubbles: true,
						cancelable: true
					};
					const suppressed = !target.dispatchEvent(new PointerEvent('contextmenu', options));
					target.dispatchEvent(new PointerEvent('pointercancel', options));
					target.dispatchEvent(new PointerEvent('lostpointercapture', options));
					return suppressed;
				},
				{ point: from, pointerId }
			)
		).toBe(true);
		for (let i = 1; i <= 6; i++)
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [
					{ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 }
				]
			});
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	} finally {
		await cdp.detach();
	}
}

async function startComposer(page: Page, seed: ([string, boolean] | Section)[]) {
	const server = 'https://composer.example';
	const key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'listener', 'player']);
	await page.addInitScript(
		({ key, seed }) =>
			localStorage.setItem(
				key,
				JSON.stringify(
					seed.map((item) =>
						Array.isArray(item) ? { id: item[0], sameRow: item[1], preview: true, title: '' } : item
					)
				)
			),
		{ key, seed }
	);
	await page.route(server + '/api/v3/**', async (route) => {
		const path = new URL(route.request().url()).pathname.slice('/api/v3'.length);
		const responses: Record<string, unknown> = {
			'/auth/providers': { local: true, oidc: false },
			'/auth/login': { token: 'fixture' },
			'/me': { id: 'listener', role: 'user', display_name: 'Listener' }
		};
		if (!Object.hasOwn(responses, path) && (await emptyBoardRead(route))) return;
		expect(Object.hasOwn(responses, path)).toBe(true);
		return route.fulfill({ json: responses[path] });
	});
	await page.setViewportSize({ width: 320, height: 700 });
	await page.goto('/');
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	await page.getByLabel('Server address').fill(server);
	await button('Continue').click();
	await page.getByLabel('Username', { exact: true }).fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await button('Sign in').click();
	await button('Settings').click();
	await button('Edit Now Playing layout').click();
	await expect(page.locator('[data-player-grid]')).toBeVisible();
	return { key, button };
}

function item(id: string, x: number, y: number, w: number, h: number): Section {
	return { id: 'player-' + id, title: '', preview: true, grid: { x, y, w, h } };
}
async function inspect(page: Page, name: string) {
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	await button('Customize ' + name).click();
	if (!(await page.getByRole('dialog').isVisible())) await button('Edit item').click();
	return page.getByRole('dialog');
}
function tile(page: Page, id: string) {
	return page.locator('[data-player-grid] [data-section-id="player-' + id + '"]');
}
async function position(page: Page, id: string): Promise<GridRect> {
	const canvas = (await page.locator('[data-player-grid]').boundingBox())!;
	const rect = (await tile(page, id).boundingBox())!;
	return {
		x: Math.round(((rect.x - canvas.x) * GRID_COLUMNS) / canvas.width),
		y: Math.round(((rect.y - canvas.y) * GRID_ROWS) / canvas.height),
		w: Math.round((rect.width * GRID_COLUMNS) / canvas.width),
		h: Math.round((rect.height * GRID_ROWS) / canvas.height)
	};
}

test('a held touch moves a tile and undo and redo restore its snapped coordinates', async ({
	page
}) => {
	const { button, key } = await startComposer(page, [
		item('artist', 0, 3, 4, 3),
		item('title', 7, 0, 8, 2)
	]);
	const canvas = (await page.locator('[data-player-grid]').boundingBox())!;
	const r = (await tile(page, 'artist').boundingBox())!;
	const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	await touchDrag(page, p, {
		x: p.x + (5 * canvas.width) / GRID_COLUMNS,
		y: p.y + (2 * canvas.height) / GRID_ROWS
	});
	await expect.poll(() => position(page, 'artist')).toEqual({ x: 5, y: 5, w: 4, h: 3 });
	await button('Undo layout edit').click();
	expect(await position(page, 'artist')).toEqual({ x: 0, y: 3, w: 4, h: 3 });
	await button('Redo layout edit').click();
	await button('Save layout').click();
	const saved: Section[] = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
	expect(saved.find((s) => s.id === 'player-artist')?.grid).toEqual({ x: 5, y: 5, w: 4, h: 3 });
});

test('a quick touch can scroll before the hold threshold without moving a field', async ({
	page
}) => {
	await startComposer(page, [item('artwork', 0, 0, 15, 10), item('title', 0, 10, 15, 2)]);
	await page.setViewportSize({ width: 320, height: 430 });
	const rect = (await tile(page, 'artwork').boundingBox())!;
	const from = { x: rect.x + rect.width / 2, y: Math.min(310, rect.y + rect.height - 5) };
	const cdp = await page.context().newCDPSession(page);
	try {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
		for (let i = 1; i <= 8; i++)
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x: from.x, y: from.y - i * 10 }]
			});
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	} finally {
		await cdp.detach();
	}
	await expect(page.getByRole('button', { name: 'Undo layout edit' })).toBeDisabled();
	expect(await position(page, 'artwork')).toEqual({ x: 0, y: 0, w: 15, h: 10 });
});

test('resizing a tile leaves its neighbors in place and preview uses the same grid in landscape', async ({
	page
}) => {
	const { button } = await startComposer(page, [
		item('toggle', 0, 5, 3, 4),
		item('next', 10, 5, 3, 4)
	]);
	await button('Customize Play or pause').click();
	await button('Done').click();
	const handle = button('Resize Play or pause');
	await handle.scrollIntoViewIfNeeded();
	const h = (await handle.boundingBox())!,
		canvas = (await page.locator('[data-player-grid]').boundingBox())!;
	const x = h.x + h.width / 2,
		y = h.y + h.height / 2;
	expect(
		await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.dataset.gridHandle,
			{ x, y }
		)
	).toBe('resize');
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(
		x + (3 * canvas.width) / GRID_COLUMNS,
		y + (2 * canvas.height) / GRID_ROWS,
		{ steps: 5 }
	);
	await page.mouse.up();
	await expect.poll(() => position(page, 'toggle')).toEqual({ x: 0, y: 5, w: 6, h: 6 });
	expect(await position(page, 'next')).toEqual({ x: 10, y: 5, w: 3, h: 4 });
	await button('Preview current draft').click();
	await page.setViewportSize({ width: 740, height: 360 });
	const preview = page.locator('[data-part=layout-preview]');
	await expect(preview).toBeVisible();
	const play = (await preview.locator('[data-section-id=player-toggle]').boundingBox())!;
	const next = (await preview.locator('[data-section-id=player-next]').boundingBox())!;
	expect(play.width / next.width).toBeCloseTo(2, 1);
	expect(Math.abs(play.y - next.y)).toBeLessThan(2);
	await button('Back to editing').click();
	await expect.poll(() => position(page, 'toggle')).toEqual({ x: 0, y: 5, w: 6, h: 6 });
});

test('place another item underneath divides only the chosen tile and preserves numeric padding and labels', async ({
	page
}) => {
	const { button, key } = await startComposer(page, [
		item('toggle', 0, 3, 6, 8),
		item('next', 6, 3, 6, 8)
	]);
	let d = await inspect(page, 'Play or pause');
	await expect(d.getByLabel('Padding', { exact: true })).toHaveValue('0');
	await d.getByLabel('Padding', { exact: true }).fill('3');
	await chooseOption(d.getByLabel('Label', { exact: true }), 'show');
	await d.getByLabel('Label name', { exact: true }).fill('Listen');
	await chooseOption(d.getByLabel('Label position', { exact: true }), 'above');
	await chooseOption(d.getByLabel('Icon sizing', { exact: true }), 'fill');
	await button('Place another item underneath').click();
	await button('Sleep timer').click();
	if (await button('Done').isVisible()) await button('Done').click();
	const original = await position(page, 'toggle'),
		under = await position(page, 'sleep');
	expect(original.x).toBe(under.x);
	expect(original.y + original.h).toBe(under.y);
	expect(original.w).toBe(under.w);
	expect(under.y + under.h).toBe(11);
	expect(await position(page, 'next')).toEqual({ x: 6, y: 3, w: 6, h: 8 });
	d = await inspect(page, 'Play or pause');
	await expect(d.getByLabel('Label name')).toHaveValue('Listen');
	await button('Done').click();
	await button('Save layout').click();
	const saved: Section[] = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
	expect(saved.find((s) => s.id === 'player-toggle')).toMatchObject({
		padding: 3,
		showLabel: true,
		labelName: 'Listen',
		labelPosition: 'above',
		iconMode: 'fill'
	});
});

test('seek times and lyrics settings round trip through save and custom text survives cancel', async ({
	page
}) => {
	const { button, key } = await startComposer(page, [
		item('timeline', 0, 3, 15, 3),
		item('lyrics', 0, 6, 3, 3),
		{ ...item('text', 0, 0, 15, 3), template: '{artist} · {album}' }
	]);
	let d = await inspect(page, 'Playback position');
	await chooseOption(d.getByLabel('Seek bar style'), 'waveform');
	await d.getByRole('checkbox', { name: 'Elapsed time', exact: true }).uncheck();
	await d.getByRole('checkbox', { name: 'Remaining time', exact: true }).check();
	await button('Done').click();
	d = await inspect(page, 'Lyrics');
	await chooseOption(d.getByLabel('Lyrics display'), 'sheet');
	await button('Done').click();
	await button('Save layout').click();
	const saved: Section[] = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
	expect(saved.find((s) => s.id === 'player-lyrics')?.lyricsMode).toBe('sheet');
	expect(saved.find((s) => s.id === 'player-timeline')).toMatchObject({
		seekStyle: 'waveform',
		showRemaining: true,
		showElapsed: false
	});
	expect(saved.find((s) => s.id === 'player-text')?.template).toBe('{artist} · {album}');
	await button('Player settings').click();
	d = await inspect(page, 'Custom text');
	await d.getByLabel('Text template').fill('Edited {title}');
	await button('Done').click();
	await button('Undo layout edit').click();
	d = await inspect(page, 'Custom text');
	await expect(d.getByLabel('Text template')).toHaveValue('{artist} · {album}');
	await button('Done').click();
	await button('Redo layout edit').click();
	await button('Cancel').click();
	const retained = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
	expect(retained).toEqual(saved);
});
