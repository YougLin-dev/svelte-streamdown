import { describe, expect, test } from 'vitest';
import { resolveCodeFileExtension } from '../lib/utils/code.js';

describe('resolveCodeFileExtension', () => {
	test('returns html for preview-html aliases', () => {
		expect(resolveCodeFileExtension('preview-html')).toBe('html');
	});

	test('ignores trailing fence metadata', () => {
		expect(resolveCodeFileExtension('javascript {.line-numbers}')).toBe('js');
	});

	test('falls back to txt for unknown languages', () => {
		expect(resolveCodeFileExtension('totally-unknown-lang')).toBe('txt');
	});
});
