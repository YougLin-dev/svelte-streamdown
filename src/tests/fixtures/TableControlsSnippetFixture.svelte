<script lang="ts">
	import { Streamdown } from '$lib/index.js';

	let inspectClicks = $state(0);

	const content = `| Name | Score |
| ---- | ----- |
| Ada  | 42    |
| Lin  | 64    |`;
</script>

<Streamdown {content}>
	{#snippet tableControls({ buttons })}
		<div data-testid="custom-table-controls" class="flex items-center justify-end gap-2 p-1">
			<button type="button" aria-label="Inspect table" onclick={() => inspectClicks++}>
				Inspect
			</button>
			{@render buttons()}
		</div>
	{/snippet}
</Streamdown>

<p>Inspect clicks: {inspectClicks}</p>
