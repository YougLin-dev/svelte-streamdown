import type { Extension } from './index.js';
import {
	canInterpretSubSup,
	getVisibleTrailingCharacterFromTokens
} from '../utils/subsup-intent.js';

const subRule = /^~([^~\s](?:[^~]*[^~\s])?)~/; // ~text~
const supRule = /^\^([^\^\s](?:[^\^]*[^\^\s])?)\^/; // ^text^

export const markedSub: Extension = {
	name: 'sub',
	level: 'inline',
	start(src: string) {
		const i = src.indexOf('~');
		return i === -1 ? undefined : i;
	},
	tokenizer(this, src, tokens) {
		const match = src.match(subRule);
		if (match) {
			const text = match[1];
			if (
				!canInterpretSubSup({
					kind: 'subscript',
					mode: 'explicit',
					previousCharacter: getVisibleTrailingCharacterFromTokens(
						Array.isArray(tokens) ? tokens : undefined
					),
					content: text
				})
			) {
				return;
			}

			return {
				type: 'sub',
				raw: match[0],
				text,
				tokens: this.lexer.inlineTokens(text)
			} satisfies SubToken;
		}
	}
};

export const markedSup: Extension = {
	name: 'sup',
	level: 'inline',
	start(src: string) {
		const i = src.indexOf('^');
		return i === -1 ? undefined : i;
	},
	tokenizer(this, src, tokens) {
		const match = src.match(supRule);
		if (match) {
			const text = match[1];
			if (
				!canInterpretSubSup({
					kind: 'superscript',
					mode: 'explicit',
					previousCharacter: getVisibleTrailingCharacterFromTokens(
						Array.isArray(tokens) ? tokens : undefined
					),
					content: text
				})
			) {
				return;
			}

			return {
				type: 'sup',
				raw: match[0],
				text,
				tokens: this.lexer.inlineTokens(text)
			} satisfies SupToken;
		}
	}
};

/**
 * Represents a subscript token.
 */
export type SubToken = {
	type: 'sub';
	raw: string;
	text: string;
	tokens: any[];
};

/**
 * Represents a superscript token.
 */
export type SupToken = {
	type: 'sup';
	raw: string;
	text: string;
	tokens: any[];
};

export type SubSupToken = SubToken | SupToken;
