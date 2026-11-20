import type { Page } from '@playwright/test';

export async function openPlayerPlacement(page: Page) {
	const placement = page.locator('.canvas details.advanced');
	if ((await placement.getAttribute('open')) === null)
		await placement.getByText('Placement and sizing', { exact: true }).click();
}
