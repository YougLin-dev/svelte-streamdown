<script lang="ts">
	import { useStreamdown } from '$lib/context.svelte.js';
	import { save } from '$lib/utils/save.js';
	import { useCopy } from '$lib/utils/copy.svelte.js';
	import { languageExtensionMap } from '$lib/utils/hightlighter.svelte.js';
	import type { Tokens } from 'marked';
	import CodeHeader from '../CodeHeader.svelte';
	import { checkIcon, copyIcon, downloadIcon } from '../icons.js';

	const {
		token,
		id
	}: {
		token: Tokens.Code;
		id: string;
	} = $props();

	const streamdown = useStreamdown();
	const copy = useCopy({
		get content() {
			return token.text;
		}
	});

	const downloadCode = () => {
		try {
			const extension =
				token.lang && token.lang in languageExtensionMap
					? languageExtensionMap[token.lang as keyof typeof languageExtensionMap]
					: 'txt';
			const filename = `file.${extension}`;
			const mimeType = 'text/plain';
			save(filename, token.text, mimeType);
		} catch (error) {
			console.error('Failed to download file:', error);
		}
	};
</script>

<div
	data-streamdown-code={id}
	style={streamdown.isMounted ? streamdown.animationBlockStyle : ''}
	class={streamdown.theme.code.base}
>
	<CodeHeader {token} buttons={DefaultButtons} />
	<div style="height: fit-content; width: 100%;" class={streamdown.theme.code.container}>
		<pre class={streamdown.theme.code.pre}><code
				>{#each token.text.split('\n') as line}<span class={streamdown.theme.code.line}
						><span style={streamdown.isMounted ? streamdown.animationTextStyle : ''}
							>{line.trim().length > 0 ? line : '\u200B'}</span
						></span
					>{/each}</code
			></pre>
	</div>
</div>

{#snippet DefaultButtons()}
	{#if streamdown.controls.code}
		<div class={streamdown.theme.code.buttons}>
			<button
				class={streamdown.theme.components.button}
				onclick={downloadCode}
				title="Download code"
				type="button"
			>
				{@render (streamdown.icons?.download || downloadIcon)()}
			</button>

			<button class={streamdown.theme.components.button} onclick={copy.copy} type="button">
				{#if copy.isCopied}
					{@render (streamdown.icons?.check || checkIcon)()}
				{:else}
					{@render (streamdown.icons?.copy || copyIcon)()}
				{/if}
			</button>
		</div>
	{/if}
{/snippet}
