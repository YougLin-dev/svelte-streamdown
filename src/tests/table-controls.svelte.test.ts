import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TableControlsSnippetFixture from './fixtures/TableControlsSnippetFixture.svelte';

test('tableControls snippet can replace the controls while keeping default actions', async () => {
	const screen = await render(TableControlsSnippetFixture);

	await expect.element(screen.getByTestId('custom-table-controls')).toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Inspect table' })).toBeVisible();
	await expect.element(screen.getByTitle('Download table')).toBeVisible();
	await expect.element(screen.getByTitle('Copy table')).toBeVisible();

	await screen.getByRole('button', { name: 'Inspect table' }).click();

	await expect.element(screen.getByText('Inspect clicks: 1')).toBeVisible();
});

test('table header keeps its bottom border while the last body row does not', async () => {
	const screen = await render(TableControlsSnippetFixture);

	const headerRow = screen.container.querySelector('[data-streamdown-thead] tr');
	const tableBody = screen.container.querySelector('[data-streamdown-tbody]');

	expect(headerRow).not.toBeNull();
	expect(tableBody).not.toBeNull();
	expect(headerRow?.className).toContain('border-b');
	expect(headerRow?.className).not.toContain('not-last:border-b');
	expect(tableBody?.className).toContain('[&>tr:last-child]:border-b-0');
});
