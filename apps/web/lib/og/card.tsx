import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { siteOrigin } from '@/components/shell/site-metadata';

/**
 * Share images (Open Graph / Twitter), drawn in the Carbon & Light brand:
 * night ground, brushed carbon, a cool floodlight from above, the red rule
 * and kicker, wide display type, figures in timing mono. Every word on a card
 * is real data or the page's own title (final audit F-04); a card never
 * invents a figure, and a read that fails leaves its figures off.
 *
 * Fonts are static OFL instances of the brand faces (lib/og/fonts, built by
 * make-og-fonts.py from app/fonts), because Satori reads WOFF but not WOFF2.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';
/** Data cards are re-drawn at most hourly; share crawlers cache them on their side as well. */
export const OG_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';

export interface OgStat {
  label: string;
  value: string;
}

export interface OgCardData {
  /** Short section label over the title, e.g. "Driver · Ferrari · No. 44". */
  kicker: string;
  /** The page's subject: a name, a race, a table. */
  title: string;
  /** One supporting line (place, nationality, date). */
  subtitle?: string | null;
  /** Up to four real figures. */
  stats?: OgStat[];
  /** A team colour lights the right-hand field; red otherwise. */
  accent?: string | null;
  /** 'display' = wide capitals (names, short titles); 'headline' = a news headline in text type. */
  tone?: 'display' | 'headline';
}

const NIGHT = '#050506';
const WHITE = '#f4f5f7';
const SILVER = '#c9ccd3';
const TITANIUM = '#9b9ea7';
const RED = '#e10600';
const RED_TEXT = '#ff4f47';

const FONT_FILES = [
  { file: 'anybody-display.woff', name: 'Anybody', weight: 800 as const },
  { file: 'hanken-grotesk-500.woff', name: 'Hanken Grotesk', weight: 500 as const },
  { file: 'hanken-grotesk-700.woff', name: 'Hanken Grotesk', weight: 700 as const },
  { file: 'jetbrains-mono-500.woff', name: 'JetBrains Mono', weight: 500 as const },
];

/**
 * One font file, from the app root (Vercel, next start) or the repository root
 * (tests). Both paths stay scoped to lib/og/fonts so the server trace includes
 * only that folder.
 */
async function readFont(file: string): Promise<Buffer> {
  try {
    return await readFile(path.join(process.cwd(), 'lib', 'og', 'fonts', file));
  } catch {
    return readFile(path.join(process.cwd(), 'apps', 'web', 'lib', 'og', 'fonts', file));
  }
}

let fontsPromise: Promise<Array<{ name: string; data: Buffer; weight: 500 | 700 | 800; style: 'normal' }>> | null = null;
function loadFonts() {
  fontsPromise ??= Promise.all(FONT_FILES.map(async (f) => ({ name: f.name, data: await readFont(f.file), weight: f.weight, style: 'normal' as const })))
    .catch((error) => { fontsPromise = null; throw error; });
  return fontsPromise;
}

const HEX = /^#?([0-9a-f]{6})$/i;
function accentOf(color: string | null | undefined): string {
  const m = color?.trim().match(HEX);
  return m ? `#${m[1]!.toLowerCase()}` : RED;
}

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Trim to a whole word, with an ellipsis, so a long headline never runs off the card. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/**
 * Display size for wide capitals: the longest word must fit the 1056px
 * measure (Anybody at 122% width runs ~0.86em per capital), never above
 * 128px and never below 58px; two lines at most for the longest titles.
 */
export function displaySize(title: string): number {
  const words = title.toUpperCase().split(/\s+/).filter(Boolean);
  const longest = Math.max(4, ...words.map((w) => w.length));
  const byWord = 1056 / (longest * 0.86);
  const byLength = title.length <= 12 ? 128 : title.length <= 22 ? 104 : title.length <= 34 ? 84 : 68;
  return Math.round(Math.max(58, Math.min(128, byWord, byLength)));
}

function host(): string {
  try { return new URL(siteOrigin()).host; } catch { return 'apex'; }
}

