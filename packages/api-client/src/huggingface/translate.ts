import type { HfCallOptions } from './client';

/**
 * Translation remains unavailable until a commercially permitted, hosted model
 * and its request contract have been selected and verified. The former
 * facebook/nllb-200-distilled-600M model is CC-BY-NC and research-only.
 * A same-language operation is just the source text and costs no inference.
 */
export type SupportedLang =
  | 'en' | 'it' | 'de' | 'es' | 'fr' | 'nl' | 'pt' | 'ja' | 'ar' | 'zh';

const LANGUAGES: readonly string[] = ['en', 'it', 'de', 'es', 'fr', 'nl', 'pt', 'ja', 'ar', 'zh'];

export interface TranslateInput extends HfCallOptions {
  text: string;
  sourceLang: SupportedLang;
  targetLang: SupportedLang;
}

export async function translate(input: TranslateInput): Promise<string | null> {
  if (!input || typeof input.text !== 'string' || !LANGUAGES.includes(input.sourceLang) ||
    !LANGUAGES.includes(input.targetLang)) return null;
  const text = input.text.trim();
  if (!text) return null;
  return input.sourceLang === input.targetLang ? text : null;
}

export async function translateBatchToEnglish(
  items: ReadonlyArray<{ text: string; sourceLang: SupportedLang }>,
  opts: HfCallOptions = {},
): Promise<Array<string | null>> {
  if (!Array.isArray(items)) return [];
  return Promise.all(items.map((item) => translate({
    ...opts, text: item?.text, sourceLang: item?.sourceLang, targetLang: 'en',
  })));
}
