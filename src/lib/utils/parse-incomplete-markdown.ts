// Simplified interface that merges Plugin and PatternRule
export interface Plugin {
	name: string;
	pattern?: RegExp;
	handler?: (payload: HandlerPayload) => string;
	skipInBlockTypes?: string[]; // block types where this plugin should be skipped
	preprocess?: (payload: HookPayload) => string | { text: string; state: Partial<ParseState> };
	postprocess?: (payload: HookPayload) => string;
}

interface HookPayload {
	text: string;
	state: ParseState;
	setState: (state: Partial<ParseState>) => void;
}
interface HandlerPayload {
	line: string;
	text: string;
	match: RegExpMatchArray;
	state: ParseState;
	setState: (state: Partial<ParseState>) => void;
}

interface ParseState {
	currentLine: number;
	context: 'normal' | 'list' | 'blockquote' | 'descriptionList';
	blockingContexts: Set<'code' | 'math' | 'center' | 'right'>;
	lineContexts?: Array<{ code: boolean; math: boolean; center: boolean; right: boolean }>;
	fenceInfo?: string;
	mdxUnclosedTags?: Array<{ tagName: string; lineIndex: number }>;
	mdxLineStates?: Array<{ inMdx: boolean; incompletePositions: number[] }>;
	_lines?: string[]; // cached split result, avoids redundant split('\n')
}

export class IncompleteMarkdownParser {
	private plugins: Plugin[] = [];
	private _skipSets: Set<string>[] = [];
	private state: ParseState = {
		currentLine: 0,
		context: 'normal',
		blockingContexts: new Set(),
		lineContexts: []
	};

	// Incremental cache for streaming append detection
	private _incCache: {
		input: string;
		// Number of completed lines (lines ending with \n) that are fully stable
		stableLineCount: number;
		// Byte offset where stable lines end (position of last \n + 1 in stable region)
		stableEndOffset: number;
		// Context state at end of stable lines (for resuming contextManager scan)
		ctxState: {
			inCodeBlock: boolean;
			inMathBlock: boolean;
			inCenterBlock: boolean;
			inRightBlock: boolean;
		};
		// Processed lines for stable lines
		processedLines: string[];
		// lineContexts for stable lines
		lineContexts: Array<{ code: boolean; math: boolean; center: boolean; right: boolean }>;
		// MDX state for stable lines
		mdxOpenTags: Array<{ tagName: string; lineIndex: number }>;
		mdxLineStates: Array<{ inMdx: boolean; incompletePositions: number[] }>;
	} | null = null;

	setState = (state: Partial<ParseState>) => {
		this.state = { ...this.state, ...state };
	};

	constructor(plugins: Plugin[] = []) {
		this.plugins = plugins;
		this._skipSets = plugins.map((p) => new Set(p.skipInBlockTypes || []));
	}

	// Main parsing methods
	parse(text: string): string {
		if (!text || typeof text !== 'string') {
			return text;
		}

		// Try incremental path: if text is an append of previous input,
		// reuse cached stable lines and only process from the last changed line.
		const inc = this._incCache;
		if (
			inc &&
			text.length >= inc.input.length &&
			text.startsWith(inc.input.substring(0, inc.stableEndOffset))
		) {
			const incResult = this._parseIncremental(text, inc);
			if (incResult !== null) return incResult;
		}

		// Full parse (first call, or text was replaced/shortened)
		return this._parseFull(text);
	}

	private _parseFull(text: string): string {
		this.state = {
			currentLine: 0,
			context: 'normal',
			blockingContexts: new Set(),
			lineContexts: [],
			fenceInfo: undefined
		};

		let result = text;

		// Split once and store in state for preprocess hooks to reuse
		this.state._lines = result.split('\n');

		// Execute preprocess hooks for all plugins
		for (const plugin of this.plugins) {
			if (plugin.preprocess) {
				try {
					const preprocessResult = plugin.preprocess({
						text: result,
						state: this.state,
						setState: this.setState
					});
					if (typeof preprocessResult === 'string') {
						result = preprocessResult;
						this.state._lines = undefined;
					} else {
						if (preprocessResult.text !== result) {
							this.state._lines = undefined;
						}
						result = preprocessResult.text;
						this.setState(preprocessResult.state);
					}
				} catch (error) {
					console.error(`Plugin ${plugin.name} preprocess hook failed:`, error);
				}
			}
		}

		// Reuse cached lines if text wasn't modified by preprocess
		const lines = this.state._lines || result.split('\n');
		const processedLines = [...lines];

		// Process each line with each plugin
		for (let i = 0; i < processedLines.length; i++) {
			this.state.currentLine = i;
			let line = processedLines[i];

			for (let pi = 0; pi < this.plugins.length; pi++) {
				const plugin = this.plugins[pi];
				const currentLineContext = this.state.lineContexts?.[i];
				const skipSet = this._skipSets[pi];
				const shouldSkip =
					currentLineContext &&
					skipSet.size > 0 &&
					((currentLineContext.code && skipSet.has('code')) ||
						(currentLineContext.math && skipSet.has('math')) ||
						(currentLineContext.center && skipSet.has('center')) ||
						(currentLineContext.right && skipSet.has('right')));
				if (shouldSkip) continue;

				try {
					const match = plugin.pattern ? line.match(plugin.pattern) : line.match(/.*/);
					if (match && plugin.handler) {
						line = plugin.handler({
							line,
							text: line,
							match,
							state: this.state,
							setState: this.setState
						});
					}
				} catch (error) {
					console.error(`Plugin ${plugin.name} failed on line ${i}:`, error);
				}
			}

			processedLines[i] = line;
		}

		// Rebuild text from processed lines
		result = processedLines.join('\n');

		// Execute afterParse hooks for all plugins
		for (const plugin of this.plugins) {
			if (plugin.postprocess) {
				try {
					result = plugin.postprocess({ text: result, state: this.state, setState: this.setState });
				} catch (error) {
					console.error(`Plugin ${plugin.name} afterParse hook failed:`, error);
				}
			}
		}

		// Update incremental cache
		this._updateIncCache(text, processedLines);

		return result;
	}

