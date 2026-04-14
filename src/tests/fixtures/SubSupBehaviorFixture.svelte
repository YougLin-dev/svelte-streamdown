<script lang="ts">
	import { Streamdown } from '$lib/index.js';

	const approximateContent = '~0.1–0.3ms';
	const explicitSubscriptContent = 'Water formula H~2~O.';
	const incompleteSubscriptContent = 'Water formula H~2';
</script>

<section data-testid="default-subscript-enabled">
	<Streamdown content={explicitSubscriptContent} />
</section>

<section data-testid="literal-approximation">
	<Streamdown content={approximateContent} subscript={false} superscript={false} />
</section>

<section data-testid="literal-subscript-disabled">
	<Streamdown content={explicitSubscriptContent} subscript={false} />
</section>

<section data-testid="incomplete-subscript-disabled">
	<Streamdown
		content={incompleteSubscriptContent}
		subscript={true}
		parseIncompleteMarkdown={false}
	/>
</section>

<section data-testid="incomplete-subscript-enabled">
	<Streamdown
		content={incompleteSubscriptContent}
		subscript={true}
		parseIncompleteMarkdown={true}
	/>
</section>
