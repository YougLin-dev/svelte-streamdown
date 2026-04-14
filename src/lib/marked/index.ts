import {
	Lexer,
	type MarkedToken,
	type RendererExtensionFunction,
	type Token,
	type TokenizerExtensionFunction,
	type TokenizerStartFunction,
	type TokenizerThis,
	type Tokens,
	type TokensList
} from 'marked';
import { markedAlert, type AlertToken } from './marked-alert.js';
import { markedFootnote, type FootnoteToken } from './marked-footnotes.js';
import { markedMath, type MathToken } from './marked-math.js';
import { markedSub, markedSup, type SubSupToken } from './marked-subsup.js';
import { markedList, type ListItemToken, type ListToken } from './marked-list.js';
import { markedBr, type BrToken } from './marked-br.js';
import { markedHr, type HrToken } from './marked-hr.js';
import {
	markedTable,
	type TableToken,
	type THead,
	type TBody,
	type TFoot,
	type THeadRow,
	type TRow,
	type TH,
	type TD
} from './marked-table.js';
import {
	markedDl,
	type DescriptionDetailToken,
	type DescriptionListToken,
	type DescriptionTermToken,
	type DescriptionToken
} from './marked-dl.js';
import { markedAlign, type AlignToken } from './marked-align.js';
import { markedCitations, type CitationToken } from './marked-citations.js';
import { markedMdx, type MdxToken } from './marked-mdx.js';

export type GenericToken = {
	type: string;
	raw: string;
	tokens?: Token[];
} & Record<string, any>;

export type Extension = {
	name: string;
	level: 'block' | 'inline';
	tokenizer: (
		this: TokenizerThis,
		src: string,
		tokens: Token[] | TokensList
	) => GenericToken | undefined;
	start?: TokenizerStartFunction;
	applyInBlockParsing?: boolean;
};

export type InlineSyntaxOptions = {
	subscript?: boolean;
	superscript?: boolean;
};

export type StreamdownToken =
	| Exclude<MarkedToken, Tokens.List | Tokens.ListItem | Tokens.Table>
	| ListToken
	| ListItemToken
	| MathToken
	| AlertToken
	| FootnoteToken
	| SubSupToken
	| BrToken
	| HrToken
	| TableToken
	| THead
	| TBody
	| TFoot
	| THeadRow
	| TRow
	| TH
	| TD
	| DescriptionListToken
	| DescriptionToken
	| DescriptionDetailToken
	| DescriptionTermToken
	| AlignToken
	| CitationToken
	| MdxToken;

// Re-export table types from marked-table
export type { TableToken, THead, TBody, TFoot, THeadRow, TRow, TH, TD } from './marked-table.js';

const parseExtensions = (...extensions: Extension[]) => {
	const options: {
		gfm: boolean;
		extensions: {
			block: TokenizerExtensionFunction[];
			inline: TokenizerExtensionFunction[];
			childTokens: Record<string, string[]>;
			renderers: Record<string, RendererExtensionFunction>;
			startBlock: TokenizerStartFunction[];
			startInline: TokenizerStartFunction[];
		};
	} = {
		gfm: true,
		extensions: {
			block: [],
			inline: [],
			childTokens: {},
			renderers: {},
			startBlock: [],
			startInline: []
		}
	};

	extensions.forEach(({ level, name, tokenizer, ...rest }) => {
		if ('start' in rest && rest.start) {
			if (level === 'block') {
				options.extensions.startBlock!.push(rest.start as TokenizerStartFunction);
			} else {
				options.extensions.startInline!.push(rest.start as TokenizerStartFunction);
			}
		}
		if (tokenizer) {
			if (level === 'block') {
				options.extensions.block.push(tokenizer);
			} else {
				options.extensions.inline.push(tokenizer);
			}
		}
	});

	return options;
};

// Pre-compute footnote extensions (safeGetContext runs lazily inside tokenizers)
const _defaultFootnoteExtensions = markedFootnote();

const normalizeInlineSyntaxOptions = (options?: InlineSyntaxOptions) => ({
	subscript: options?.subscript ?? true,
	superscript: options?.superscript ?? true
});

const getInlineExtensions = (options?: InlineSyntaxOptions): Extension[] => {
	const normalized = normalizeInlineSyntaxOptions(options);
	const extensions: Extension[] = [];

	if (normalized.subscript) {
		extensions.push(markedSub);
	}

	if (normalized.superscript) {
		extensions.push(markedSup);
	}

	return extensions;
};

