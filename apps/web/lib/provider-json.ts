/** Finite provider acknowledgement reads. Errors never include URLs, tokens or provider bodies. */
export async function fetchProviderJson(url: string, init: RequestInit, options: { timeoutMs: number; maxBytes?: number; fetcher?: typeof fetch; readBodyOnSuccess?: boolean }): Promise<{ status: number; ok: boolean; value: unknown }> {
  const maximum = options.maxBytes ?? 8_192;
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30_000 || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_048_576) throw new TypeError('Invalid provider acknowledgement limit');
  const controller = new AbortController();
  if (init.signal?.aborted) throw new Error('Provider acknowledgement cancelled');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { if (reader) void reader.cancel().catch(() => {}); };
  let rejectCancellation: ((error: Error) => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const onAbort = () => { controller.abort(); cancel(); rejectCancellation?.(new Error('Provider acknowledgement cancelled')); };
  init.signal?.addEventListener('abort', onAbort, { once: true });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); cancel(); reject(new Error('Provider acknowledgement timed out')); }, options.timeoutMs);
  });
  const operation = (async () => {
    const response = await (options.fetcher ?? fetch)(url, { ...init, redirect: 'error', cache: 'no-store', signal: controller.signal });
    if (controller.signal.aborted) throw new Error('Provider acknowledgement unavailable');
    if (!response.ok) { void response.body?.cancel().catch(() => {}); return { status: response.status, ok: false, value: null }; }
    if (options.readBodyOnSuccess === false) { void response.body?.cancel().catch(() => {}); return { status: response.status, ok: true, value: null }; }
    if (!response.body || controller.signal.aborted) throw new Error('Provider acknowledgement unavailable');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) throw new Error('Invalid provider acknowledgement');
      chunks.push(value);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return { status: response.status, ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown };
  })();
  try { return await Promise.race([operation, deadline, cancellation]); }
  finally {
    clearTimeout(timer); init.signal?.removeEventListener('abort', onAbort); controller.abort(); cancel();
    // releaseLock can reject the still-pending read; the raced operation has
    // a rejection handler and cannot delay the deadline or leak a rejection.
    reader?.releaseLock();
  }
}
