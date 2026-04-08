import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CodeHeaderSnippetFixture from './fixtures/CodeHeaderSnippetFixture.svelte';

test('codeHeader snippet can replace the header while keeping default actions', async () => {
	const screen = await render(CodeHeaderSnippetFixture);

	await expect.element(screen.getByTestId('custom-code-header')).toBeVisible();
	await expect.element(screen.getByText('html custom')).toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Preview' })).toBeVisible();
	await expect.element(screen.getByTitle('Download code')).toBeVisible();

	await screen.getByRole('button', { name: 'Preview' }).click();

	await expect.element(screen.getByText('Preview clicks: 1')).toBeVisible();
});
