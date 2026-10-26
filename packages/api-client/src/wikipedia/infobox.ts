/**
 * Formula One career figures that Jolpica cannot supply, read from the
 * "Infobox F1 driver" template on the driver's English Wikipedia article.
 *
 * Jolpica (the Ergast successor) records fastest laps only from 2004, so a
 * career that started earlier cannot be totalled from race results. The
 * infobox carries the published career figure (for example Ayrton Senna,
 * `fastest_laps = 19`). Only the F1 module is read: multi-series drivers
 * (Mario Andretti) also carry IndyCar/NASCAR modules with their own figures.
 */
import { requestJson, isRecord, type ProviderRequestOptions } from '../transport';
import { titleFromWikiUrl } from './index';
import { APEX_USER_AGENT } from '../user-agent';

const API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = APEX_USER_AGENT;

export interface F1InfoboxCareer {
  /** Career fastest laps published in the F1 infobox, or null when the field is absent or unparseable. */
  fastestLaps: number | null;
  /** Canonical article URL the figure was read from. */
  sourceUrl: string;
}

/** Return the text of the first `{{Infobox F1 driver ...}}` template, braces balanced. */
export function extractF1DriverInfobox(wikitext: string): string | null {
  const start = wikitext.search(/\{\{\s*Infobox[ _]F1[ _]driver\b/i);
  if (start < 0) return null;
  let depth = 0;
  for (let index = start; index < wikitext.length - 1; index++) {
    const pair = wikitext.slice(index, index + 2);
    if (pair === '{{') { depth++; index++; }
    else if (pair === '}}') {
      depth--; index++;
      if (depth === 0) return wikitext.slice(start, index + 1);
    }
  }
  return null;
}

/** The F1 module's `fastest_laps` value with citations and comments removed, or null when absent. */
function fastestLapsField(wikitext: string): string | null {
  const infobox = extractF1DriverInfobox(wikitext);
  if (!infobox) return null;
  const match = infobox.match(/\|\s*fastest[ _]laps\s*=([^\n]*)/i);
  if (!match) return null;
  // Citations and comments may carry their own pipes and braces; drop them before reading the number.
  return match[1]!.replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>|<!--[\s\S]*?-->/gi, '');
}

/** Read a non-negative integer field (`fastest_laps` / `fastest laps`) from the F1 module only. */
export function parseF1InfoboxFastestLaps(wikitext: string): number | null {
  const value = fastestLapsField(wikitext);
  const number = value?.match(/^\s*(\d{1,4})\s*(?:\}\}.*|\|.*)?$/);
  return number ? Number(number[1]) : null;
}

/**
 * Active and recent drivers carry a live statistic, `{{F1stat|ALO|fastestlaps}}`,
 * instead of a number. Only that exact template is ever sent for expansion.
 */
function f1StatTemplate(wikitext: string): string | null {
  const match = fastestLapsField(wikitext)?.match(/^\s*(\{\{\s*F1stat\s*\|\s*[A-Za-z]{3}\s*\|\s*fastestlaps\s*\}\})\s*$/i);
  return match ? match[1]!.replace(/\s+/g, '') : null;
}

/** Fetch section 0 wikitext for a driver article. Returns null on any failure (callers show "not recorded"). */
export async function getF1InfoboxCareer(
  wikiUrl: string,
  opts: ProviderRequestOptions & { revalidate?: number } = {},
): Promise<F1InfoboxCareer | null> {
  const title = titleFromWikiUrl(wikiUrl);
  if (!title || /^https?:/i.test(title)) return null;
  const url = new URL(API);
  for (const [key, value] of Object.entries({ action: 'parse', page: title, prop: 'wikitext', section: '0', format: 'json', formatversion: '2', redirects: '1' })) url.searchParams.set(key, value);
  try {
    const raw = await requestJson<unknown>('wikipedia', url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      next: { revalidate: opts.revalidate ?? 604_800 },
    } as RequestInit, { timeoutMs: 8_000, maxBytes: 1_500_000, ...opts });
    if (!isRecord(raw) || !isRecord(raw.parse) || typeof raw.parse.wikitext !== 'string' || typeof raw.parse.title !== 'string') return null;
    let fastestLaps = parseF1InfoboxFastestLaps(raw.parse.wikitext);
    const template = fastestLaps === null ? f1StatTemplate(raw.parse.wikitext) : null;
    if (template) fastestLaps = await expandF1Stat(template, opts);
    return {
      fastestLaps,
      sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(raw.parse.title.replace(/ /g, '_'))}`,
    };
  } catch {
    return null;
  }
}

async function expandF1Stat(template: string, opts: ProviderRequestOptions & { revalidate?: number }): Promise<number | null> {
  const url = new URL(API);
  for (const [key, value] of Object.entries({ action: 'expandtemplates', text: template, prop: 'wikitext', format: 'json', formatversion: '2' })) url.searchParams.set(key, value);
  try {
    const raw = await requestJson<unknown>('wikipedia', url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      next: { revalidate: opts.revalidate ?? 604_800 },
    } as RequestInit, { timeoutMs: 8_000, maxBytes: 100_000, ...opts });
    const text = isRecord(raw) && isRecord(raw.expandtemplates) ? raw.expandtemplates.wikitext : null;
    return typeof text === 'string' && /^\s*\d{1,4}\s*$/.test(text) ? Number(text) : null;
  } catch {
    return null;
  }
}
