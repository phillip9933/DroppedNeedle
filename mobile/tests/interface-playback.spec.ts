import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { emptyBoardRead } from './fixtures/emptyBoardRead';

declare global {
	interface Window {
		fixtureVolumes: number[];
	}
}

const server = 'https://playback.example/collection';
const original = fileURLToPath(
	new URL('../../server/tests/fixtures/library/management_full.wav', import.meta.url)
);
const converted = fileURLToPath(
	new URL('../../server/tests/fixtures/library/management_full.opus', import.meta.url)
);

async function connect(page: Page) {
	const streams: string[] = [];
	let conversion = 'on';
	await page.route(server + '/api/v3/**', async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.slice('/collection/api/v3'.length);
		const json = (value: unknown) => route.fulfill({ json: value });
		if (path === '/auth/providers') return json({ local: true, oidc: false });
		if (path === '/auth/login') return json({ token: 'fixture-device' });
		expect(route.request().headers().authorization).toBe('Bearer fixture-device');
		if (path === '/me') return json({ id: 'listener', display_name: 'Listener', role: 'user' });
		if (path === '/playback/conversion') return json({ conversion });
		if (path === '/library/albums')
			return json({
				items: [{ id: 'a', title: 'Nightfall', artist_name: 'Strings', art_missing: true }],
				next: null
			});
		if (path === '/library/albums/match/a')
			return json({
				items: [
					{
						id: 'first',
						title: 'Reflections',
						artist_name: 'Strings',
						album_title: 'Nightfall',
						duration_seconds: 0.3,
						disc_number: 1,
						track_number: 1
					}
				],
				total: 1
			});
		if (path === '/stream/local/first') {
			streams.push(url.search);
			const opus = url.searchParams.get('format') === 'opus';
			return route.fulfill({
				path: opus ? converted : original,
				contentType: opus ? 'audio/ogg' : 'audio/wav'
			});
		}
		if (await emptyBoardRead(route)) return;
		throw Error('Unexpected request ' + path);
	});
	await page.goto('/');
	await page.getByLabel('Server address').fill(server);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Username').fill('listener');
	await page.getByLabel('Password', { exact: true }).fill('fixture');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
	return {
		streams,
		disableConversion: () => {
			conversion = 'off';
		}
	};
}
async function settings(page: Page, section: string) {
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: section, exact: true }).click();
}
async function back(page: Page, heading: string) {
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

test('a floating glass dock keeps hidden screens and Settings accessible when every tab is removed', async ({
	page
}) => {
	await connect(page);
	await settings(page, 'Interface and navigation');
	await page.getByRole('button', { name: 'Glass', exact: true }).click();
	await page.getByRole('slider', { name: 'Glass blur' }).fill('19');
	await page.getByRole('button', { name: 'Floating', exact: true }).click();
	await page.getByLabel('Screen transitions').selectOption('gentle');
	await page.getByRole('button', { name: 'Move Library earlier' }).click();
	await page.getByRole('checkbox', { name: 'Discover', exact: true }).uncheck();
	await page.getByRole('checkbox', { name: 'Settings shortcut in header' }).uncheck();
	await back(page, 'Settings');
	await back(page, 'Home');
	const nav = page.getByRole('navigation', { name: 'Music' });
	await expect(nav.getByRole('button').first()).toHaveText('Library');
	await expect(nav).toHaveCSS('backdrop-filter', 'blur(19px)');
	await expect(page.locator('footer')).toHaveCSS('position', 'absolute');
	await nav.getByRole('button', { name: 'More navigation options' }).click();
	const menu = page.getByRole('dialog', { name: 'More destinations' });
	await menu.getByRole('button', { name: 'Discover', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Discover', exact: true })).toBeVisible();
	await nav.getByRole('button', { name: 'More navigation options' }).click();
	await menu.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Interface and navigation' }).click();
	for (const id of ['Library', 'Home', 'Search', 'Requests'])
		await page.getByRole('checkbox', { name: id, exact: true }).uncheck();
	await back(page, 'Settings');
	await back(page, 'Discover');
	await expect(nav.getByRole('button')).toHaveCount(1);
	await nav.getByRole('button').click();
	await expect(menu.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-navigation', 'floating');
	await expect(page.locator('html')).toHaveAttribute('data-material', 'glass');
	await expect(page.locator('html')).toHaveAttribute('data-motion', 'gentle');
});

test('DN conversion and local fades apply to playback through the normal album action', async ({
	page
}) => {
	await page.addInitScript(() => {
		const audio = window.Audio;
		const volumes: number[] = [];
		Object.assign(window, {
			fixtureVolumes: volumes,
			Audio: new Proxy(audio, {
				construct(target, args) {
					const element = Reflect.construct(target, args) as HTMLAudioElement;
					element.addEventListener('volumechange', () => volumes.push(element.volume));
					return element;
				}
			})
		});
	});
	const fixture = await connect(page);
	async function play() {
		await page
			.getByRole('button', { name: /Nightfall/ })
			.first()
			.click();
		await page.getByRole('button', { name: 'Play album', exact: true }).click();
		await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible();
		await page.getByRole('button', { name: 'Close player', exact: true }).click();
		await expect(page.getByRole('navigation', { name: 'Music' })).toBeVisible();
	}
	await play();
	expect(fixture.streams).toEqual(['']);
	await settings(page, 'Streaming and fades');
	await expect(page.getByText(/DN can convert streams/)).toBeVisible();
	await page.getByLabel('Audio format').selectOption('opus');
	await page.getByLabel('Requested bitrate').selectOption('128');
	await page.getByLabel('Fade in and out').selectOption('500');
	await back(page, 'Settings');
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await page
		.getByRole('navigation', { name: 'Music' })
		.getByRole('button', { name: 'Home', exact: true })
		.click();
	await play();
	expect(fixture.streams).toEqual(['', '?format=opus&max_bitrate=128']);
	await expect
		.poll(() => page.evaluate(() => window.fixtureVolumes.some((v) => v < 0.1)))
		.toBe(true);
	fixture.disableConversion();
	await settings(page, 'Streaming and fades');
	await expect(page.getByText(/Conversion is turned off/)).toBeVisible();
	await expect(page.getByRole('option', { name: 'Opus', exact: true })).toHaveJSProperty(
		'disabled',
		true
	);
	await expect(page.getByLabel('Fade in and out')).toHaveValue('500');
	await page.getByLabel('Audio format').selectOption('original');
});
