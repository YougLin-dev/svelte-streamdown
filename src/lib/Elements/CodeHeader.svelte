<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Tokens } from 'marked';
	import { useStreamdown } from '$lib/context.svelte.js';
	import Slot from './Slot.svelte';

	interface Props {
		token: Tokens.Code;
		language?: string;
		buttons?: Snippet;
	}

	let { token, language = token.lang, buttons }: Props = $props();

	const streamdown = useStreamdown();
</script>

{#snippet DefaultButtons()}
	{@render buttons?.()}
{/snippet}

<Slot
	props={{
		token,
		language,
		controls: streamdown.controls.code,
		buttons: DefaultButtons
	}}
	render={streamdown.snippets.codeHeader}
>
	<div class={streamdown.theme.code.header}>
		<span class={streamdown.theme.code.language}>{language}</span>
		{@render DefaultButtons()}
	</div>
</Slot>
