import type { Locator } from '@playwright/test';
import { chooseOption } from './inlineChoice';

export async function openRule(dialog: Locator, field: string) {
	await dialog.getByRole('button', { name: 'Add rule', exact: true }).first().click();
	await dialog.getByRole('button', { name: field, exact: true }).click();
}
export async function applyRule(dialog: Locator) {
	await dialog.getByRole('button', { name: 'Apply rule', exact: true }).click();
}
export async function ratingRule(dialog: Locator, stars: number, atLeast = false) {
	await openRule(dialog, 'Rating');
	if (atLeast) await chooseOption(dialog.getByLabel('Condition'), 'atLeast');
	await dialog.getByRole('button', { name: stars + ' stars', exact: true }).click();
	await applyRule(dialog);
}
export async function favoriteRule(dialog: Locator) {
	await openRule(dialog, 'Favorite');
	await applyRule(dialog);
}
export async function playlistOptions(dialog: Locator) {
	const summary = dialog.locator('summary').filter({ hasText: 'Playlist options' });
	if (!(await dialog.getByLabel('Playlist sort').isVisible())) await summary.click();
}
export async function trackLimit(dialog: Locator, n: number) {
	await playlistOptions(dialog);
	await chooseOption(dialog.getByRole('combobox', { name: 'Track limit' }), 'custom');
	await dialog.getByLabel('Maximum tracks').fill(String(n));
}
