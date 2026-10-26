import { lookup } from 'node:dns/promises';
import type { LookupAddress, LookupAllOptions } from 'node:dns';
import { request } from 'node:https';
import { isPublicAddress } from '@apex/api-client/rss';

// OpenF1's documented headshot example and the current F1 media CDN.
const HEADSHOT_HOSTS = new Set(['www.formula1.com', 'media.formula1.com']);
const DEADLINE_MS = 5_000;

export interface HeadshotProbeDependencies {
  lookupImpl?: (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>;
  requestImpl?: typeof request;
  timeoutMs?: number;
}

function admittedUrl(input: string): URL | null {
  if (typeof input !== 'string' || input.length > 2_048 || /[\u0000-\u0020\u007f\\]/.test(input)) return null;
  try {
    const url = new URL(input);
    // URL normalizes an explicit :443 away; reject explicit ports in the authority too.
    const authority = input.match(/^https:\/\/([^/?#]+)/i)?.[1] ?? '';
    if (url.protocol !== 'https:' || url.username || url.password || authority.includes(':') ||
        !HEADSHOT_HOSTS.has(url.hostname) || url.hash) return null;
    return url;
  } catch { return null; }
}

export interface ImageProbeRules {
  /** Smallest plausible body in bytes; F1's grey silhouette placeholder is ~2 KB. */
  minBytes: number;
  /** Admit image/svg+xml (team logos are tiny vector files). */
  allowSvg?: boolean;
}

/**
 * A bounded, DNS-pinned HEAD probe. Native HTTPS never follows redirects;
 * only a successful image with a known plausible size is admitted.
 * The size threshold is a placeholder heuristic, not image-content proof.
 */
export async function probeRealHeadshot(input: string, dependencies: HeadshotProbeDependencies = {}): Promise<string | null> {
  return probeRealHeadshotStrict(input, dependencies).catch(() => null);
}

/**
 * Thrown when a probe could not reach a verdict (timeout, DNS or network
 * error, 5xx/429). Cached wrappers must not store this as "no image": only a
 * definitive miss (404, wrong type, placeholder size) may be cached.
 */
export class ProbeTransientError extends Error {
  constructor(readonly why: string) { super(`image probe inconclusive: ${why}`); this.name = 'ProbeTransientError'; }
}

/** Like probeRealHeadshot, but throws ProbeTransientError instead of returning null for an inconclusive probe. */
export async function probeRealHeadshotStrict(input: string, dependencies: HeadshotProbeDependencies = {}): Promise<string | null> {
  const url = admittedUrl(input);
  if (!url) return null;
  const transformed = /\.transform\/\d+col\//.test(url.pathname);
  const probe = new URL(url);
  if (transformed) probe.pathname = probe.pathname.replace(/\.transform\/\d+col\//, '.transform/1col/');
  return probeImage(url, probe, { minBytes: transformed ? 2_500 : 6_000 }, dependencies);
}

/**
 * HEAD-validate an F1 media CDN asset (driver cut-out, team car or logo).
 * The CDN answers a missing asset with 404, so a 200 image of plausible size
 * proves the URL convention held for this driver or team.
 */
export async function probeF1MediaAsset(input: string, rules: ImageProbeRules, dependencies: HeadshotProbeDependencies = {}): Promise<string | null> {
  return probeF1MediaAssetStrict(input, rules, dependencies).catch(() => null);
}

/** Like probeF1MediaAsset, but an inconclusive probe throws ProbeTransientError. */
export async function probeF1MediaAssetStrict(input: string, rules: ImageProbeRules, dependencies: HeadshotProbeDependencies = {}): Promise<string | null> {
  const url = admittedUrl(input);
  if (!url || url.hostname !== 'media.formula1.com') return null;
  return probeImage(url, new URL(url), rules, dependencies);
}

async function probeImage(url: URL, probe: URL, rules: ImageProbeRules, dependencies: HeadshotProbeDependencies): Promise<string | null> {
  const threshold = rules.minBytes;
  const types = rules.allowSvg ? /^image\/(png|jpeg|webp|avif|svg\+xml)(?:\s*;|$)/i : /^image\/(png|jpeg|webp|avif)(?:\s*;|$)/i;
  const requested = dependencies.timeoutMs ?? DEADLINE_MS;
  const timeoutMs = Number.isFinite(requested) ? Math.max(1, Math.min(DEADLINE_MS, requested)) : DEADLINE_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ProbeTransientError('timeout')); }, timeoutMs);
  });
  try {
    return await Promise.race([expired, (async () => {
      const addresses = await (dependencies.lookupImpl ?? lookup)(probe.hostname, { all: true, verbatim: true });
      if (controller.signal.aborted || !addresses.length || addresses.some(address => !isPublicAddress(address.address))) return null;
      const selected = addresses.find(address => address.family === 4) ?? addresses[0]!;
      return new Promise<string | null>((resolve, reject) => {
        const req = (dependencies.requestImpl ?? request)(probe, {
          method: 'HEAD',
          signal: controller.signal,
          agent: false,
          headers: { Accept: rules.allowSvg ? 'image/svg+xml,image/png,image/webp' : 'image/png,image/jpeg,image/webp,image/avif', 'Accept-Encoding': 'identity' },
          // Keep the original hostname for certificate validation; connect only to the checked address.
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [selected]);
            else callback(null, selected.address, selected.family);
          },
        }, response => {
          response.on('error', reject);
          const sizeHeader = response.headers['content-length'];
          const size = typeof sizeHeader === 'string' && /^\d+$/.test(sizeHeader) ? Number(sizeHeader) : NaN;
          const type = response.headers['content-type'];
          // A server error or rate limit says nothing about whether the image exists.
          if ((response.statusCode ?? 0) >= 500 || response.statusCode === 429) {
            response.destroy();
            reject(new ProbeTransientError(`http ${response.statusCode}`));
            return;
          }
          const accepted = response.statusCode === 200 && typeof type === 'string' &&
            types.test(type) &&
            ((Number.isSafeInteger(size) && size > threshold && size <= 20_000_000) ||
              // The CDN streams SVG without a length; the 200 + vector type is the proof.
              (rules.allowSvg === true && Number.isNaN(size) && /svg/i.test(type)));
          resolve(accepted ? url.href : null);
          response.destroy();
        });
        req.on('error', reject);
        req.end();
      });
    })()]);
  } catch (error) {
    throw error instanceof ProbeTransientError ? error : new ProbeTransientError('network');
  }
  finally { clearTimeout(timer); controller.abort(); }
}
