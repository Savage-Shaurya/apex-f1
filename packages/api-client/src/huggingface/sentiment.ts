/**
 * Optional sentiment inference for bounded admin/worker batches. Provider/model
 * availability and deployment entitlement must be verified separately.
 * A missing token or inference opt-in returns null, never a fabricated label.
 */

import { hfInference, type HfCallOptions } from './client';
import { isRecord } from '../transport';

const MODEL = 'cardiffnlp/twitter-roberta-base-sentiment-latest';

/** HF returns labels lowercased; we keep them so. */
export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface SentimentResult {
  label: SentimentLabel;
  /** Confidence of the winning label, in [0, 1]. */
  score: number;
}

/**
 * Wire shape: the model returns either
 *   [[{label, score}, {label, score}, {label, score}]]   (default)
 * or
 *   [{label, score}, ...]                                 (single-item mode)
 * We accept both · HF has flip-flopped on this in the past.
 */
type RawRow = { label: string; score: number };
type RawResponse = RawRow[] | RawRow[][];

function normalizeLabel(raw: string): SentimentLabel | null {
  const v = raw.trim().toLowerCase();
  if (v === 'positive' || v === 'label_2') return 'positive';
  if (v === 'neutral'  || v === 'label_1') return 'neutral';
  if (v === 'negative' || v === 'label_0') return 'negative';
  return null;
}

function pickWinner(rows: unknown[]): SentimentResult | null {
  let best: SentimentResult | null = null;
  for (const r of rows) {
    if (!isRecord(r) || typeof r.label !== 'string') continue;
    const label = normalizeLabel(r.label);
    if (!label) continue;
    if (typeof r.score !== 'number' || !Number.isFinite(r.score) || r.score < 0 || r.score > 1) continue;
    if (!best || r.score > best.score) best = { label, score: r.score };
  }
  return best;
}

/**
 * Score the sentiment of a single piece of text · headline + dek works
 * well; inputs are bounded before the provider call. Character truncation
 * is only a local size bound, not a guarantee of a particular token count.
 *
 * Returns null on missing token, network failure, empty text, or
 * malformed model output.
 */
export async function scoreSentiment(
  text: string,
  opts: HfCallOptions & {
    /**
     * Requests provider warmup where supported. The local operation deadline
     * still applies; warmup never guarantees that a hosted model is available.
     */
    waitForModel?: boolean;
  } = {},
): Promise<SentimentResult | null> {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  // Bound prompt size locally; the provider still owns tokenization limits.
  const truncated = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;

  const raw = await hfInference<RawResponse>({
    model: MODEL,
    inputs: truncated,
    options: {
      wait_for_model: opts.waitForModel ?? true,
      use_cache: true,
    },
    fetchImpl: opts.fetchImpl,
    token: opts.token,
    allowInference: opts.allowInference,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });

  if (!raw) return null;
  if (raw instanceof Buffer) return null;
  if (!Array.isArray(raw)) return null;
  const json = raw as RawResponse;

  // Flatten the two possible shapes.
  const first = json[0];
  const rows: RawRow[] = Array.isArray(first) ? (first as RawRow[]) : (json as RawRow[]);
  if (!Array.isArray(rows) || rows.length === 0) return null;

  return pickWinner(rows);
}

/**
 * Convenience: score an array of texts in parallel, preserving order.
 * Each slot is independent · if one item fails (e.g. transient 503 past
 * retries), its slot in the output array is null. The other slots survive.
 *
 * The provider's account/model limits must be checked separately. Local
 * limits cap concurrency, batch size and total elapsed time.
 */
export async function scoreSentimentBatch(
  texts: readonly string[],
  opts: HfCallOptions = {},
): Promise<Array<SentimentResult | null>> {
  if (!Array.isArray(texts)) return [];
  const results: Array<SentimentResult | null> = texts.map(() => null);
  if (opts.allowInference !== true || texts.length > 50) return results;
  // At most two concurrent requests; one deadline applies to the entire batch.
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (opts.signal?.aborted) return results;
  opts.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 10_000);
  let next = 0;
  const worker = async () => {
    while (!controller.signal.aborted && next < texts.length) {
      const index = next++;
      results[index] = await scoreSentiment(texts[index]!, { ...opts, signal: controller.signal });
    }
  };
  try { await Promise.all([worker(), worker()]); return results; }
  finally { clearTimeout(timer); opts.signal?.removeEventListener('abort', abort); controller.abort(); }
}
