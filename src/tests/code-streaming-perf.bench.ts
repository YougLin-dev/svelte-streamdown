import { bench, describe } from 'vitest';
import { lex, parseBlocks } from '../lib/marked/index.js';
import { parseIncompleteMarkdown } from '../lib/utils/parse-incomplete-markdown.js';

// ============================================================
// Simulate what actually happens in the browser during streaming:
//
//   Streamdown.svelte:  blocks = $derived(parseBlocks(content))
//   Block.svelte:       tokens = $derived(lex(parseIncompleteMarkdown(block.trim())))
//
// Every single character appended to `content` triggers the FULL
// pipeline on the ENTIRE document. No caching, no diffing.
//
// The cost of streaming N characters is:
//   Σ(i=1..N) cost(parseBlocks(content[0..i]))
//             + Σ blocks × cost(parseIncompleteMarkdown + lex)
//
// This is O(N²) in document size — the root cause of CPU spikes.
// ============================================================

/**
 * Simulates the exact render pipeline that fires on every content update.
 * This is what Streamdown.svelte + Block.svelte do on each reactive tick.
 */
function renderPipeline(content: string): void {
	const blocks = parseBlocks(content);
	for (const block of blocks) {
		lex(parseIncompleteMarkdown(block.trim()));
	}
}

// --- Realistic streaming content ---

const STREAMING_CODE = `# Example Response

Here's a function that implements binary search:

\`\`\`typescript
function binarySearch(arr: number[], target: number): number {
  let low = 0;
  let high = arr.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = arr[mid];

    if (value === target) {
      return mid;
    } else if (value < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return -1;
}

// Usage example
const numbers = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
const index = binarySearch(numbers, 7);
console.log(\`Found at index: \${index}\`);
\`\`\`

The time complexity is O(log n) because we halve the search space each iteration.
`;

const MULTI_BLOCK_RESPONSE = `# API Documentation

## Authentication

First, set up your API key:

\`\`\`typescript
import { Client } from '@api/sdk';

const client = new Client({
  apiKey: process.env.API_KEY,
  baseUrl: 'https://api.example.com',
  timeout: 30000,
  retries: 3,
});
\`\`\`

## Making Requests

Here's how to make a basic request:

\`\`\`typescript
async function fetchUsers(page: number = 1) {
  const response = await client.get('/users', {
    params: { page, limit: 20 },
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
  }

  return response.data;
}
\`\`\`

## Error Handling

Wrap calls in try-catch:

\`\`\`typescript
async function safeRequest<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NetworkError) {
      console.error('Network failure:', error.message);
    } else if (error instanceof AuthError) {
      console.error('Auth expired, refreshing token...');
      await client.refreshToken();
      return fn();
    }
    return null;
  }
}
\`\`\`

## Streaming Responses

For large datasets, use streaming:

\`\`\`typescript
async function* streamResults(query: string) {
  let cursor: string | undefined;

  do {
    const response = await client.get('/search', {
      params: { q: query, cursor, limit: 100 },
    });

    for (const item of response.data.results) {
      yield item;
    }

    cursor = response.data.nextCursor;
  } while (cursor);
}

// Usage
for await (const result of streamResults('example')) {
  processResult(result);
}
\`\`\`

That covers the basics of the API client.
`;

// Generate token-by-token chunks (simulates LLM streaming)
function tokenChunks(text: string): string[] {
	// Split by whitespace boundaries to simulate token-level streaming
	const tokens = text.match(/\S+\s*/g) || [];
	const chunks: string[] = [];
	let accumulated = '';
	for (const token of tokens) {
		accumulated += token;
		chunks.push(accumulated);
	}
	return chunks;
}

// Generate character-by-character chunks for worst case
function charChunks(text: string, step: number): string[] {
	const chunks: string[] = [];
	for (let i = step; i <= text.length; i += step) {
		chunks.push(text.substring(0, i));
	}
	if (chunks[chunks.length - 1] !== text) {
		chunks.push(text);
	}
	return chunks;
}

// Pre-generate chunks
const singleBlockTokens = tokenChunks(STREAMING_CODE);
const multiBlockTokens = tokenChunks(MULTI_BLOCK_RESPONSE);
const singleBlockChars = charChunks(STREAMING_CODE, 5);
const multiBlockChars = charChunks(MULTI_BLOCK_RESPONSE, 10);

// ============================================================
// Benchmarks: Real streaming simulation
// ============================================================

describe('streaming: single code block response (~500 chars, token-by-token)', () => {
	bench(`full stream — ${singleBlockTokens.length} updates, each re-parses entire doc`, () => {
		for (const chunk of singleBlockTokens) {
			renderPipeline(chunk);
		}
	});
});

