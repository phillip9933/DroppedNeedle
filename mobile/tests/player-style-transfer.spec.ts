import { emptyBoardRead } from './fixtures/emptyBoardRead';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { Section } from '../src/lib/boards/layout';
import { exportPlayerStyle, importPlayerStyle } from '../src/lib/player/playerStyle';

const layout: Section[] = [
	{
		id: 'player-text-12',
		title: 'Side A',
		preview: false,
		align: 'end',
		width: 2,
		minHeight: 88,
		contentWidth: 75,
		textSize: 'large',
		template: '{artist} — {title}'
	},
	{ id: 'player-toggle', title: 'Play', preview: true, sameRow: true, width: 1 }
];
test('versioned player layout JSON round trips supported options and rejects malformed input', () => {
	const encoded = exportPlayerStyle(layout),
		base = JSON.parse(encoded),
		[first] = layout;
	expect(importPlayerStyle(encoded)).toEqual(layout);
	expect(importPlayerStyle(exportPlayerStyle([]))).toEqual([]);
	const long = Array.from({ length: 225 }, (_, index) => ({
		...first,
		id: 'player-text-' + (index + 2),
		template: 'x'.repeat(104)
	}));
	expect(importPlayerStyle(exportPlayerStyle(long))).toEqual(long);
	expect(exportPlayerStyle([{ ...first, extra: 'private' } as Section])).not.toContain('private');
	for (const sections of [
		[null],
		[{ ...first, id: 'library-albums' }],
		[{ ...first, id: 'player-text-01' }],
		[first, first],
		[{ ...first, bad: true }],
		[{ ...first, template: 12 }],
		[{ ...first, template: 'x'.repeat(513) }],
		[{ ...first, id: 'player-toggle' }],
		[{ ...first, title: 't'.repeat(65) }],
		[{ ...first, preview: 0 }],
		[{ ...first, sameRow: 'true' }],
		[{ ...first, width: 0 }],
		[{ ...first, minHeight: 641 }],
		[{ ...first, contentWidth: 19 }],
		[{ ...first, placement: 'hidden' }],
		[{ ...first, align: 'middle' }],
		[{ ...first, textSize: 'giant' }]
	])
		expect(() => importPlayerStyle(JSON.stringify({ ...base, sections }))).toThrow();
	for (const value of [
		{ ...base, version: 2 },
		{ ...base, format: 'different' },
		null,
		layout,
		{ ...base, extra: true },
		{ ...base, sections: {} }
	])
		expect(() => importPlayerStyle(JSON.stringify(value))).toThrow();
	expect(() => importPlayerStyle('x'.repeat(65537))).toThrow(/64 KiB/);
	expect(() => importPlayerStyle('界'.repeat(25000))).toThrow(/64 KiB/);
});

const server = 'https://layout.example/music',
	key = 'dn.mobile.layout.v1.' + JSON.stringify([server, 'listener', 'player']);
