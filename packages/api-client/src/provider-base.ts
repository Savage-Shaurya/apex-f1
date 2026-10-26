/**
 * Provider base URLs with a development-only override.
 *
 * `JOLPICA_BASE_URL` / `OPENF1_BASE_URL` exist so local servers can share the
 * real-response cache in scripts/dev/provider-cache.mjs. An override is
 * accepted only when all of these hold:
 *   - the process is not a Vercel deployment (`VERCEL` and `VERCEL_ENV` unset);
 *   - NODE_ENV is not "production", unless APEX_ALLOW_LOCAL_PROVIDER_CACHE=1
 *     is set for a local `next build` / `next start` run;
 *   - the URL is http(s) on a loopback host (127.0.0.1, localhost, ::1) with
 *     no credentials, query or fragment.
 * Anything else is ignored (with one warning per variable) and the real
 * provider is used, so a stray variable can never send traffic or a bearer
 * token to an arbitrary host.
 */
export interface ProviderBase {
  base: string;
  /** True when a loopback development override is in use. */
  overridden: boolean;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const warned = new Set<string>();

export function resolveProviderBase(
  variable: string,
  defaultBase: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  warn: (message: string) => void = (message) => console.warn(message),
): ProviderBase {
  const fallback = { base: defaultBase.replace(/\/$/, ''), overridden: false };
  const raw = env[variable]?.trim();
  if (!raw) return fallback;
  const reject = (why: string) => {
    if (!warned.has(variable)) {
      warned.add(variable);
      warn(`[apex] ${variable} ignored (${why}); using the real provider.`);
    }
    return fallback;
  };
  if (env.VERCEL || env.VERCEL_ENV) return reject('not allowed on a deployment');
  if (env.NODE_ENV === 'production' && env.APEX_ALLOW_LOCAL_PROVIDER_CACHE !== '1') return reject('not allowed in production');
  let url: URL;
  try { url = new URL(raw); } catch { return reject('not a URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject('unsupported scheme');
  if (!LOOPBACK.has(url.hostname)) return reject('only loopback hosts are allowed');
  if (url.username || url.password || url.search || url.hash) return reject('credentials, query or fragment present');
  return { base: `${url.origin}${url.pathname}`.replace(/\/$/, ''), overridden: true };
}

/** Test hook: forget which variables already warned. */
export function resetProviderBaseWarnings(): void { warned.clear(); }
