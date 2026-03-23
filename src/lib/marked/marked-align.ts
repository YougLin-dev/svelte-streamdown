import type { Extension } from './index.js';
import type { Token } from 'marked';

export const markedAlign: Extension = {
	name: 'align',
	level: 'block',
	tokenizer(this, src) {
		// Match [center] or [right] blocks
		const match = src.match(/^\[(center|right)\]\n([\s\S]*?)(?:\n)?\[\/\1\]/);

		if (match) {
			const align = match[1] as 'center' | 'right';
			const text = match[2];
			const raw = match[0];

			// Tokenize the content inside the alignment block
			const tokens = this.lexer.blockTokens(text, []);

			return {
				type: 'align',
				align,
				raw,
				text,
				tokens
			} satisfies AlignToken;
		}

		return undefined;
	}
};

export type AlignToken = {
	type: 'align';
	align: 'center' | 'right';
	raw: string;
	text: string;
	tokens: Token[];
};
