// Cloudflare Workers fetch only accepts redirect "follow" or "manual"; "error" throws a TypeError
// before any request is made. The app uses redirect: 'error' on every provider, Redis and health
// call (a redirect is never followed to a host we did not choose). This keeps that meaning on
// Workers: the call is made with "manual" and a 3xx answer fails the same way undici does.
// Imported by cf-worker.ts BEFORE the OpenNext worker, so Next's patched fetch wraps this one.
const nativeFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (init?.redirect !== 'error') return nativeFetch(input, init);
  const response = await nativeFetch(input, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
  }
  return response;
}) as typeof fetch;

export {};
