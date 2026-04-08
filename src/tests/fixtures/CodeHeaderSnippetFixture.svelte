<script lang="ts">
	import { Streamdown } from '$lib/index.js';
	import Code from '$lib/Elements/Code.svelte';

	let previewClicks = $state(0);

	const content = `\`\`\`html
<div class="preview-card">Hello</div>
\`\`\``;
</script>

<Streamdown {content} components={{ code: Code }}>
	{#snippet codeHeader({ token, buttons })}
		<div
			data-testid="custom-code-header"
			class="flex items-center justify-between bg-muted/80 px-2 py-1 text-xs text-muted-foreground"
		>
			<span>{token.lang} custom</span>

			<div class="flex items-center gap-2">
				<button type="button" aria-label="Preview" onclick={() => previewClicks++}>Preview</button>
				{@render buttons()}
			</div>
		</div>
	{/snippet}
</Streamdown>

<p>Preview clicks: {previewClicks}</p>
