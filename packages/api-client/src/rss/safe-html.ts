import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { ProviderError, withProviderDeadline } from '../transport';
import { APEX_USER_AGENT } from '../user-agent';

const ARTICLE_HOSTS = new Set(['motorsport.com', 'autosport.com', 'racefans.net', 'the-race.com', 'theguardian.com', 'formula1.com', 'bbc.com', 'bbc.co.uk', 'skysports.com', 'espn.com']);
export function isAllowedArticleUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && ARTICLE_HOSTS.has(url.hostname.replace(/^www\./, ''));
  } catch { return false; }
}
/** Conservative public-unicast gate, including IPv4-mapped IPv6 rejection. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6 && !address.includes('%')) {
    const text = address.toLowerCase();
    const first = parseInt(text.split(':')[0] ?? '', 16);
    const second = parseInt(text.split(':')[1] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && !(first === 0x2001 && [0, 2, 0x10, 0x20, 0xdb8].includes(second));
  }
  return false;
}

/** Approved HTTPS publishers only; resolve once and pin the verified address. Redirects are rejected. */
export async function fetchArticleHtml(input: string, timeoutMs = 3_000, dependencies: { lookupImpl?: typeof lookup; requestImpl?: typeof request } = {}): Promise<string> {
  if (!isAllowedArticleUrl(input)) throw new ProviderError('rss-og', 'invalid-input');
  const url = new URL(input);
  return withProviderDeadline('rss-og', async signal => {
    const addresses = await (dependencies.lookupImpl ?? lookup)(url.hostname, { all: true, verbatim: true });
    if (signal.aborted) throw new ProviderError('rss-og', 'timeout');
    if (!addresses.length || addresses.some(address => !isPublicAddress(address.address))) throw new ProviderError('rss-og', 'invalid-input');
    const selected = addresses.find(address => address.family === 4) ?? addresses[0]!;
    return new Promise<string>((resolve, reject) => {
      const req = (dependencies.requestImpl ?? request)(url, {
        signal,
        headers: { Accept: 'text/html', 'User-Agent': APEX_USER_AGENT, 'Accept-Encoding': 'identity' },
        // Native HTTPS uses the original hostname for TLS verification, but connects only to this checked address.
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        },
      }, response => {
        const length = Number(response.headers['content-length']);
        if (response.statusCode !== 200 || !/^text\/html\b/i.test(String(response.headers['content-type'] ?? '')) || (Number.isFinite(length) && length > 1_000_000)) {
          response.destroy();
          reject(new ProviderError('rss-og', 'invalid-response'));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1_000_000) { response.destroy(); reject(new ProviderError('rss-og', 'invalid-response')); }
          else chunks.push(chunk);
        });
        response.on('error', () => reject(new ProviderError('rss-og', 'network')));
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', () => reject(new ProviderError('rss-og', 'network')));
      req.end();
    });
  }, { timeoutMs });
}
