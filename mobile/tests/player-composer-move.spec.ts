import type { Section } from '../src/lib/boards/layout';
import { openPlayerPlacement } from './fixtures/playerEditor';
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
	await expect(button('Edit header')).toBeVisible();
	return { key, button };
}

test('full rows swap a chosen field and preserve independently arranged fields when a group is split', async ({
	page
}) => {
	const { key, button } = await startComposer(page, [
		['player-track', false],
		['player-title', false],
		['player-artist', true],
		['player-album', true],
		['player-elapsed', true],
		['player-duration', true],
		['player-remaining', true],
		['player-text', false]
	]);
	await button('Customize Track details').click();
	await button('Split Track details').click();
	const rows = page.locator('[data-player-row]');
	await expect(rows).toHaveCount(2);
	const ids = (r: number) =>
		rows
			.nth(r)
			.locator('[data-section-id]')
			.evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-section-id')));
	expect(await ids(0)).toEqual([
		'player-title',
		'player-artist',
		'player-album',
		'player-elapsed',
		'player-duration',
		'player-remaining'
	]);
	await button('Customize Custom text').click();
	await openPlayerPlacement(page);
	await page.getByLabel('Move to row', { exact: true }).selectOption('0');
	await page.getByLabel('Swap with', { exact: true }).selectOption('1');
	expect(await ids(0)).toEqual([
		'player-title',
		'player-text',
		'player-album',
		'player-elapsed',
		'player-duration',
		'player-remaining'
	]);
	expect(await ids(1)).toEqual(['player-artist']);
	await openPlayerPlacement(page);
	await button('Move Custom text left').focus();
	await page.keyboard.press('Enter');
	expect(await ids(0)).toEqual([
		'player-text',
		'player-title',
		'player-album',
		'player-elapsed',
		'player-duration',
		'player-remaining'
	]);
	for (const box of await rows
		.first()
		.getByRole('button')
		.evaluateAll((buttons) =>
			buttons.map((b) => {
				const { width, height } = b.getBoundingClientRect();
				return { width, height };
			})
		)) {
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
	}
	await button('Save layout').click();
	const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
	expect(saved.map((s: { id: string }) => s.id)).toEqual([
		'player-text',
		'player-title',
		'player-album',
		'player-elapsed',
		'player-duration',
		'player-remaining',
		'player-artist'
	]);
	expect(saved.map((s: { sameRow: boolean }) => Boolean(s.sameRow))).toEqual([
		false,
		true,
		true,
		true,
		true,
		true,
		false
	]);
	await button('Player settings').click();
	await button('Restore default layout').click();
	await expect(rows).not.toHaveCount(2);
	await button('Cancel').click();
	expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key)).toEqual(saved);
});

