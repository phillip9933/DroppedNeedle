import { expect, test } from '@playwright/test';

test('a shared theme survives restart and invalid input leaves the selected theme active', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('button', { name: 'Paper' }).click();
	await page.getByText('Edit or share theme').click();
	const editor = page.getByLabel('Theme JSON');
	const theme = JSON.parse(await editor.inputValue());
	theme.name = 'Quiet';
	theme.spacing = 20;
	theme.corners = 0;
	theme.typeface = 'serif';
	await editor.fill(JSON.stringify(theme));
	await page.getByRole('button', { name: 'Apply theme' }).click();
	await expect(page.getByRole('status')).toHaveText('Applied Quiet.');
	await editor.fill(
		JSON.stringify({ ...theme, colors: { ...theme.colors, bg: 'url(https://invalid.example)' } })
	);
	await page.getByRole('button', { name: 'Apply theme' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await page.reload();
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByText('Edit or share theme').click();
	expect(JSON.parse(await editor.inputValue())).toEqual(theme);
	await expect(page.locator('html')).toHaveCSS('--gap', '20px');
});
