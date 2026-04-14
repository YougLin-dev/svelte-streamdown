export type SubSupKind = 'subscript' | 'superscript';
export type SubSupInterpretationMode = 'explicit' | 'autocomplete';

export interface SubSupIntentContext {
	kind: SubSupKind;
	mode: SubSupInterpretationMode;
	previousCharacter?: string;
	content: string;
}

type TokenLike = {
	raw?: string;
	text?: string;
	tokens?: TokenLike[];
};

const DIGIT_PATTERN = /\d/u;
const WHITESPACE_PATTERN = /\s/u;
const AUTOCOMPLETE_ANCHOR_PATTERN = /[\p{L}\)\]}]/u;

function getVisibleTrailingCharacterFromToken(token: TokenLike | undefined): string {
	if (!token) {
		return '';
	}

	if (Array.isArray(token.tokens) && token.tokens.length > 0) {
		const lastChild = token.tokens[token.tokens.length - 1];
		const nestedCharacter = getVisibleTrailingCharacterFromToken(lastChild);
		if (nestedCharacter) {
			return nestedCharacter;
		}
	}

	if (typeof token.text === 'string' && token.text.length > 0) {
		return token.text.at(-1) ?? '';
	}

	if (typeof token.raw === 'string' && token.raw.length > 0) {
		return token.raw.at(-1) ?? '';
	}

	return '';
}

export function getVisibleTrailingCharacterFromTokens(
	tokens: readonly TokenLike[] | undefined
): string {
	if (!tokens || tokens.length === 0) {
		return '';
	}

	return getVisibleTrailingCharacterFromToken(tokens[tokens.length - 1]);
}

export function canInterpretSubSup({
	kind,
	mode,
	previousCharacter = '',
	content
}: SubSupIntentContext): boolean {
	if (content.trim().length === 0) {
		return false;
	}

	if (mode === 'explicit') {
		if (kind === 'subscript' && previousCharacter && DIGIT_PATTERN.test(previousCharacter)) {
			return false;
		}

		return true;
	}

	if (WHITESPACE_PATTERN.test(content)) {
		return false;
	}

	if (!AUTOCOMPLETE_ANCHOR_PATTERN.test(previousCharacter)) {
		return false;
	}

	return true;
}