test('a column holds two independently editable stacked fields with numeric padding, accessible reordering and saved labels', async ({
	page
}) => {
	const { button, key } = await startComposer(page, [
		['player-artwork', false],
		['player-title', true],
		['player-artist', false],
		['player-toggle', false]
	]);
	const sample = page.locator('[data-part=sample-player]');
	await button('Edit row 1').click();
	await button('Add subrow to column 2').click();
	await button('Use Artist').click();
	const stacked = sample
		.locator('[data-player-column]')
		.filter({ has: button('Customize Track title') });
	await expect(stacked.locator('[data-section-id]')).toHaveCount(2);
	const title = await stacked.locator('[data-section-id=player-title]').boundingBox(),
		artist = await stacked.locator('[data-section-id=player-artist]').boundingBox();
	expect(Math.abs(title!.x - artist!.x)).toBeLessThan(2);
	expect(artist!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
	await button('Customize Artist').click();
	await openPlayerPlacement(page);
	await button('Move Artist up').click();
	await expect(stacked.locator('[data-section-id]').first()).toHaveAttribute(
		'data-section-id',
		'player-artist'
	);
	await button('Move Artist down').click();
	await expect(stacked.locator('[data-section-id]').last()).toHaveAttribute(
		'data-section-id',
		'player-artist'
	);
	await button('Customize Play or pause').click();
	await expect(page.getByLabel('Padding', { exact: true })).toHaveValue('0');
	await page.getByLabel('Padding', { exact: true }).fill('3.5');
	await page.getByLabel('Padding', { exact: true }).blur();
	await expect(sample.locator('[data-section-id=player-toggle] .content')).toHaveCSS(
		'padding-top',
		'3.5px'
	);
	await expect(page.getByRole('combobox', { name: 'Icon', exact: true })).toHaveCount(0);
	await page.getByLabel('Label', { exact: true }).selectOption('show');
	await page.getByLabel('Label name').fill('Listen');
	await page.getByLabel('Label position').selectOption('above');
	await expect(sample.locator('[data-section-id=player-toggle] .caption')).toHaveText('Listen');
	await button('Save layout').click();
	const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
	expect(saved.find((s: { id: string }) => s.id === 'player-artist')).toMatchObject({
		stack: true,
		sameRow: true
	});
	expect(saved.find((s: { id: string }) => s.id === 'player-toggle')).toMatchObject({
		padding: 3.5,
		labelName: 'Listen',
		labelPosition: 'above'
	});
});

test('a listener builds five controls directly from legacy groups and keeps a sixth empty column', async ({
	page
}) => {
	const { key, button } = await startComposer(page, [
		['player-transport', false],
		['player-modes', false]
	]);
	await button('Add row').click();
	await page.getByLabel('Number of columns').selectOption('6');
	const controls = ['Shuffle upcoming', 'Previous track', 'Play or pause', 'Next track', 'Repeat'];
	for (const [index, name] of controls.entries()) {
		const target = page.getByRole('button', {
			name: new RegExp('^Add feature to row [0-9]+, column ' + (index + 1) + '$')
		});
		await target.click();
		await button('Use ' + name).click();
	}
	const row = page.locator('[data-player-row]').filter({ has: button('Customize Play or pause') });
	await expect(row.locator('[data-section-id]')).toHaveCount(6);
	await button('Save layout').click();
	const saved: { id: string; sameRow?: boolean }[] = await page.evaluate(
		(key) => JSON.parse(localStorage.getItem(key)!),
		key
	);
	expect(saved.slice(0, 5).map((s) => s.id)).toEqual([
		'player-shuffle',
		'player-previous',
		'player-toggle',
		'player-next',
		'player-repeat'
	]);
	expect(saved.at(-1)?.id).toMatch(/^player-slot-\d+$/);
	expect(saved.filter((s) => !s.sameRow)).toHaveLength(1);
	await button('Player settings').click();
	await expect(page.getByRole('button', { name: 'Add feature to row 1, column 6' })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const pointerType of ['mouse', 'pen'] as const)
	test('a held ' + pointerType + ' moves the entire row into the header', async ({ page }) => {
		const { button, key } = await startComposer(page, [
			['player-title', false],
			['player-artist', false],
			['player-album', true]
		]);
		const sample = page.locator('[data-part=sample-player]');
		const headerIds = () =>
			sample
				.locator('header [data-section-id]')
				.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-section-id')));
		const originalHeader = await headerIds();
		await button('Edit header').evaluate((el) => {
			const main = el.closest('main')!;
			main.scrollTop += el.getBoundingClientRect().top - 170;
		});
		await expect(page.locator('[data-inspector]')).toHaveCount(0);
		const from = (await button('Edit row 2').boundingBox())!,
			to = (await button('Edit header').boundingBox())!;
		const cdp = await page.context().newCDPSession(page);
		async function moveRow(hold: boolean) {
			const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
			const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
			await cdp.send('Input.dispatchMouseEvent', {
				type: 'mousePressed',
				button: 'left',
				buttons: 1,
				clickCount: 1,
				pointerType,
				...start
			});
			if (hold) await expect(page.locator('.ghost')).toBeVisible();
			await cdp.send('Input.dispatchMouseEvent', {
				type: 'mouseMoved',
				button: 'left',
				buttons: 1,
				pointerType,
				...end
			});
			await cdp.send('Input.dispatchMouseEvent', {
				type: 'mouseReleased',
				button: 'left',
				buttons: 0,
				clickCount: 1,
				pointerType,
				...end
			});
		}
		await moveRow(false);
		expect(await headerIds()).toEqual(originalHeader);
		await moveRow(true);
		await cdp.detach();
		expect(
			await sample
				.locator('header [data-section-id]')
				.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-section-id')))
		).toEqual(['player-artist', 'player-album']);
		await expect(page.locator('[data-inspector]')).toHaveCount(0);
		await button('Undo layout edit').click();
		expect(await headerIds()).toEqual(originalHeader);
		await page.keyboard.press('Control+Shift+z');
		expect(await headerIds()).toEqual(['player-artist', 'player-album']);
		await button('Save layout').click();
		await expect(page.getByRole('heading', { name: 'Nothing playing' })).toBeVisible();
		await expect(
			page.locator('[data-part=now-playing] header [data-section-id=player-album]')
		).toBeVisible();
		await page.keyboard.press('Escape');
		await button('Settings').click();
		await button('Edit Now Playing layout').click();
		await button('Edit header').click();
		await expect(page.getByLabel('Number of columns')).toHaveValue('2');
		await button('Finish editing row').click();
		await expect(button('Edit header')).toBeFocused();
		await button('Cancel').click();
		const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
		expect(
			saved
				.filter((s: { placement?: string }) => s.placement === 'header')
				.map((s: { id: string }) => s.id)
		).toEqual(['player-artist', 'player-album']);
	});

test('undo groups typing, drops a superseded redo and keeps the saved layout until Save', async ({
	page
}) => {
	const { key, button } = await startComposer(page, [
		{ id: 'player-text', title: '', template: 'Original', preview: true }
	]);
	const original = await page.evaluate((k) => localStorage.getItem(k), key);
	const rows = page.locator('[data-layout-row]');
	const undo = button('Undo layout edit'),
		redo = button('Redo layout edit');
	await button('Customize Custom text').click();
	const field = page.getByLabel('Text template');
	await field.fill('New');
	await field.press('End');
	await field.pressSequentially(' release');
	await undo.click();
	await expect(field).toHaveValue('Original');
	await expect(undo).toBeDisabled();
	await redo.click();
	await expect(field).toHaveValue('New release');
	await undo.click();
	await button('Finish editing field').click();
	const before = await rows.count();
	await button('Add row').click();
	await expect(rows).toHaveCount(before + 1);
	await expect(redo).toBeDisabled();
	await undo.click();
	await expect(rows).toHaveCount(before);
	await expect(page.locator('[data-inspector]')).toHaveCount(0);
	await page.keyboard.press('Control+y');
	await expect(rows).toHaveCount(before + 1);
	expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(original);
	await button('Cancel').click();
	expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(original);
});

test('press and hold moves fields while a quick vertical touch scrolls the editor', async ({
	page
}) => {
	const { button } = await startComposer(page, [
		['player-elapsed', false],
		['player-duration', false],
		['player-title', false],
		['player-artist', true],
		['player-album', true]
	]);
	const sample = page.locator('[data-part=sample-player]');
	const row = (n: number) => sample.locator('[data-player-row="' + n + '"]');
	const first = row(0).locator('[data-section-id]'),
		second = row(1).locator('[data-section-id]');
	await first.scrollIntoViewIfNeeded();
	const a = (await first.boundingBox())!,
		b = (await second.boundingBox())!;
	await touchDrag(
		page,
		{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
		{ x: b.x + b.width * 0.6, y: b.y + b.height * 0.5 }
	);
	await expect(row(0).locator('[data-section-id]')).toHaveCount(2);
	const field = button('Customize Elapsed time');
	await field.scrollIntoViewIfNeeded();
	const box = (await field.boundingBox())!,
		start = await page.locator('main').evaluate((el) => el.scrollTop),
		cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x: box.x + 10, y: box.y + 10 }]
	});
	for (let i = 1; i <= 8; i++)
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: box.x + 10, y: box.y + 10 + i * 9 }]
		});
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
	await expect(row(0).locator('[data-section-id]')).toHaveCount(2);
	if (start > 20)
		await expect
			.poll(() => page.locator('main').evaluate((el) => el.scrollTop))
			.toBeLessThan(start);
});

