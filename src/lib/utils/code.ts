import { languageExtensionMap } from './hightlighter.svelte.js';

function normalizeCodeLanguage(language: string | undefined): string | null {
	const normalized = language?.trim().toLowerCase();
	if (!normalized) return null;

	return normalized.split(/\s+/, 1)[0] ?? null;
}

export function resolveCodeFileExtension(language: string | undefined): string {
	const normalized = normalizeCodeLanguage(language);
	if (!normalized) return 'txt';

	const candidates = [
		normalized,
		normalized.startsWith('preview-') ? normalized.slice('preview-'.length) : null
	].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		if (candidate in languageExtensionMap) {
			return languageExtensionMap[candidate as keyof typeof languageExtensionMap];
		}
	}

	return 'txt';
}