// Pre-compute default Lexer options for lex() and parseBlocks()
const _defaultLexOptions = parseExtensions(
	markedHr,
	markedTable,
	..._defaultFootnoteExtensions,
	markedAlert,
	...markedMath,
	...getInlineExtensions(),
	markedList,
	markedBr,
	markedDl,
	markedAlign,
	markedCitations,
	markedMdx
);

const _defaultBlockOptions = parseExtensions(
	markedHr,
	..._defaultFootnoteExtensions,
	...markedMath,
	markedDl,
	markedTable,
	markedAlign,
	markedMdx
);

export const lex = (
	markdown: string,
	extensions: Extension[] = [],
	inlineSyntaxOptions?: InlineSyntaxOptions
): StreamdownToken[] => {
	const inlineExtensions = getInlineExtensions(inlineSyntaxOptions);
	const normalizedInlineSyntax = normalizeInlineSyntaxOptions(inlineSyntaxOptions);
	const options =
		extensions.length === 0 &&
		normalizedInlineSyntax.subscript &&
		normalizedInlineSyntax.superscript
			? _defaultLexOptions
			: parseExtensions(
					markedHr,
					markedTable,
					..._defaultFootnoteExtensions,
					markedAlert,
					...markedMath,
					...inlineExtensions,
					markedList,
					markedBr,
					markedDl,
					markedAlign,
					markedCitations,
					markedMdx,
					...extensions
				);
	return new Lexer(options)
		.lex(markdown)
		.filter((token) => token.type !== 'space' && token.type !== 'footnote') as StreamdownToken[];
};

// Incremental parseBlocks cache
let _pbCache: {
	content: string;
	blocks: string[];
	stableLength: number; // byte offset where stable prefix ends
	extensionsRef: Extension[] | undefined;
} | null = null;

const _doParseBlocks = (markdown: string, extensions: Extension[]): string[] => {
	const blockExtensions = extensions.filter(
		({ level, applyInBlockParsing }) => level === 'block' && applyInBlockParsing
	);
	const options =
		blockExtensions.length === 0
			? _defaultBlockOptions
			: parseExtensions(
					markedHr,
					..._defaultFootnoteExtensions,
					markedDl,
					markedTable,
					markedAlign,
					markedMdx,
					...blockExtensions
				);
	const blockLexer = new Lexer(options);

	return blockLexer.blockTokens(markdown, []).reduce((acc, block) => {
		if (block.type === 'space' || block.type === 'footnote') {
			return acc;
		} else {
			acc.push(block.raw);
		}
		return acc;
	}, [] as string[]);
};

export const parseBlocks = (markdown: string, extensions: Extension[] = []): string[] => {
	// Incremental path: if content was appended (streaming), only re-parse the tail
	if (
		_pbCache &&
		_pbCache.extensionsRef === extensions &&
		_pbCache.blocks.length > 0 &&
		markdown.length > _pbCache.content.length &&
		markdown.startsWith(_pbCache.content)
	) {
		// Re-parse from the start of the last cached block onward
		const tail = markdown.slice(_pbCache.stableLength);
		const stableBlocks = _pbCache.stableLength > 0 ? _pbCache.blocks.slice(0, -1) : [];
		const newBlocks = _doParseBlocks(tail, extensions);
		const result = stableBlocks.concat(newBlocks);

		// Update cache
		let stableLength = 0;
		for (let i = 0; i < result.length - 1; i++) {
			stableLength += result[i].length;
		}
		_pbCache = { content: markdown, blocks: result, stableLength, extensionsRef: extensions };
		return result;
	}

	// Full parse (first call, content replaced, extensions changed, etc.)
	const result = _doParseBlocks(markdown, extensions);

	// Cache result
	let stableLength = 0;
	for (let i = 0; i < result.length - 1; i++) {
		stableLength += result[i].length;
	}
	_pbCache = { content: markdown, blocks: result, stableLength, extensionsRef: extensions };
	return result;
};

export type {
	MathToken,
	AlertToken,
	FootnoteToken,
	SubSupToken,
	BrToken,
	HrToken,
	AlignToken,
	CitationToken,
	MdxToken
};
