import { expect, type Locator } from '@playwright/test';

export async function choiceList(control: Locator) {
	const trigger = control.and(control.page().getByRole('combobox'));
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
	const id = await trigger.getAttribute('aria-controls');
	const list = control.page().locator('[role="listbox"][id=' + JSON.stringify(id) + ']');
	await expect(list).toBeVisible();
	return list;
}

export async function chooseOption(control: Locator, value: string | { label: string }) {
	const list = await choiceList(control);
	const option =
		typeof value === 'string'
			? list.locator('[role="option"][data-value=' + JSON.stringify(value) + ']')
			: list.getByRole('option', { name: value.label, exact: true });
	await option.click();
}
