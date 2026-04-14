import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SubSupBehaviorFixture from './fixtures/SubSupBehaviorFixture.svelte';

test('Streamdown preserves legacy subscript behavior by default while allowing explicit opt-out', async () => {
	const screen = await render(SubSupBehaviorFixture);

	const defaultEnabled = screen.container.querySelector(
		'[data-testid="default-subscript-enabled"]'
	) as HTMLElement | null;
	const literalApproximation = screen.container.querySelector(
		'[data-testid="literal-approximation"]'
	) as HTMLElement | null;
	const literalSubscriptDisabled = screen.container.querySelector(
		'[data-testid="literal-subscript-disabled"]'
	) as HTMLElement | null;

	expect(defaultEnabled?.querySelector('[data-streamdown-sub]')).not.toBeNull();
	expect(defaultEnabled?.textContent).toContain('H2O');
	expect(literalApproximation?.textContent).toContain('~0.1–0.3ms');
	expect(literalApproximation?.querySelector('[data-streamdown-sub]')).toBeNull();
	expect(literalSubscriptDisabled?.querySelector('[data-streamdown-sub]')).toBeNull();
});

test('parseIncompleteMarkdown prop controls whether Streamdown auto-completes subscript syntax', async () => {
	const screen = await render(SubSupBehaviorFixture);

	const disabledIncomplete = screen.container.querySelector(
		'[data-testid="incomplete-subscript-disabled"]'
	) as HTMLElement | null;
	const enabledIncomplete = screen.container.querySelector(
		'[data-testid="incomplete-subscript-enabled"]'
	) as HTMLElement | null;

	expect(disabledIncomplete?.textContent).toContain('H~2');
	expect(disabledIncomplete?.querySelector('[data-streamdown-sub]')).toBeNull();
	expect(enabledIncomplete?.querySelector('[data-streamdown-sub]')).not.toBeNull();
	expect(enabledIncomplete?.textContent).toContain('H2');
});