test('seek times and lyrics presentation edit the sample and survive saving or splitting a field', async ({
	page
}) => {
	const { button, key } = await startComposer(page, [
		['player-timeline', false],
		['player-lyrics', false]
	]);
	const sample = page.locator('[data-part=sample-player]'),
		progress = sample.locator('[data-part=playback-bar]');
	await button('Customize Playback position').click();
	await page.getByLabel('Seek bar style').selectOption('waveform');
	await page.getByRole('checkbox', { name: 'Elapsed time', exact: true }).uncheck();
	await page.getByRole('checkbox', { name: 'Remaining time', exact: true }).check();
	await expect(progress).toHaveAttribute('data-seek-style', 'waveform');
	await expect(progress.locator('time')).toHaveCount(2);
	await expect(progress.locator('time[aria-label="Time remaining"]')).toHaveText('−2:34');
	await button('Customize Lyrics').click();
	await page.getByLabel('Lyrics display').selectOption('sheet');
	await button('Save layout').click();
	const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!) as Section[], key);
	expect(saved.find((s) => s.id === 'player-lyrics')?.lyricsMode).toBe('sheet');
	expect(saved.find((s) => s.id === 'player-timeline')).toMatchObject({
		seekStyle: 'waveform',
		showRemaining: true,
		showElapsed: false
	});
	await button('Player settings').click();
	await button('Customize Playback position').click();
	await button('Split Playback position').click();
	await expect(sample.locator('[data-section-id=player-duration]')).toHaveCount(1);
	await expect(sample.locator('[data-section-id=player-remaining]')).toHaveCount(1);
	await expect(sample.locator('[data-section-id=player-elapsed]')).toHaveCount(0);
	await expect(progress).toHaveAttribute('data-seek-style', 'waveform');
	await expect(progress.locator('time')).toHaveCount(0);
});