describe('streaming: multi-block response (~1500 chars, token-by-token)', () => {
	bench(`full stream — ${multiBlockTokens.length} updates, each re-parses entire doc`, () => {
		for (const chunk of multiBlockTokens) {
			renderPipeline(chunk);
		}
	});
});

describe('streaming: single code block (char-by-char, 5-char steps)', () => {
	bench(`full stream — ${singleBlockChars.length} updates`, () => {
		for (const chunk of singleBlockChars) {
			renderPipeline(chunk);
		}
	});
});

describe('streaming: multi-block response (char-by-char, 10-char steps)', () => {
	bench(`full stream — ${multiBlockChars.length} updates`, () => {
		for (const chunk of multiBlockChars) {
			renderPipeline(chunk);
		}
	});
});

// ============================================================
// Per-update cost at different document sizes
// Shows the O(n) per-update growth that causes CPU spikes
// ============================================================

describe('per-update cost: renderPipeline at different content sizes', () => {
	// Snapshot content at different points during streaming
	const at25pct = MULTI_BLOCK_RESPONSE.substring(0, Math.floor(MULTI_BLOCK_RESPONSE.length * 0.25));
	const at50pct = MULTI_BLOCK_RESPONSE.substring(0, Math.floor(MULTI_BLOCK_RESPONSE.length * 0.5));
	const at75pct = MULTI_BLOCK_RESPONSE.substring(0, Math.floor(MULTI_BLOCK_RESPONSE.length * 0.75));
	const at100pct = MULTI_BLOCK_RESPONSE;

	bench(`single update at 25% (${at25pct.length} chars)`, () => {
		renderPipeline(at25pct);
	});

	bench(`single update at 50% (${at50pct.length} chars)`, () => {
		renderPipeline(at50pct);
	});

	bench(`single update at 75% (${at75pct.length} chars)`, () => {
		renderPipeline(at75pct);
	});

	bench(`single update at 100% (${at100pct.length} chars)`, () => {
		renderPipeline(at100pct);
	});
});

// ============================================================
// Breakdown: where does the time go?
// ============================================================

describe('breakdown: parseBlocks cost at different sizes', () => {
	const at25pct = MULTI_BLOCK_RESPONSE.substring(0, Math.floor(MULTI_BLOCK_RESPONSE.length * 0.25));
	const at100pct = MULTI_BLOCK_RESPONSE;

	bench(`parseBlocks at 25% (${at25pct.length} chars)`, () => {
		parseBlocks(at25pct);
	});

	bench(`parseBlocks at 100% (${at100pct.length} chars)`, () => {
		parseBlocks(at100pct);
	});
});

describe('breakdown: parseIncompleteMarkdown cost at different sizes', () => {
	// Simulate an incomplete code block growing
	const small = '```typescript\nconst x = 1;\nconst y = 2;';
	const medium =
		'```typescript\n' + Array.from({ length: 50 }, (_, i) => `const v${i} = ${i};`).join('\n');
	const large =
		'```typescript\n' + Array.from({ length: 200 }, (_, i) => `const v${i} = ${i};`).join('\n');
	const xlarge =
		'```typescript\n' + Array.from({ length: 500 }, (_, i) => `const v${i} = ${i};`).join('\n');

	bench(`parseIncompleteMarkdown — 3 lines`, () => {
		parseIncompleteMarkdown(small);
	});

	bench(`parseIncompleteMarkdown — 50 lines`, () => {
		parseIncompleteMarkdown(medium);
	});

	bench(`parseIncompleteMarkdown — 200 lines`, () => {
		parseIncompleteMarkdown(large);
	});

	bench(`parseIncompleteMarkdown — 500 lines`, () => {
		parseIncompleteMarkdown(xlarge);
	});
});

describe('breakdown: lex cost at different sizes', () => {
	const small = '```typescript\nconst x = 1;\nconst y = 2;\n```';
	const medium =
		'```typescript\n' +
		Array.from({ length: 50 }, (_, i) => `const v${i} = ${i};`).join('\n') +
		'\n```';
	const large =
		'```typescript\n' +
		Array.from({ length: 200 }, (_, i) => `const v${i} = ${i};`).join('\n') +
		'\n```';

	bench(`lex — 3 lines code block`, () => {
		lex(small);
	});

	bench(`lex — 50 lines code block`, () => {
		lex(medium);
	});

	bench(`lex — 200 lines code block`, () => {
		lex(large);
	});
});
