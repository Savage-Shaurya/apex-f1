import { isRecord, ProviderError, readLimitedText, withProviderDeadline } from '../transport';

/**
 * Optional, cost-bearing HF Inference calls. Token presence alone never
 * enables generation: callers explicitly opt in and deployment enables it.
 * Provider/model availability, access conditions and licensing remain separate.
 */
const ENDPOINT_BASE = 'https://router.huggingface.co/hf-inference/models';
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRIES_503 = 2;
const MAX_BINARY_BYTES = 8_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface HfInferenceInput<TInputs = unknown, TParams = unknown> {
  model: string;
  inputs: TInputs;
  parameters?: TParams;
  options?: { wait_for_model?: boolean; use_cache?: boolean };
  /** Total deadline including all attempts, backoff and complete response body. */
  timeoutMs?: number;
  responseKind?: 'json' | 'binary';
  fetchImpl?: typeof fetch;
  token?: string;
  /** Also requires HUGGINGFACE_INFERENCE_ENABLED=true. */
  allowInference?: boolean;
  signal?: AbortSignal;
}
export type HfInferenceResult<T> = T | Buffer;
export type HfCallOptions = Pick<HfInferenceInput, 'fetchImpl' | 'token' | 'allowInference' | 'timeoutMs' | 'signal'>;

function buildUrl(model: string): string {
  return `${ENDPOINT_BASE}/${model}`;
}

function parseEstimatedWaitMs(payload: unknown): number | null {
  if (!isRecord(payload) || typeof payload.estimated_time !== 'number' ||
    !Number.isFinite(payload.estimated_time) || payload.estimated_time <= 0) return null;
  return Math.min(Math.max(Math.round(payload.estimated_time * 1000), 50), 1000);
}

function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 1000);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new ProviderError('huggingface', 'timeout')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new ProviderError('huggingface', 'timeout')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function readPng(response: Response): Promise<Buffer | null> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BINARY_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BINARY_BYTES) return null;
      chunks.push(value);
    }
    const result = Buffer.concat(chunks, length);
    if (result.length < 57 || !result.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    let offset = 8;
    let imageData = false;
    while (offset + 12 <= result.length) {
      const size = result.readUInt32BE(offset);
      const type = result.subarray(offset + 4, offset + 8).toString('ascii');
      if (size > MAX_BINARY_BYTES || offset + size + 12 > result.length) return null;
      if (offset === 8 && (type !== 'IHDR' || size !== 13)) return null;
      if (type === 'IDAT') imageData = true;
      if (type === 'IEND') return imageData && size === 0 && offset + 12 === result.length ? result : null;
      offset += size + 12;
    }
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function hfInference<T = unknown>(input: HfInferenceInput): Promise<HfInferenceResult<T> | null> {
  if (!input || input.allowInference !== true || process.env['HUGGINGFACE_INFERENCE_ENABLED'] !== 'true') return null;
  const token = (input.token ?? process.env['HUGGINGFACE_TOKEN'])?.trim();
  if (!token || input.inputs == null || typeof input.model !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input.model)) return null;
  // Research-only, CC-BY-NC, and not currently hosted by an Inference Provider.
  // An enabled token must not silently turn this model into a production service.
  if (input.model === 'facebook/nllb-200-distilled-600M') return null;
  const responseKind = input.responseKind ?? 'json';
  if (responseKind !== 'json' && responseKind !== 'binary') return null;
  let body: string;
  try {
    body = JSON.stringify({ inputs: input.inputs,
      ...(input.parameters !== undefined ? { parameters: input.parameters } : {}),
      ...(input.options !== undefined ? { options: input.options } : {}) });
    if (Buffer.byteLength(body, 'utf8') > 64_000) return null;
  } catch { return null; }
  const timeoutMs = Number.isFinite(input.timeoutMs) && input.timeoutMs! > 0
    ? Math.min(input.timeoutMs!, 30_000) : responseKind === 'binary' ? 30_000 : DEFAULT_TIMEOUT_MS;
  try {
    return await withProviderDeadline('huggingface', async (signal) => {
      for (let attempt = 0; attempt <= MAX_RETRIES_503; attempt++) {
        if (signal.aborted) return null;
        const response = await (input.fetchImpl ?? fetch)(buildUrl(input.model), {
          method: 'POST', cache: 'no-store', signal,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
            Accept: responseKind === 'binary' ? 'image/png' : 'application/json' },
          body,
        });
        if (response.status === 503 || response.status === 429) {
          let hint: number | null = null;
          try { hint = parseEstimatedWaitMs(JSON.parse(await readLimitedText(response, 32_000))); } catch { /* no hint */ }
          if (attempt === MAX_RETRIES_503) return null;
          await wait(hint ?? backoffMs(attempt), signal);
          continue;
        }
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); return null; }
        if (responseKind === 'binary') return readPng(response);
        const raw: unknown = JSON.parse(await readLimitedText(response, 512_000));
        if (raw === null || (isRecord(raw) && typeof raw.error === 'string')) return null;
        return raw as T;
      }
      return null;
    }, { timeoutMs, signal: input.signal });
  } catch {
    return null;
  }
}

export const __INTERNAL__ = {
  ENDPOINT_BASE, DEFAULT_TIMEOUT_MS, MAX_RETRIES_503, buildUrl, parseEstimatedWaitMs, backoffMs,
};