async function openEditor(page: Page) {
	await page.route(server + '/api/v3/**', async (route) => {
		const req = route.request(),
			p = new URL(req.url()).pathname.slice('/music/api/v3'.length),
			json = (data: unknown) => route.fulfill({ json: data });
		if (p === '/auth/providers') return json({ local: true, oidc: false });
		if (p === '/auth/login') return json({ token: 'fixture' });
		expect(req.headers().authorization).toBe('Bearer fixture');
		if (p === '/me') return json({ id: 'listener', role: 'user', display_name: 'Listener' });
		if (await emptyBoardRead(route)) return;
		throw Error('Unexpected fixture request ' + p);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username', { exact: true }).fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	const edit = page.getByRole('button', { name: 'Edit Now Playing layout' }),
		share = page.getByText('Share player layout', { exact: true }),
		input = page.getByLabel('Shared layout JSON'),
		output = page.getByLabel('Current layout JSON'),
		preview = page.getByRole('button', { name: 'Review imported layout', exact: true }),
		load = page.getByRole('button', { name: 'Load into editor', exact: true });
	await edit.click();
	await expect(page.getByRole('button', { name: 'Save layout file' })).toHaveCount(0);
	await share.click();
	return { share, input, output, preview, load };
}

test('a shared player layout previews first, preserves invalid drafts and saves only through the composer', async ({
	page
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: () => Promise.reject(new Error('Clipboard unavailable')) }
		});
	});
	const { share, input, output, preview, load } = await openEditor(page);
	const original = await output.inputValue();
	await page.getByRole('button', { name: 'Copy layout', exact: true }).click();
	await expect(
		page.getByText('Layout text selected. Use your device’s Copy command.')
	).toBeVisible();
	expect(
		await output.evaluate((el) => {
			const input = el as HTMLTextAreaElement;
			return input.selectionEnd - input.selectionStart;
		})
	).toBe(original.length);
	await page.evaluate(() =>
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					sessionStorage.setItem('copy-fixture', text);
				}
			}
		})
	);
	await page.getByRole('button', { name: 'Copy layout', exact: true }).click();
	await expect(page.getByText('Layout copied.', { exact: true })).toBeVisible();
	expect(await page.evaluate(() => sessionStorage.getItem('copy-fixture'))).toBe(original);
	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await input.fill(exportPlayerStyle(layout));
	await preview.click();
	await expect(page.getByText('1 row · 2 elements')).toBeVisible();
	await input.fill('{');
	await expect(load).toHaveCount(0);
	await preview.click();
	await expect(page.getByText('Enter valid layout JSON.')).toBeVisible();
	await page.getByRole('button', { name: 'Export', exact: true }).click();
	expect(await output.inputValue()).toBe(original);
	async function importDraft() {
		await page.getByRole('button', { name: 'Import', exact: true }).click();
		await input.fill(exportPlayerStyle(layout));
		await preview.click();
		await load.click();
		await page.getByRole('button', { name: 'Export', exact: true }).click();
		const draft = importPlayerStyle(await output.inputValue());
		expect(draft.map((s) => s.id)).toEqual(layout.map((s) => s.id));
		expect(draft[0]).toMatchObject(layout[0]);
	}
	await importDraft();
	expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: 'Player settings', exact: true }).click();
	await share.click();
	expect(await output.inputValue()).toBe(original);
	await importDraft();
	await page.getByRole('button', { name: 'Save layout', exact: true }).click();
	const saved = await page.evaluate((k) => localStorage.getItem(k), key);
	expect(JSON.parse(saved || '[]')[0]).toMatchObject(layout[0]);
});

test('layout files round trip offline through review, cancellation and an explicit save', async ({
	page
}) => {
	const { share, input, output, load } = await openEditor(page);
	const original = await output.inputValue();
	const draft = exportPlayerStyle(layout);
	const button = (name: string) => page.getByRole('button', { name, exact: true });
	async function choose(data: Buffer | null) {
		const chooser = page.waitForEvent('filechooser');
		await button('Choose layout file').click();
		await (
			await chooser
		).setFiles(data ? { name: 'layout.json', mimeType: 'application/json', buffer: data } : []);
	}

	await page.context().setOffline(true);
	await button('Import').click();
	await choose(Buffer.from(draft));
	await expect(page.getByText('1 row · 2 elements')).toBeVisible();
	await choose(null);
	await expect(input).toHaveValue(draft);
	await expect(load).toBeVisible();
	await choose(Buffer.from('{'));
	await expect(page.getByRole('alert')).toHaveText('Enter valid layout JSON.');
	await expect(load).toHaveCount(0);
	await choose(Buffer.from([0xc3, 0x28]));
	await expect(page.getByRole('alert')).toHaveText('Could not read this layout as UTF-8 text.');
	await choose(Buffer.alloc(65537, ' '));
	await expect(page.getByRole('alert')).toHaveText('Use a layout no larger than 64 KiB.');
	await button('Export').click();
	await expect(output).toHaveValue(original);
	await button('Import').click();
	await choose(Buffer.from(draft));
	await load.click();
	await button('Export').click();
	const exported = await output.inputValue();
	const downloading = page.waitForEvent('download');
	await button('Save layout file').click();
	const download = await downloading;
	expect(download.suggestedFilename()).toBe('droppedneedle-player-layout.json');
	const bytes = await readFile((await download.path())!);
	expect(bytes.toString('utf8')).toEqual(exported);
	expect(importPlayerStyle(exported)[0]).toMatchObject(layout[0]);
	await button('Cancel').click();
	expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();

	await button('Player settings').click();
	await share.click();
	await expect(output).toHaveValue(original);
	await button('Import').click();
	await choose(bytes);
	await expect(input).toHaveValue(exported);
	await expect(page.getByText('1 row · 2 elements')).toBeVisible();
	await load.click();
	expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
	await button('Save layout').click();
	const saved = await page.evaluate((k) => localStorage.getItem(k), key);
	expect(JSON.parse(saved || '[]')[0]).toMatchObject(layout[0]);
});
