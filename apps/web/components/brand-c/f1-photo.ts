import { decodeEntities } from '@/lib/format';
// Same identifying agent as every other provider request (site from NEXT_PUBLIC_SITE_URL).
import { APEX_USER_AGENT } from '@apex/api-client/user-agent';

/**
 * The official trackside header photograph of a Grand Prix, read from the
 * race's own page on formula1.com (its og:image, served by the official F1
 * media CDN; approved for use with credit). The page is found among the
 * season's real race slugs and is only accepted when its title names this
 * Grand Prix, so a wrong page can never put another circuit's picture on the
 * home page. Anything uncertain returns null and the hero simply has no photo.
 */
export interface F1Photo { url: string; href: string; credit: string }

const DAY = 86_400;
const BASE = 'https://www.formula1.com/en/racing';
const ALIAS: Record<string, string> = { usa: 'united-states', 'united states': 'united-states', uk: 'great-britain', 'united kingdom': 'great-britain', uae: 'united-arab-emirates' };

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function page(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': APEX_USER_AGENT, accept: 'text/html' }, next: { revalidate: DAY }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const meta = (html: string, prop: string) => {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'));
  return m ? decodeEntities(m[1]) : null;
};

export async function getF1RacePhoto(race: { season: number; name: string; city?: string | null; country?: string | null }): Promise<F1Photo | null> {
  const index = await page(`${BASE}/${race.season}`);
  if (!index) return null;
  const slugs = new Set([...index.matchAll(new RegExp(`/en/racing/${race.season}/([a-z0-9-]+)`, 'g'))].map((m) => m[1]!));
  const name = decodeEntities(race.name).trim();
  const country = (race.country ?? '').trim().toLowerCase();
  const candidates = [slugify(name.replace(/\s+Grand Prix$/i, '')), race.city ? slugify(race.city) : '', ALIAS[country] ?? slugify(country)]
    .filter((s, i, all) => s && slugs.has(s) && all.indexOf(s) === i);
  for (const slug of candidates) {
    const href = `${BASE}/${race.season}/${slug}`;
    const html = await page(href);
    if (!html) continue;
    const title = meta(html, 'og:title') ?? '';
    if (!title.toLowerCase().startsWith(`${name.toLowerCase()} ${race.season}`)) continue;
    const image = meta(html, 'og:image');
    if (!image || !image.startsWith('https://media.formula1.com/image/upload/') || !/c_lfill,w_\d+/.test(image)) continue;
    return { url: image, href, credit: 'Formula 1' };
  }
  return null;
}

/** The same official photograph at another CDN width. */
export const f1PhotoAt = (url: string, width: number) => url.replace(/c_lfill,w_\d+/, `c_lfill,w_${width}`);

/**
 * A portrait (2:3) crop of the same photograph for phones, cut by the CDN
 * around the subject (`g_auto`), so a narrow screen shows the car and the
 * scene instead of a smeared sliver of a wide frame. Widths above the
 * source's own height x ratio would only be upscaled (the 1080px-tall source
 * gives 720 at 2:3 and 1296 at 6:5), so callers stop there.
 */
export const f1PhotoPortraitAt = (url: string, width: number, ratio: '2:3' | '3:4' | '1:1' | '6:5' | '4:3' = '2:3') => url.replace(/c_lfill,w_\d+/, `c_fill,ar_${ratio},g_auto,w_${width}`);