	private _parseIncremental(text: string, inc: NonNullable<typeof this._incCache>): string | null {
		// Find how many completed lines in common.
		// Stable lines from cache are guaranteed to be a prefix of new text.
		const lines = text.split('\n');

		// Verify stable lines haven't changed (they should be identical since we checked startsWith)
		for (let i = 0; i < inc.stableLineCount; i++) {
			if (lines[i] !== inc.processedLines[i]) {
				// Something changed in stable region — fall back to full parse
				return null;
			}
		}

		// Resume contextManager scanning from the stable boundary
		let { inCodeBlock, inMathBlock, inCenterBlock, inRightBlock } = inc.ctxState;
		const lineContexts: Array<{ code: boolean; math: boolean; center: boolean; right: boolean }> = [
			...inc.lineContexts
		];

		for (let i = inc.stableLineCount; i < lines.length; i++) {
			const stripped = lines[i].replace(/^(?:\s*>\s*)+/, '').trim();

			if (stripped.startsWith('```') || stripped.startsWith('~~~')) {
				inCodeBlock = !inCodeBlock;
			}
			if (stripped.startsWith('$$') && !stripped.includes('$$', 2)) {
				inMathBlock = !inMathBlock;
			}
			if (stripped === '[center]') inCenterBlock = true;
			if (stripped === '[/center]') inCenterBlock = false;
			if (stripped === '[right]') inRightBlock = true;
			if (stripped === '[/right]') inRightBlock = false;

			lineContexts[i] = {
				code: inCodeBlock,
				math: inMathBlock,
				center: inCenterBlock,
				right: inRightBlock
			};
		}

		const finalContexts = new Set<'code' | 'math' | 'center' | 'right'>();
		if (inCodeBlock) finalContexts.add('code');
		if (inMathBlock) finalContexts.add('math');
		if (inCenterBlock) finalContexts.add('center');
		if (inRightBlock) finalContexts.add('right');

		// Resume MDX scanning from stable boundary
		const mdxOpenTags = [...inc.mdxOpenTags];
		const mdxLineStates: Array<{ inMdx: boolean; incompletePositions: number[] }> = [
			...inc.mdxLineStates
		];

		for (let i = inc.stableLineCount; i < lines.length; i++) {
			const line = lines[i];
			let inMdx = false;
			const incompletePositions: number[] = [];

			// Scan for MDX tags (same logic as mdx preprocess)
			let searchPos = 0;
			while (searchPos < line.length) {
				const tagStart = line.indexOf('<', searchPos);
				if (tagStart === -1 || tagStart >= line.length - 1) break;

				const nextChar = line[tagStart + 1];
				if (!/[A-Z]/.test(nextChar)) {
					searchPos = tagStart + 1;
					continue;
				}

				const selfClosingMatch = line
					.substring(tagStart)
					.match(/^<([A-Z][a-zA-Z0-9]*)((?:\s+\w+=(?:"[^"]*"|{[^}]*}))*)\\s*\/>/);
				if (selfClosingMatch) {
					searchPos = tagStart + selfClosingMatch[0].length;
					continue;
				}

				const completeMatch = line
					.substring(tagStart)
					.match(/^<([A-Z][a-zA-Z0-9]*)((?:\s+\w+=(?:"[^"]*"|{[^}]*}))*)\\s*>.*?<\/\1>/);
				if (completeMatch) {
					searchPos = tagStart + completeMatch[0].length;
					continue;
				}

				const openTagMatch = line
					.substring(tagStart)
					.match(/^<([A-Z][a-zA-Z0-9]*)((?:\s+\w+=(?:"[^"]*"|{[^}]*}))*)\\s*>/);
				if (openTagMatch) {
					mdxOpenTags.push({ tagName: openTagMatch[1], lineIndex: i });
					inMdx = true;
					searchPos = tagStart + openTagMatch[0].length;
					continue;
				}

				const incompleteSelfClosing = line
					.substring(tagStart)
					.match(/^<([A-Z][a-zA-Z0-9]*)[^>]*\/$/);
				if (incompleteSelfClosing) {
					incompletePositions.push(tagStart);
					break;
				}

				const incompleteTag = line.substring(tagStart).match(/^<([A-Z][a-zA-Z0-9]*)(?:\s+[^>]*)?$/);
				if (incompleteTag) {
					incompletePositions.push(tagStart);
					break;
				}

				searchPos = tagStart + 1;
			}

			const closeTagMatches = line.matchAll(/<\/([A-Z][a-zA-Z0-9]*)>/g);
			for (const closeMatch of closeTagMatches) {
				const tagName = closeMatch[1];
				const openIndex = mdxOpenTags.findIndex((t) => t.tagName === tagName);
				if (openIndex !== -1) mdxOpenTags.splice(openIndex, 1);
			}

			mdxLineStates[i] = { inMdx, incompletePositions };
		}

		// Set up state for per-line processing and postprocess
		this.state = {
			currentLine: 0,
			context: 'normal',
			blockingContexts: finalContexts,
			lineContexts,
			fenceInfo: undefined,
			mdxUnclosedTags: mdxOpenTags,
			mdxLineStates
		};

		// Build processedLines: reuse cached lines, process only new/changed lines
		const processedLines: string[] = [];
		for (let i = 0; i < inc.stableLineCount; i++) {
			processedLines[i] = inc.processedLines[i];
		}

		// Process lines from stableLineCount onward
		for (let i = inc.stableLineCount; i < lines.length; i++) {
			this.state.currentLine = i;
			let line = lines[i];

			for (let pi = 0; pi < this.plugins.length; pi++) {
				const plugin = this.plugins[pi];
				const currentLineContext = lineContexts[i];
				const skipSet = this._skipSets[pi];
				const shouldSkip =
					currentLineContext &&
					skipSet.size > 0 &&
					((currentLineContext.code && skipSet.has('code')) ||
						(currentLineContext.math && skipSet.has('math')) ||
						(currentLineContext.center && skipSet.has('center')) ||
						(currentLineContext.right && skipSet.has('right')));
				if (shouldSkip) continue;

				try {
					const match = plugin.pattern ? line.match(plugin.pattern) : line.match(/.*/);
					if (match && plugin.handler) {
						line = plugin.handler({
							line,
							text: line,
							match,
							state: this.state,
							setState: this.setState
						});
					}
				} catch (error) {
					console.error(`Plugin ${plugin.name} failed on line ${i}:`, error);
				}
			}

			processedLines[i] = line;
		}

		// Rebuild and postprocess
		let result = processedLines.join('\n');

		for (const plugin of this.plugins) {
			if (plugin.postprocess) {
				try {
					result = plugin.postprocess({ text: result, state: this.state, setState: this.setState });
				} catch (error) {
					console.error(`Plugin ${plugin.name} afterParse hook failed:`, error);
				}
			}
		}

		// Update cache
		this._updateIncCache(text, processedLines);

		return result;
	}

	private _updateIncCache(input: string, processedLines: string[]): void {
		// Find the last newline — lines before it are stable
		const lastNL = input.lastIndexOf('\n');
		if (lastNL < 0) {
			this._incCache = null;
			return;
		}

		const stableLineCount = input.substring(0, lastNL + 1).split('\n').length - 1;
		const stableEndOffset = lastNL + 1;

		// Compute context state at end of stable lines
		let inCodeBlock = false;
		let inMathBlock = false;
		let inCenterBlock = false;
		let inRightBlock = false;
		const ctxLineContexts = this.state.lineContexts || [];

		if (stableLineCount > 0 && ctxLineContexts[stableLineCount - 1]) {
			const lastCtx = ctxLineContexts[stableLineCount - 1];
			inCodeBlock = lastCtx.code;
			inMathBlock = lastCtx.math;
			inCenterBlock = lastCtx.center;
			inRightBlock = lastCtx.right;
		}

		// Collect MDX open tags that are within stable lines
		const mdxOpenTags = (this.state.mdxUnclosedTags || []).filter(
			(t) => t.lineIndex < stableLineCount
		);
		const mdxLineStates = (this.state.mdxLineStates || []).slice(0, stableLineCount);

		this._incCache = {
			input,
			stableLineCount,
			stableEndOffset,
			ctxState: { inCodeBlock, inMathBlock, inCenterBlock, inRightBlock },
			processedLines: processedLines.slice(0, stableLineCount),
			lineContexts: ctxLineContexts.slice(0, stableLineCount),
			mdxOpenTags,
			mdxLineStates
		};
	}

	// Create default plugins that replicate the original handler functions
	static createDefaultPlugins(): Plugin[] {
		return [
			// Block-level plugin that manages blocking contexts
			{
				name: 'contextManager',
				preprocess: ({ text, state }) => {
					// Pre-scan the entire text to establish blocking contexts
					const lines = state._lines || text.split('\n');
					let inCodeBlock = false;
					let inMathBlock = false;
					let inCenterBlock = false;
					let inRightBlock = false;

					// Track which lines are in which contexts for state management
					const lineContexts: Array<{
						code: boolean;
						math: boolean;
						center: boolean;
						right: boolean;
					}> = [];

					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];
						// Strip blockquote prefix for content detection
						const stripped = line.replace(/^(?:\s*>\s*)+/, '').trim();

						// Check for block boundaries
						if (stripped.startsWith('```') || stripped.startsWith('~~~')) {
							inCodeBlock = !inCodeBlock;
						}
						if (stripped.startsWith('$$') && !stripped.includes('$$', 2)) {
							inMathBlock = !inMathBlock;
						}
						if (stripped === '[center]') {
							inCenterBlock = true;
						}
						if (stripped === '[/center]') {
							inCenterBlock = false;
						}
						if (stripped === '[right]') {
							inRightBlock = true;
						}
						if (stripped === '[/right]') {
							inRightBlock = false;
						}

						lineContexts[i] = {
							code: inCodeBlock,
							math: inMathBlock,
							center: inCenterBlock,
							right: inRightBlock
						};
					}

					// Set the final blocking contexts (for postprocessing)
					const finalContexts = new Set<string>();
					if (inCodeBlock) finalContexts.add('code');
					if (inMathBlock) finalContexts.add('math');
					if (inCenterBlock) finalContexts.add('center');
					if (inRightBlock) finalContexts.add('right');

					// Return both the text and the updated state
					return {
						text: text, // Don't modify text in preprocess
						state: {
							blockingContexts: finalContexts as Set<'code' | 'math' | 'center' | 'right'>,
							lineContexts
						}
					};
				},
				postprocess: ({ text, state }) => {
					let result = text;
					// Complete incomplete blocks at end of input
					// Close code/math first, then alignment (inner to outer)
					if (state.blockingContexts.has('code')) {
						result += '\n```';
					}
					if (state.blockingContexts.has('math')) {
						result += '\n$$';
					}
					if (state.blockingContexts.has('center')) {
						// Only close if there's content after the opening tag
						const lines = result.split('\n');
						const centerLineIdx = lines.findIndex((l) => l.trim() === '[center]');
						if (centerLineIdx !== -1 && centerLineIdx < lines.length - 1) {
							result += '\n[/center]';
						}
					}
					if (state.blockingContexts.has('right')) {
						// Only close if there's content after the opening tag
						const lines = result.split('\n');
						const rightLineIdx = lines.findIndex((l) => l.trim() === '[right]');
						if (rightLineIdx !== -1 && rightLineIdx < lines.length - 1) {
							result += '\n[/right]';
						}
					}
					return result;
				}
			},
			{
				name: 'boldItalic',
				pattern: /\*\*\*/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					if (line.trim() === '***') {
						return line;
					}
					const isEndingWithTripleAsterisk = line.endsWith('***');
					const tripleAsterisks = (line.match(/\*\*\*/g) || []).length;
					if (tripleAsterisks % 2 === 1) {
						const lastTripleAsteriskIndex = line.lastIndexOf('***');
						const endOfCellOrLine = findEndOfCellOrLineContaining(line, lastTripleAsteriskIndex);
						if (isEndingWithTripleAsterisk) {
							return line.substring(0, lastTripleAsteriskIndex);
						}
						return line.substring(0, endOfCellOrLine) + '***' + line.substring(endOfCellOrLine);
					}
					return line;
				}
			},
			{
				name: 'bold',
				pattern: /\*\*/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					if (line.trim() === '***') {
						return line;
					}
					const doubleAsteriskMatches = (line.match(/\*\*/g) || []).length;
					if (doubleAsteriskMatches % 2 === 1) {
						const isEndingWithDoubleAsterisk = line.endsWith('**');
						const lastDoubleAsteriskIndex = line.lastIndexOf('**');
						const endOfCellOrLine = findEndOfCellOrLineContaining(line, lastDoubleAsteriskIndex);
						if (isEndingWithDoubleAsterisk) {
							return line.substring(0, lastDoubleAsteriskIndex);
						}
						return line.substring(0, endOfCellOrLine) + '**' + line.substring(endOfCellOrLine);
					}
					return line;
				}
			},
			{
				name: 'doubleUnderscoreItalic',
				pattern: /__/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					if (line.trim() === '___') {
						return line;
					}
					const underscorePairs = (line.match(/__/g) || []).length;
					if (underscorePairs % 2 === 1) {
						const isEndingWithDoubleUnderscore = line.endsWith('__');
						const lastDoubleUnderscoreIndex = line.lastIndexOf('__');
						const endOfCellOrLine = findEndOfCellOrLineContaining(line, lastDoubleUnderscoreIndex);
						if (isEndingWithDoubleUnderscore) {
							return line.substring(0, lastDoubleUnderscoreIndex);
						}
						return line.substring(0, endOfCellOrLine) + '__' + line.substring(endOfCellOrLine);
					}
					return line;
				}
			},
			{
				name: 'strikethrough',
				pattern: /~~/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					const tildePairs = (line.match(/~~/g) || []).length;
					if (tildePairs % 2 === 1) {
						const isEndingWithDoubleTilde = line.endsWith('~~');
						const lastDoubleTildeIndex = line.lastIndexOf('~~');
						const endOfCellOrLine = findEndOfCellOrLineContaining(line, lastDoubleTildeIndex);
						// Only complete if there's content after the tildes
						const contentAfterTildes = line.substring(lastDoubleTildeIndex + 2, endOfCellOrLine);
						if (contentAfterTildes.trim().length > 0) {
							if (isEndingWithDoubleTilde) {
								return line.substring(0, lastDoubleTildeIndex);
							}
							return line.substring(0, endOfCellOrLine) + '~~' + line.substring(endOfCellOrLine);
						}
					}
					return line;
				}
			},

			{
				name: 'singleAsteriskItalic',
				pattern: /[\s\S]*/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					if (line.trim() === '***') {
						return line;
					}
					// Inline countSingleAsterisks logic
					let singleAsterisks = 0;
					for (let i = 0; i < line.length; i++) {
						if (line[i] === '*') {
							const prevChar = i > 0 ? line[i - 1] : '';
							const nextChar = i < line.length - 1 ? line[i + 1] : '';
							// Line is already a single line (split by \n earlier), so lineStart is always 0
							const beforeAsterisk = line.substring(0, i);
							if (beforeAsterisk.trim() === '' && (nextChar === ' ' || nextChar === '\t')) {
								continue;
							}
							if (prevChar !== '*' && nextChar !== '*') {
								singleAsterisks++;
							}
						}
					}

					if (singleAsterisks % 2 === 1) {
						// Inline findFirstSingleAsterisk logic
						let firstSingleAsteriskIndex = -1;
						for (let i = 0; i < line.length; i++) {
							if (line[i] === '*' && line[i - 1] !== '*' && line[i + 1] !== '*') {
								const prevChar = i > 0 ? line[i - 1] : '';
								const nextChar = i < line.length - 1 ? line[i + 1] : '';
								if (/\w/.test(prevChar) && /\w/.test(nextChar)) continue;
								if (/\w/.test(prevChar) && !/\s/.test(prevChar)) continue;
								firstSingleAsteriskIndex = i;
								break;
							}
						}

						if (firstSingleAsteriskIndex !== -1) {
							const endOfCellOrLine = findEndOfCellOrLineContaining(line, firstSingleAsteriskIndex);
							return line.substring(0, endOfCellOrLine) + '*' + line.substring(endOfCellOrLine);
						}
					}
					return line;
				}
			},
			{
				name: 'inlineCode',
				skipInBlockTypes: ['code', 'math'],
				pattern: /`/,
				handler: ({ line }) => {
					// Inline countSingleBackticks logic
					let singleBacktickCount = 0;
					for (let i = 0; i < line.length; i++) {
						if (line[i] === '`') {
							const isTripleStart = line[i + 1] === '`' && line[i + 2] === '`';
							const isTripleMiddle = i > 0 && line[i - 1] === '`' && line[i + 1] === '`';
							const isTripleEnd = i > 1 && line[i - 2] === '`' && line[i - 1] === '`';
							const isPartOfTriple = isTripleStart || isTripleMiddle || isTripleEnd;
							if (!isPartOfTriple) {
								singleBacktickCount++;
							}
						}
					}

					// Inline hasCompleteCodeBlock logic
					const tripleBackticks = (line.match(/```/g) || []).length;
					const hasCompleteBlock =
						tripleBackticks > 0 && tripleBackticks % 2 === 0 && line.includes('\n');

					if (singleBacktickCount % 2 === 1 && !hasCompleteBlock) {
						const lastBacktickIndex = line.lastIndexOf('`');
						const endOfCellOrLine = findEndOfCellOrLineContaining(line, lastBacktickIndex);
						// Only complete if there's content after the backtick and it doesn't contain table delimiters
						const contentAfterBacktick = line.substring(lastBacktickIndex + 1, endOfCellOrLine);
						if (contentAfterBacktick.trim().length > 0 && !contentAfterBacktick.includes('|')) {
							return line.substring(0, endOfCellOrLine) + '`' + line.substring(endOfCellOrLine);
						}
					}
					return line;
				}
			},
			{
				name: 'singleUnderscoreItalic',
				pattern: /[\s\S]*/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					// Pre-compute math ranges once for this line
					const mathRanges = computeMathRanges(line);
					// Inline countSingleUnderscores logic
					let singleUnderscores = 0;
					for (let i = 0; i < line.length; i++) {
						if (line[i] === '_') {
							const prevChar = i > 0 ? line[i - 1] : '';
							const nextChar = i < line.length - 1 ? line[i + 1] : '';
							if (prevChar === '\\') continue;
							if (isInMathRange(mathRanges, i)) continue;
							if (
								prevChar &&
								nextChar &&
								/[\p{L}\p{N}_]/u.test(prevChar) &&
								/[\p{L}\p{N}_]/u.test(nextChar)
							) {
								continue;
							}
							if (prevChar !== '_' && nextChar !== '_') {
								singleUnderscores++;
							}
						}
					}

					if (singleUnderscores % 2 === 1) {
						// Inline findFirstSingleUnderscore logic
						let firstSingleUnderscoreIndex = -1;
						for (let i = 0; i < line.length; i++) {
							if (
								line[i] === '_' &&
								line[i - 1] !== '_' &&
								line[i + 1] !== '_' &&
								line[i - 1] !== '\\' &&
								!isInMathRange(mathRanges, i)
							) {
								const prevChar = i > 0 ? line[i - 1] : '';
								const nextChar = i < line.length - 1 ? line[i + 1] : '';
								if (
									prevChar &&
									nextChar &&
									/[\p{L}\p{N}_]/u.test(prevChar) &&
									/[\p{L}\p{N}_]/u.test(nextChar)
								) {
									continue;
								}
								firstSingleUnderscoreIndex = i;
								break;
							}
						}

						if (firstSingleUnderscoreIndex !== -1) {
							const endOfCellOrLine = findEndOfCellOrLineContaining(
								line,
								firstSingleUnderscoreIndex
							);
							return line.substring(0, endOfCellOrLine) + '_' + line.substring(endOfCellOrLine);
						}
					}
					return line;
				}
			},
			{
				name: 'subscript',
				pattern: /~/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					// Inline countSingleTildes logic
					let singleTildes = 0;
					for (let i = 0; i < line.length; i++) {
						if (line[i] === '~') {
							const prevChar = i > 0 ? line[i - 1] : '';
							const nextChar = i < line.length - 1 ? line[i + 1] : '';
							if (prevChar === '\\') continue;
							if (prevChar !== '~' && nextChar !== '~') singleTildes++;
						}
					}

					if (singleTildes % 2 === 1) {
						const lastTildeIndex = line.lastIndexOf('~');
						const mathRanges = computeMathRanges(line);
						if (lastTildeIndex !== -1 && !isInMathRange(mathRanges, lastTildeIndex)) {
							const endOfCellOrLine = findEndOfCellOrLineContaining(line, lastTildeIndex);
							// Only complete if there's content after the tilde
							const contentAfterTilde = line.substring(lastTildeIndex + 1, endOfCellOrLine);
							if (contentAfterTilde.trim().length > 0) {
								return line.substring(0, endOfCellOrLine) + '~' + line.substring(endOfCellOrLine);
							}
						}
					}
					return line;
				}
			},
			{
				name: 'footnoteRef',
				pattern: /\[\^[^\]\s,]*/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					// Check if there's an incomplete footnote ref (no ] anywhere in the line)
					if (!line.includes(']')) {
						return line.replace(/\[\^[^\]\s,]*/, '[^streamdown:footnote]');
					}
					return line;
				}
			},
			{
				name: 'superscript',
				pattern: /\^/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					// Inline countSingleCarets logic
					let singleCarets = 0;
					for (let i = 0; i < line.length; i++) {
						if (line[i] === '^') {
							const prevChar = i > 0 ? line[i - 1] : '';
							if (prevChar === '\\') continue;
							if (!isWithinFootnoteRef(line, i)) singleCarets++;
						}
					}

					if (singleCarets % 2 === 1) {
						const lastCaretIndex = line.lastIndexOf('^');
						const mathRanges = computeMathRanges(line);
						if (
							lastCaretIndex !== -1 &&
							!isInMathRange(mathRanges, lastCaretIndex) &&
							!isWithinFootnoteRef(line, lastCaretIndex)
						) {
							const endOfCellOrLine = findEndOfCellOrLineContaining(line, lastCaretIndex);
							// Only complete if there's content after the caret
							const contentAfterCaret = line.substring(lastCaretIndex + 1, endOfCellOrLine);
							if (contentAfterCaret.trim().length > 0) {
								return line.substring(0, endOfCellOrLine) + '^' + line.substring(endOfCellOrLine);
							}
						}
					}
					return line;
				}
			},
			{
				name: 'inlineMath',
				pattern: /\$/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					// Inline countSingleDollarSigns logic
					let singleDollars = 0;
					for (let i = 0; i < line.length; i++) {
						if (line[i] === '$') {
							const prevChar = i > 0 ? line[i - 1] : '';
							const nextChar = i < line.length - 1 ? line[i + 1] : '';
							if (prevChar === '\\') continue;
							if (prevChar === '$' || nextChar === '$') continue;
							if (nextChar && /\d/.test(nextChar)) continue;
							singleDollars++;
						}
					}

					if (singleDollars % 2 === 1) {
						let lastDollarIndex = -1;
						for (let i = line.length - 1; i >= 0; i--) {
							if (line[i] === '$') {
								const prevChar = i > 0 ? line[i - 1] : '';
								const nextChar = i < line.length - 1 ? line[i + 1] : '';
								if (
									prevChar !== '\\' &&
									prevChar !== '$' &&
									nextChar !== '$' &&
									nextChar !== '' &&
									!/\d/.test(nextChar)
								) {
									lastDollarIndex = i;
									break;
								}
							}
						}
						if (lastDollarIndex !== -1) {
							const endOfCellOrLine = findEndOfCellOrLineContaining(line, lastDollarIndex);
							return line.substring(0, endOfCellOrLine) + '$' + line.substring(endOfCellOrLine);
						}
					}
					return line;
				}
			},
			{
				name: 'blockMath',
				pattern: /\$\$/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					// Don't process block boundaries (lines that are just $$)
					if (line.trim() === '$$') return line;

					const dollarPairs = (line.match(/\$\$/g) || []).length;
					if (dollarPairs % 2 === 0) return line;
					const firstDollarIndex = line.indexOf('$$');
					// Only complete if there's content after $$ on the same line (no newline immediately after)
					const hasNewlineAfterStart = line.indexOf('\n', firstDollarIndex) !== -1;
					if (!hasNewlineAfterStart) {
						// Single line case: $$content → $$content$$
						return line + '$$';
					}
					// Multi-line cases are handled by contextManager
					return line;
				}
			},
			{
				name: 'descriptionList',
				pattern: /^(\s*):/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					// Check if this is a description list item that needs completion
					const colonMatch = line.match(/^(\s*):(.+)$/);
					if (colonMatch) {
						const [, indent, content] = colonMatch;
						// Only complete if the content doesn't already contain a colon
						if (!content.includes(':')) {
							const endOfCellOrLine = findEndOfCellOrLineContaining(line, line.length - 1);
							return line.substring(0, endOfCellOrLine) + ':' + line.substring(endOfCellOrLine);
						}
					}
					return line;
				}
			},
			{
				name: 'linksAndImages',
				pattern: /(!?\[.*)$/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					// Check for incomplete links with URLs: [text](url
					const urlMatch = line.match(/(!?\[[^\]]*\]\()([^)]*?)$/);
					if (urlMatch) {
						const url = urlMatch[2];
						if (url.length > 0) {
							// Inline isUrlIncomplete logic
							let isIncomplete = true;
							if (url && url.length >= 4) {
								if (
									(url.startsWith('http://') && url.length >= 12) ||
									(url.startsWith('https://') && url.length >= 13)
								) {
									let domain = url;
									if (url.startsWith('http://')) domain = url.substring(7);
									else if (url.startsWith('https://')) domain = url.substring(8);

									domain = domain.split('/')[0].split('?')[0].split('#')[0];
									const domainParts = domain.split('.');
									if (domainParts.length >= 2) {
										const extension = domainParts[domainParts.length - 1];
										if (extension.length >= 2 && /^[a-zA-Z]+$/.test(extension)) {
											isIncomplete = false;
										}
									}
								}
							}

							if (isIncomplete) {
								const marker = urlMatch[1].startsWith('!')
									? 'streamdown:incomplete-image'
									: 'streamdown:incomplete-link';
								return line.replace(url, marker) + ')';
							} else {
								return line + ')';
							}
						} else {
							const marker = urlMatch[1].startsWith('!')
								? 'streamdown:incomplete-image'
								: 'streamdown:incomplete-link';
							return line + marker + ')';
						}
					}

					// Check for incomplete links without URLs: [text
					const linkMatch = line.match(/(!?\[)([^\]]*?)$/);
					if (linkMatch && !line.includes('](')) {
						// Count unclosed brackets to distinguish links from citations
						let unclosedBrackets = 0;
						for (let i = 0; i < line.length; i++) {
							if (line[i] === '[' && (i === 0 || line[i - 1] !== '\\')) {
								const closingIndex = line.indexOf(']', i + 1);
								if (closingIndex === -1) {
									unclosedBrackets++;
								}
							}
						}
						// Only handle as link/image if there's exactly one unclosed bracket
						// Multiple unclosed brackets indicate citations, handled by inlineCitation
						// Also skip task list checkbox patterns ([x, [X, [ )
						if (unclosedBrackets === 1) {
							const bracketContent = linkMatch[2].trim();
							// Skip task list checkboxes
							if (/^[xX ]?$/.test(bracketContent)) {
								return line;
							}
							const [, openBracket, linkTextWithPossibleBoundary] = linkMatch;
							// Find the position of the opening bracket
							const bracketIndex = line.lastIndexOf(openBracket);
							const endOfCellOrLine = findEndOfCellOrLineContaining(line, bracketIndex);

							// Extract the clean link text (remove any trailing | or whitespace)
							const linkText = linkTextWithPossibleBoundary.replace(/[\s|]+$/, '');
							const marker = openBracket.startsWith('!')
								? 'streamdown:incomplete-image'
								: 'streamdown:incomplete-link';

							// Replace from bracket to end of cell/line, including boundary if it's |
							const includeBoundary =
								endOfCellOrLine < line.length && line[endOfCellOrLine] === '|';
							const incompleteEnd = includeBoundary ? endOfCellOrLine + 1 : endOfCellOrLine;
							const incompletePart = line.substring(bracketIndex, incompleteEnd);
							const completedPart =
								openBracket + linkText + '](' + marker + ')' + (includeBoundary ? '|' : '');

							return line.replace(incompletePart, completedPart);
						}
					}
					return line;
				}
			},
			{
				name: 'inlineCitation',
				pattern: /\[/,
				skipInBlockTypes: ['code', 'math'],
				handler: ({ line }) => {
					// Skip if line has complete links/images (contains '](' pattern)
					if (line.includes('](')) {
						return line;
					}

					// Find all unclosed brackets and close each one
					const unclosedPositions: number[] = [];
					for (let i = 0; i < line.length; i++) {
						if (line[i] === '[' && (i === 0 || line[i - 1] !== '\\')) {
							const restOfLine = line.substring(i + 1);
							const closingIndex = restOfLine.indexOf(']');
							if (closingIndex === -1) {
								unclosedPositions.push(i);
							}
						}
					}

					if (unclosedPositions.length === 0) {
						return line;
					}

					// Close each unclosed bracket by finding the end of its content
					// Process from right to left to preserve indices
					let result = line;
					for (let j = unclosedPositions.length - 1; j >= 0; j--) {
						const bracketPos = unclosedPositions[j];
						const endOfCellOrLine = findEndOfCellOrLineContaining(result, bracketPos);

						if (j < unclosedPositions.length - 1) {
							// There's another unclosed bracket after this one
							// Find the first space after opening bracket content (end of citation ref)
							const nextBracketPos = unclosedPositions[j + 1];
							const textBetween = result.substring(bracketPos + 1, nextBracketPos);
							const firstSpaceIdx = textBetween.indexOf(' ');
							if (firstSpaceIdx !== -1) {
								const closingPos = bracketPos + 1 + firstSpaceIdx;
								result = result.substring(0, closingPos) + ']' + result.substring(closingPos);
							} else {
								result =
									result.substring(0, endOfCellOrLine) + ']' + result.substring(endOfCellOrLine);
							}
						} else {
							// Last unclosed bracket, close at end of cell/line
							result =
								result.substring(0, endOfCellOrLine) + ']' + result.substring(endOfCellOrLine);
						}
					}

					return result;
				}
			},
			{
				name: 'mdx',
				skipInBlockTypes: ['code', 'math', 'center', 'right'],
				preprocess: ({ text, state }) => {
					// Track MDX component states across the entire text
					const lines = state._lines || text.split('\n');
					const openTags: Array<{ tagName: string; lineIndex: number }> = [];
					let mdxLineStates: Array<{ inMdx: boolean; incompletePositions: number[] }> = [];

					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];
						let inMdx = false;
						let incompletePositions: number[] = [];

						// Find all MDX tags in the line
						let searchPos = 0;
						while (searchPos < line.length) {
							// Look for opening bracket with capital letter (MDX component)
							const tagStart = line.indexOf('<', searchPos);
							if (tagStart === -1 || tagStart >= line.length - 1) break;

							const nextChar = line[tagStart + 1];
							// Only match if starts with capital letter (MDX component)
							if (!/[A-Z]/.test(nextChar)) {
								searchPos = tagStart + 1;
								continue;
							}

							// Try to match complete self-closing tag
							const selfClosingMatch = line
								.substring(tagStart)
								.match(/^<([A-Z][a-zA-Z0-9]*)((?:\s+\w+=(?:"[^"]*"|{[^}]*}))*)\s*\/>/);
							if (selfClosingMatch) {
								searchPos = tagStart + selfClosingMatch[0].length;
								continue;
							}

							// Try to match complete opening tag with immediate closing
							const completeMatch = line
								.substring(tagStart)
								.match(/^<([A-Z][a-zA-Z0-9]*)((?:\s+\w+=(?:"[^"]*"|{[^}]*}))*)\s*>.*?<\/\1>/);
							if (completeMatch) {
								searchPos = tagStart + completeMatch[0].length;
								continue;
							}

							// Try to match opening tag
							const openTagMatch = line
								.substring(tagStart)
								.match(/^<([A-Z][a-zA-Z0-9]*)((?:\s+\w+=(?:"[^"]*"|{[^}]*}))*)\s*>/);
							if (openTagMatch) {
								const tagName = openTagMatch[1];
								openTags.push({ tagName, lineIndex: i });
								inMdx = true;
								searchPos = tagStart + openTagMatch[0].length;
								continue;
							}

							// Check for incomplete self-closing (e.g., <Component /)
							const incompleteSelfClosing = line
								.substring(tagStart)
								.match(/^<([A-Z][a-zA-Z0-9]*)[^>]*\/$/);
							if (incompleteSelfClosing) {
								incompletePositions.push(tagStart);
								break; // This is at the end of the line
							}

							// Check for incomplete tag (no closing >) - only at end of line
							const incompleteTag = line
								.substring(tagStart)
								.match(/^<([A-Z][a-zA-Z0-9]*)(?:\s+[^>]*)?$/);
							if (incompleteTag) {
								incompletePositions.push(tagStart);
								break; // This is at the end of the line
							}

							searchPos = tagStart + 1;
						}

						// Check for closing tags
						const closeTagMatches = line.matchAll(/<\/([A-Z][a-zA-Z0-9]*)>/g);
						for (const closeMatch of closeTagMatches) {
							const tagName = closeMatch[1];
							// Find and remove the matching open tag
							const openIndex = openTags.findIndex((t) => t.tagName === tagName);
							if (openIndex !== -1) {
								openTags.splice(openIndex, 1);
							}
						}

						mdxLineStates[i] = { inMdx, incompletePositions };
					}

					return {
						text,
						state: {
							mdxUnclosedTags: openTags,
							mdxLineStates
						}
					};
				},
				handler: ({ line, state }) => {
					// Remove incomplete MDX syntax (don't render it)
					const lineStates = state.mdxLineStates || [];
					const currentState = lineStates[state.currentLine];

					if (currentState?.incompletePositions && currentState.incompletePositions.length > 0) {
						// Process incomplete positions from right to left to preserve indices
						let result = line;
						for (let i = currentState.incompletePositions.length - 1; i >= 0; i--) {
							const pos = currentState.incompletePositions[i];
							const before = result.substring(0, pos);
							// Simply remove the incomplete MDX tag
							result = before;
						}
						return result;
					}

					return line;
				},
				postprocess: ({ text, state }) => {
					// Complete unclosed MDX components at the end
					const unclosedTags = state.mdxUnclosedTags || [];
					if (unclosedTags.length > 0) {
						// Close tags in reverse order (innermost first)
						let result = text;
						for (let i = unclosedTags.length - 1; i >= 0; i--) {
							result += `\n</${unclosedTags[i].tagName}>`;
						}
						return result;
					}
					return text;
				}
			}
		];
	}
}

// Legacy function for backward compatibility
const defaultPlugins = IncompleteMarkdownParser.createDefaultPlugins();
const defaultParser = new IncompleteMarkdownParser(defaultPlugins);

export const parseIncompleteMarkdown = (text: string): string => {
	if (!text || typeof text !== 'string') {
		return text;
	}
	return defaultParser.parse(text);
};

// Utility functions

const findEndOfCellOrLineContaining = (text: string, position: number): number => {
	let endPos = position;
	while (endPos < text.length && text[endPos] !== '\n' && text[endPos] !== '|') {
		endPos++;
	}
	return endPos;
};

const isWithinMathBlock = (text: string, position: number): boolean => {
	let inInlineMath = false;
	let inBlockMath = false;

	for (let i = 0; i < text.length && i < position; i++) {
		if (text[i] === '\\' && text[i + 1] === '$') {
			i++;
			continue;
		}

		if (text[i] === '$') {
			if (text[i + 1] === '$') {
				inBlockMath = !inBlockMath;
				i++;
				inInlineMath = false;
			} else if (!inBlockMath) {
				inInlineMath = !inInlineMath;
			}
		}
	}

	return inInlineMath || inBlockMath;
};

/**
 * Pre-compute math ranges for a line in a single O(n) pass.
 * Returns an array of [start, end] pairs where math blocks are active.
 * Use with `isInMathRange` for O(1) position checks instead of O(n) `isWithinMathBlock`.
 */
const computeMathRanges = (text: string): Array<[number, number]> => {
	const ranges: Array<[number, number]> = [];
	let inInlineMath = false;
	let inBlockMath = false;
	let mathStart = -1;

	for (let i = 0; i < text.length; i++) {
		if (text[i] === '\\' && text[i + 1] === '$') {
			i++;
			continue;
		}

		if (text[i] === '$') {
			if (text[i + 1] === '$') {
				if (inBlockMath) {
					ranges.push([mathStart, i + 1]);
					inBlockMath = false;
				} else {
					if (inInlineMath) {
						ranges.push([mathStart, i]);
						inInlineMath = false;
					}
					inBlockMath = true;
					mathStart = i;
				}
				i++;
				inInlineMath = false;
			} else if (!inBlockMath) {
				if (inInlineMath) {
					ranges.push([mathStart, i]);
					inInlineMath = false;
				} else {
					inInlineMath = true;
					mathStart = i;
				}
			}
		}
	}

	// If still in a math block at end, add the range to the end
	if (inInlineMath || inBlockMath) {
		ranges.push([mathStart, text.length]);
	}

	return ranges;
};

const isInMathRange = (ranges: Array<[number, number]>, position: number): boolean => {
	for (const [start, end] of ranges) {
		if (position > start && position < end) return true;
		if (start > position) break; // ranges are sorted, no need to check further
	}
	return false;
};

const isWithinFootnoteRef = (text: string, position: number): boolean => {
	let openBracketPos = -1;
	let caretPos = -1;

	for (let i = position; i >= 0; i--) {
		if (text[i] === ']') return false;
		if (text[i] === '^' && caretPos === -1) caretPos = i;
		if (text[i] === '[') {
			openBracketPos = i;
			break;
		}
	}

	if (openBracketPos !== -1 && caretPos === openBracketPos + 1 && position >= caretPos) {
		for (let i = position + 1; i < text.length; i++) {
			if (text[i] === ']') return true;
			if (text[i] === '[' || text[i] === '\n') break;
		}
	}

	return false;
};

// Export the class and interfaces
