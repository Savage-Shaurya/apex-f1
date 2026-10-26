/**
 * Optional BART summarization helper. No automatic Groq backup is implied.
 * Cost-bearing calls require explicit caller and deployment opt-in; availability
 * of this model on the provider remains subject to the actual account/service.
 */

import { hfInference, type HfCallOptions } from './client';
import { isRecord } from '../transport';

const MODEL = 'facebook/bart-large-cnn';

/** BART's `max_length` is in TOKENS, not characters. ~1 token ≈ 4 chars. */
const DEFAULT_MAX_TOKENS = 130;
const DEFAULT_MIN_TOKENS = 40;

/** Local character ceiling; token counts depend on the text and tokenizer. */
const INPUT_CHAR_CEILING = 3800;

interface RawSummary {
  summary_text: string;
}

/**
 * Summarize a chunk of news prose into a short abstract.
 *
 * @param text       The article body. Headline + dek + first 1-2 paragraphs
 *                   is the sweet spot · BART degrades past ~1000 tokens.
 * @param maxLength  Soft target length, in CHARACTERS, of the output.
 *                   We translate to BART's token budget internally.
 *                   Pass undefined for default ~130-token (~500-char) length.
 *
 * Returns null on missing token, empty input, or malformed response.
 */
export async function summarize(
  text: string,
  maxLength?: number,
  opts: HfCallOptions & {
    /** Minimum length floor, in characters. Default ~160. */
    minLength?: number;
  } = {},
): Promise<string | null> {
  if (typeof text !== 'string' || (maxLength !== undefined && (!Number.isFinite(maxLength) || maxLength < 1 || maxLength > 2048)) ||
    (opts.minLength !== undefined && (!Number.isFinite(opts.minLength) || opts.minLength < 1 || opts.minLength > 2048))) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const input =
    trimmed.length > INPUT_CHAR_CEILING ? trimmed.slice(0, INPUT_CHAR_CEILING) : trimmed;

  // Translate user-facing CHAR targets to BART's TOKEN budget.
  const charsToTokens = (c: number): number => Math.max(20, Math.round(c / 4));
  const maxTokens = maxLength !== undefined ? charsToTokens(maxLength) : DEFAULT_MAX_TOKENS;
  const minTokens =
    opts.minLength !== undefined
      ? Math.min(charsToTokens(opts.minLength), maxTokens - 5)
      : Math.min(DEFAULT_MIN_TOKENS, maxTokens - 5);

  const raw = await hfInference<RawSummary[] | RawSummary>({
    model: MODEL,
    inputs: input,
    parameters: {
      max_length: maxTokens,
      min_length: minTokens,
      do_sample: false,
      // truncation:'longest_first' protects us from over-long inputs at
      // the HF side too · defense in depth alongside our char ceiling.
      truncation: 'longest_first',
    },
    options: { wait_for_model: true, use_cache: true },
    fetchImpl: opts.fetchImpl,
    token: opts.token,
    allowInference: opts.allowInference,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });

  if (!raw) return null;
  if (raw instanceof Buffer) return null;
  const json = raw as RawSummary[] | RawSummary;

  const row = Array.isArray(json) ? json[0] : json;
  if (!isRecord(row) || typeof row.summary_text !== 'string' || row.summary_text.length > 16_000) return null;
  const out = row.summary_text.trim();
  return out.length > 0 ? out : null;
}
