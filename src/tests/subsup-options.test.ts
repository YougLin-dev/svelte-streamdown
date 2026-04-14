import { describe, expect, test } from 'vitest';
import { lex } from '../lib/marked/index.js';
import { parseIncompleteMarkdown } from '../lib/utils/parse-incomplete-markdown.js';

describe('inline syntax options', () => {
	test('lex keeps current subscript behavior by default for direct API callers', () => {
		const tokens = lex('Water formula H~2~O.');
		const paragraph = tokens.find((token) => token.type === 'paragraph');

		expect(paragraph).toBeDefined();
		expect((paragraph?.tokens ?? []).filter((token) => token.type === 'sub')).toHaveLength(1);
	});

	test('lex can disable subscript tokenization', () => {
		const tokens = lex('Water formula H~2~O.', [], { subscript: false });
		const paragraph = tokens.find((token) => token.type === 'paragraph');

		expect(paragraph).toBeDefined();
		expect((paragraph?.tokens ?? []).filter((token) => token.type === 'sub')).toHaveLength(0);
	});

	test('lex can disable superscript tokenization', () => {
		const tokens = lex('Formula: E = mc^2^.', [], { superscript: false });
		const paragraph = tokens.find((token) => token.type === 'paragraph');

		expect(paragraph).toBeDefined();
		expect((paragraph?.tokens ?? []).filter((token) => token.type === 'sup')).toHaveLength(0);
	});

	test('parseIncompleteMarkdown can skip subscript completion when disabled', () => {
		expect(parseIncompleteMarkdown('Water formula H~2', { subscript: false })).toBe(
			'Water formula H~2'
		);
	});

	test('parseIncompleteMarkdown can skip superscript completion when disabled', () => {
		expect(parseIncompleteMarkdown('Formula: E = mc^2', { superscript: false })).toBe(
			'Formula: E = mc^2'
		);
	});
});
