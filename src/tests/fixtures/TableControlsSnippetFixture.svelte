<script lang="ts">
	import { Streamdown } from '$lib/index.js';

	let inspectClicks = $state(0);
	let lastContent = $state('');

	const content = `| Name | Score |
| ---- | ----- |
| Ada  | 42    |
| Lin  | 64    |`;
</script>

<Streamdown {content}>
	{#snippet tableControls({ methods, buttons })}
		<button
			data-testid="custom-table-controls"
			type="button"
			aria-label="Inspect table"
			onclick={() => {
				inspectClicks++;
				lastContent = methods.getContent('Markdown') ?? '';
			}}
		>
			Inspect
		</button>
		{@render buttons()}
	{/snippet}
</Streamdown>

<p>Inspect clicks: {inspectClicks}</p>
<p data-testid="last-content">{lastContent}</p>