/** The card itself (exported for tests: it is a plain element tree). */
export function OgCard({ data, site }: { data: OgCardData; site: string }) {
  const accent = accentOf(data.accent);
  const tone = data.tone ?? 'display';
  const stats = (data.stats ?? []).filter((s) => s.value.trim()).slice(0, 4);
  const title = tone === 'display' ? clip(data.title, 46) : clip(data.title, 120);
  const size = tone === 'display' ? displaySize(title) : title.length > 80 ? 52 : 60;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: NIGHT, color: WHITE, fontFamily: 'Hanken Grotesk' }}>
      {/* brushed carbon: a broad specular band over fine diagonal lines */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.022) 0px, rgba(255,255,255,0.022) 1px, transparent 1px, transparent 5px)' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', backgroundImage: 'linear-gradient(115deg, transparent 22%, rgba(255,255,255,0.04) 44%, transparent 64%)' }} />
      {/* the team's light from the right and the floodlight from above (linear washes: Satori draws them cleanly) */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', backgroundImage: `linear-gradient(105deg, rgba(5,5,6,0) 45%, ${rgba(accent, 0.16)} 75%, ${rgba(accent, 0.34)} 100%)` }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', backgroundImage: 'linear-gradient(180deg, rgba(233,240,255,0.09) 0%, rgba(233,240,255,0) 42%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, display: 'flex', background: accent }} />

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', padding: '56px 72px 62px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* the wordmark (components/ds/shell/Wordmark): extended capitals, the start-light red square at the apex */}
          <div style={{ display: 'flex', alignItems: 'flex-start', fontFamily: 'Anybody', fontSize: 36, lineHeight: 1, letterSpacing: '0.01em' }}>
            <span>APEX</span>
            <span style={{ display: 'flex', width: 9, height: 9, background: RED, marginLeft: 3, marginTop: 3 }} />
          </div>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 500, color: TITANIUM, letterSpacing: '0.06em' }}>{site}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 22, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: RED_TEXT }}>
            <span style={{ display: 'flex', width: 40, height: 3, background: RED, marginRight: 16 }} />
            {clip(data.kicker, 64)}
          </div>
          <div
            style={tone === 'display'
              ? { display: 'flex', flexWrap: 'wrap', marginTop: 20, fontFamily: 'Anybody', fontSize: size, lineHeight: 0.98, letterSpacing: '0.01em', textTransform: 'uppercase', maxWidth: 1056 }
              : { display: 'flex', marginTop: 22, fontSize: size, fontWeight: 700, lineHeight: 1.12, letterSpacing: '0.002em', maxWidth: 1000 }}
          >
            {title}
          </div>
          {data.subtitle ? <div style={{ display: 'flex', marginTop: 22, fontSize: 28, fontWeight: 500, color: SILVER, maxWidth: 1000 }}>{clip(data.subtitle, 90)}</div> : null}
        </div>

        {stats.length ? (
          <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.16)', paddingTop: 22 }}>
            {stats.map((s) => (
              <div key={s.label} style={{ display: 'flex', flexDirection: 'column', marginRight: 64 }}>
                <div style={{ display: 'flex', fontSize: 17, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: TITANIUM }}>{clip(s.label, 26)}</div>
                <div style={{ display: 'flex', marginTop: 8, fontFamily: 'JetBrains Mono', fontSize: 48, color: WHITE }}>{clip(s.value, 16)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: 19, fontWeight: 500, color: TITANIUM, letterSpacing: '0.04em' }}>Independent, fan-built Formula 1 platform · Not affiliated with Formula 1</div>
        )}
      </div>
    </div>
  );
}

/** Render one card as a 1200x630 PNG. */
export async function renderOgCard(data: OgCardData, { cacheControl = OG_CACHE_CONTROL }: { cacheControl?: string } = {}): Promise<ImageResponse> {
  const fonts = await loadFonts();
  return new ImageResponse(<OgCard data={data} site={host()} />, {
    ...OG_SIZE,
    fonts,
    headers: { 'cache-control': cacheControl },
  });
}
