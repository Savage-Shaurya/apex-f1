import { isRecord, ProviderError, readLimitedText, withProviderDeadline } from '../transport';

const BASE = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL_QUALITY = 'llama-3.3-70b-versatile';
export const GROQ_MODEL_FAST = 'llama-3.1-8b-instant';

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqChatOpts {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Retained for compatibility; cache validated outputs in the caller. */
  revalidate?: number;
  fetchImpl?: typeof fetch;
  /** Cost-bearing calls require both this opt-in and GROQ_INFERENCE_ENABLED=true. */
  allowInference?: boolean;
  /** Total connection, retry and response-body deadline. Default 8s; max 15s. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new ProviderError('groq', 'timeout')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new ProviderError('groq', 'timeout')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Optional generation only; disabled public renders still receive real source data. */
export async function groqChat(messages: GroqMessage[], opts: GroqChatOpts = {}): Promise<string | null> {
  if (opts.allowInference !== true || process.env['GROQ_INFERENCE_ENABLED'] !== 'true') return null;
  const apiKey = process.env['GROQ_API_KEY']?.trim();
  if (!apiKey || !Array.isArray(messages) || messages.length < 1 || messages.length > 32) return null;
  if (!messages.every((message) => isRecord(message) && ['system', 'user', 'assistant'].includes(message.role as string) &&
    typeof message.content === 'string' && message.content.trim().length > 0 && message.content.length <= 16_000)) return null;
  if (messages.reduce((total, message) => total + message.content.length, 0) > 32_000) return null;
  const model = opts.model ?? GROQ_MODEL_QUALITY;
  if (![GROQ_MODEL_QUALITY, GROQ_MODEL_FAST].includes(model)) return null;
  const temperature = opts.temperature ?? 0.6;
  const maxTokens = opts.maxTokens ?? 320;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2 ||
    !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048) return null;
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs! > 0 ? Math.min(opts.timeoutMs!, 15_000) : 8_000;
  const body = JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false });

  try {
    return await withProviderDeadline('groq', async (signal) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal.aborted) return null;
        const response = await (opts.fetchImpl ?? fetch)(BASE, {
          method: 'POST', cache: 'no-store', signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body,
        });
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel().catch(() => undefined);
          if (attempt === 2) return null;
          const retryAfter = Number(response.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 2000) : 250 * 2 ** attempt;
          await wait(delay, signal);
          continue;
        }
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); return null; }
        let raw: unknown;
        try { raw = JSON.parse(await readLimitedText(response, 128_000)); }
        catch { return null; }
        if (!isRecord(raw) || !Array.isArray(raw.choices)) return null;
        const choice = raw.choices[0];
        if (!isRecord(choice) || choice.finish_reason === 'length' || !isRecord(choice.message) ||
          typeof choice.message.content !== 'string') return null;
        const text = choice.message.content.trim();
        return text.length > 0 && text.length <= 16_000 ? text : null;
      }
      return null;
    }, { timeoutMs, signal: opts.signal });
  } catch {
    return null;
  }
}
