import { expect, test } from 'vitest';
import { shadcnTheme, theme } from '$lib/theme.js';

test('table row theming keeps header borders and removes the last row border per section', () => {
	for (const currentTheme of [theme, shadcnTheme]) {
		expect(currentTheme.tr.base).toContain('border-b');
		expect(currentTheme.tr.base).not.toContain('not-last:border-b');
		expect(currentTheme.tbody.base).toContain('[&>tr:last-child]:border-b-0');
		expect(currentTheme.tfoot.base).toContain('[&>tr:last-child]:border-b-0');
	}
});
