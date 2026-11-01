/**
 * Per-host image rendition rules.
 *
 * Apex does not host editorial photography, so sharpness depends on asking
 * each publisher CDN for its best rendition instead of whatever thumbnail a
 * feed happened to embed. Every rule below was probed against the live CDN
 * (2026-09-30); none invents a URL shape the host does not serve.
 *
 *   motorsport.com / autosport  /images/amp/<id>/s{1..7}/  → s6 = 1200px max
 *   The Race (storage.ghost.io) originals are 2000px; /size/wNNN/ variants
 *   YouTube                     hqdefault 480x360 (baked 4:3 bars) →
 *                               maxresdefault 1280x720, sddefault 640x480
 *   media.formula1.com          .transform/1col (93px) → raw PNG 840px;
 *                               /image/upload/<…w_N…>/ Cloudinary renditions
 *                               of the 2026 cut-out/car masters (re-probed
 *                               2026-10-25): any width, AVIF/WebP negotiated
 *   Wikimedia                   only bucket widths render (250, 330, 500,
 *                               960, 1280, 1920; others answer 400), on the
 *                               /thumb/ path of upload. or thumb.wikimedia.org;
 *                               every Commons candidate is then rewritten to
 *                               the first-party /media/commons/ path, so the
 *                               browser never contacts Wikimedia (F-11)
 */

import { firstPartyImageUrl, firstPartySrcSet, upstreamOfFirstParty } from './commons-proxy';

export interface Rendition {
  /** Best single URL to use as `src`. */
  src: string;
  /** Optional responsive candidates. */
  srcSet?: string;
  /** Largest width this host can deliver for the image, when known. */
  maxWidth?: number;
  /** Ordered fallbacks if `src` fails or returns a placeholder. */
  fallbacks?: string[];
}

/**
 * Cloudinary serves any width. Small widths (80-240) right-size table
 * headshots (a 40 px slot at dpr 3 needs 120 px; audit 2026-11-01 RES-low); 720
 * fits a ~230 px phone portrait at dpr 3 (DRV-3, which otherwise took 960);
 * 2400-3840 keep full-width car heroes sharp on 2x screens (the car masters
 * are 3840 px; TEAMS-4).
 */
const F1_MEDIA_WIDTHS = [80, 120, 160, 240, 320, 480, 640, 720, 960, 1280, 1600, 1920, 2400, 2880, 3840];
const F1_MEDIA_MAX = F1_MEDIA_WIDTHS.at(-1)!;
const F1_LEGACY_WIDTHS = [320, 480, 640, 960, 1536, 1920];
/** Wikimedia's served thumbnail buckets (see the header). */
const COMMONS_BUCKETS = [330, 500, 960, 1280, 1920];
const WIKIMEDIA_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

function safeUrl(src: string): URL | null {
  try {
    return new URL(src);
  } catch {
    return null;
  }
}

export function youtubeId(src: string): string | null {
  const m = src.match(/\/vi(?:_webp)?\/([A-Za-z0-9_-]{6,})\//);
  return m?.[1] ?? null;
}

export interface RenditionOptions {
  /**
   * The original's pixel width, when known (Commons metadata). Candidates are
   * capped to it, so a 433 px portrait is never offered as a 1920w upscale.
   */
  intrinsicWidth?: number | null;
}

/**
 * Resolve the sharpest deliverable rendition for a third-party image.
 * Commons candidates come back as first-party `/media/commons/` URLs, and a
 * first-party Commons URL is accepted as input.
 */
export function bestRendition(src: string, options: RenditionOptions = {}): Rendition {
  const r = hostRendition(upstreamOfFirstParty(src) ?? src, options);
  return {
    ...r,
    src: firstPartyImageUrl(r.src),
    ...(r.srcSet ? { srcSet: firstPartySrcSet(r.srcSet) } : {}),
    ...(r.fallbacks ? { fallbacks: r.fallbacks.map(firstPartyImageUrl) } : {}),
  };
}

function hostRendition(src: string, options: RenditionOptions): Rendition {
  const intrinsic = typeof options.intrinsicWidth === 'number' && Number.isFinite(options.intrinsicWidth) && options.intrinsicWidth > 0
    ? Math.round(options.intrinsicWidth) : null;
  const url = safeUrl(src);
  if (!url) return { src };
  const host = url.hostname;

  // motorsport.com + autosport share the same image CDN.
  if (/^cdn-\d+\.motorsport\.com$/.test(host)) {
    const upgraded = src.replace(/\/s[1-7]\//, '/s6/');
    // Probed renditions (2026-10-26): s3 300x200, s2 413x275, s1 600x400, s6 1200x801.
    // A srcSet lets a phone card take the 43-162 KB file instead of the 650 KB one.
    const at = (size: string) => src.replace(/\/s[1-7]\//, `/${size}/`);
    // Only a URL without a size bucket has no renditions; one already at s6 still gets the phone sizes.
    const srcSet = /\/s[1-7]\//.test(src) ? `${at('s3')} 300w, ${at('s2')} 413w, ${at('s1')} 600w, ${upgraded} 1200w` : undefined;
    return { src: upgraded, srcSet, maxWidth: 1200, fallbacks: upgraded === src ? [] : [src] };
  }

  // The Race (Ghost). Originals are ~2000px; Ghost serves /size/wNNN/.
  if (host === 'storage.ghost.io' || host.endsWith('.ghost.io')) {
    const original = src.replace(/\/content\/images\/size\/w\d+\//, '/content/images/');
    const sized = (w: number) => original.replace('/content/images/', `/content/images/size/w${w}/`);
    return {
      src: original,
      srcSet: [600, 1000, 1600].map((w) => `${sized(w)} ${w}w`).concat(`${original} 2000w`).join(', '),
      maxWidth: 2000,
    };
  }

  // ESPN combiner resizes by `w=` itself (probed 2026-11-01: w=480 33 KB vs 154 KB at 1296), so a
  // card takes a right-sized file without an optimizer pass. The real width is in the file name.
  if (/(^|\.)espncdn\.com$/.test(host) && url.pathname === '/combiner/i' && url.searchParams.get('img')) {
    const base = src.replace(/&w=\d+/, '');
    const real = Number(url.searchParams.get('img')!.match(/_(\d{3,4})x\d{3,4}/)?.[1]) || intrinsic || 1296;
    const widths = [480, 640, 960].filter((w) => w < real).concat(real);
    const at = (w: number) => `${base}&w=${w}`;
    return { src: at(real), srcSet: widths.map((w) => `${at(w)} ${w}w`).join(', '), maxWidth: real, fallbacks: [base] };
  }

  // YouTube thumbnails: maxres (16:9, no letterbox bars) first.
  if (/(^|\.)ytimg\.com$/.test(host)) {
    const id = youtubeId(src);
    if (id) {
      const base = `https://i.ytimg.com/vi/${id}`;
      return {
        src: `${base}/maxresdefault.jpg`,
        // Every real rendition, so a card takes the smallest one that covers it (audit 2026-11-01 HNV-4):
        // mqdefault 320x180 (16:9), hqdefault 480x360 and sddefault 640x480 (the same 16:9 frame with
        // 4:3 bars, which `cover` in a 16:9 frame trims exactly), maxresdefault 1280x720.
        srcSet: `${base}/mqdefault.jpg 320w, ${base}/hqdefault.jpg 480w, ${base}/sddefault.jpg 640w, ${base}/maxresdefault.jpg 1280w`,
        maxWidth: 1280,
        fallbacks: [`${base}/sddefault.jpg`, `${base}/hqdefault.jpg`],
      };
    }
  }

  // Formula 1 media (Cloudinary): rewrite the width of the first
  // transformation segment per candidate. Masters are 2000px+ wide.
  if (host === 'media.formula1.com') {
    const m = url.pathname.match(/^\/image\/upload\/([^/]*\bw_\d+[^/]*)\/(.+)$/);
    if (m) {
      const [, transform, rest] = m;
      const variant = (w: number) => `https://media.formula1.com/image/upload/${transform!.replace(/\bw_\d+/, `w_${w}`)}/${rest}`;
      return { src, srcSet: F1_MEDIA_WIDTHS.map((w) => `${variant(w)} ${w}w`).join(', '), maxWidth: F1_MEDIA_MAX };
    }
  }

  // Formula 1 media archive season portraits: `.img.{width}.medium.jpg`
  // renditions of a 1920px square master (probed 2026-10-26).
  if (host === 'media.formula1.com') {
    const legacy = url.pathname.match(/^(\/content\/dam\/fom-website\/drivers\/\d{4}Drivers\/[a-z]+\.jpg)\.img\.\d+\.medium\.jpg$/);
    if (legacy) {
      const variant = (w: number) => `https://media.formula1.com${legacy[1]}.img.${w}.medium.jpg`;
      return { src, srcSet: F1_LEGACY_WIDTHS.map((w) => `${variant(w)} ${w}w`).join(', '), maxWidth: 1920 };
    }
  }

  // Formula 1 media: drop the tiny column transform, keep the 840px master.
  if (host === 'media.formula1.com' && /\.transform\/\d+col\/image\.png$/.test(src)) {
    const master = src.replace(/\.transform\/\d+col\/image\.png$/, '');
    return {
      src: master,
      srcSet: `${src.replace(/\.transform\/\d+col\//, '.transform/4col/')} 432w, ${src.replace(/\.transform\/\d+col\//, '.transform/6col/')} 658w, ${master} 840w`,
      maxWidth: 840,
      fallbacks: [src],
    };
  }

  // Wikimedia Special:FilePath: ?width= snaps to a bucket, but returns the
  // full original once the width passes the original's bucket, so cap at 1280.
  if (host === 'commons.wikimedia.org' && url.pathname.includes('Special:FilePath')) {
    const variant = (w: number) => {
      const v = new URL(url);
      v.searchParams.set('width', String(w));
      return v.href;
    };
    const widths = [500, 960, 1280];
    return { src: variant(960), srcSet: widths.map((w) => `${variant(w)} ${w}w`).join(', '), maxWidth: 1280 };
  }
  if (WIKIMEDIA_HOSTS.has(host) && url.pathname.startsWith('/wikipedia/commons/')) {
    const parts = url.pathname.split('/');
    // ['', 'wikipedia', 'commons', ('thumb',) a, ab, file, (NNNpx-file)]
    const thumb = parts[3] === 'thumb';
    const [a, ab, file] = thumb ? [parts[4], parts[5], parts[6]] : [parts[3], parts[4], parts[5]];
    if (a && ab && file && /\.(?:jpe?g|png|webp|gif|svg)$/i.test(file)) {
      const suffix = /\.svg$/i.test(file) ? '.png' : '';
      const variant = (w: number) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${file}/${w}px-${file}${suffix}`;
      const current = thumb ? Number(parts[7]?.match(/^(\d+)px-/)?.[1]) : NaN;
      if (intrinsic !== null && !suffix) {
        // Only buckets narrower than the original exist. The original is a candidate only when it is
        // narrower than the top bucket (then it is the largest picture there is); a 5184 px, 7 MB
        // original is never offered (audit 2026-11-01 SRL-1: it was labelled "1920w").
        const original = `https://upload.wikimedia.org/wikipedia/commons/${a}/${ab}/${file}`;
        const top = COMMONS_BUCKETS.at(-1)!;
        const buckets = COMMONS_BUCKETS.filter((w) => w < intrinsic);
        const withOriginal = intrinsic < top;
        const candidates = [...buckets.map((w) => `${variant(w)} ${w}w`), ...(withOriginal ? [`${original} ${intrinsic}w`] : [])];
        const start = buckets.includes(current) ? current : buckets.filter((w) => w <= 960).at(-1);
        return { src: start ? variant(start) : original, srcSet: candidates.join(', '), maxWidth: withOriginal ? intrinsic : top };
      }
      const start = COMMONS_BUCKETS.includes(current) ? current : 960;
      return {
        src: variant(start),
        srcSet: COMMONS_BUCKETS.map((w) => `${variant(w)} ${w}w`).join(', '),
        maxWidth: 1920,
      };
    }
  }

  // WordPress publishers (RaceFans etc.): strip the -WxH thumbnail suffix.
  const wp = src.match(/^(.*\/wp-content\/uploads\/.*?)-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))(\?.*)?$/i);
  if (wp) {
    const original = `${wp[1]}${wp[2]}`;
    return { src: original, fallbacks: [src] };
  }

  return { src };
}

/**
 * Rough server-side resolution score used to rank hero candidates before
 * the browser measures anything: prefer hosts that can deliver a sharp
 * full-bleed frame.
 */
export function heroResolutionScore(src?: string | null): number {
  if (!src) return 0;
  return bestRendition(src).maxWidth ?? 800;
}

/**
 * next.config.ts `images.imageSizes` (384) + `deviceSizes`; the optimizer answers 400 for any other width.
 * Kept short on purpose (review 2026-11-01, finding 4): every width is one more transformation per
 * photo on the Vercel plan. 384 fits a phone list card at dpr 1-2 and a desktop thumb, 640 a card at
 * dpr 2, 1080 a full-width phone hero at dpr 3, 1440 a desktop lead card at dpr 2, 1920 the bleed.
 */
export const OPTIMIZER_WIDTHS = [384, 640, 1080, 1440, 1920] as const;
/** A first-party Commons bucket thumb (lib/commons-proxy): `/media/commons/thumb/a/ab/File/960px-File`. */
const COMMONS_THUMB = /^\/media\/commons\/thumb\/[^?#]+\/(\d+)px-[^/?#]+$/;

/** True for a first-party Commons bucket thumb (served as Wikimedia's own bucket renditions, never optimized). */
export function isCommonsThumb(src: string): boolean {
  return COMMONS_THUMB.test(src);
}
/**
 * News publisher hosts listed in next.config.ts `images.remotePatterns` whose photos come as large
 * JPEGs only, so the optimizer earns its transformation. YouTube is not here: it serves 320/480/640/
 * 1280 renditions itself (bestRendition offers them as a srcset), so a poster costs no transformation.
 */
const OPTIMIZER_HOST = /^(?:cdn-\d+\.motorsport\.com|storage\.ghost\.io|i\.guim\.co\.uk)$/;

/**
 * A Commons bucket thumb as Wikimedia's own bucket renditions (330/500/960/1280/1920, through the
 * first-party proxy), never wider than the bucket the page chose (that one is known to exist for
 * the original). The browser picks the smallest bucket that covers the frame; no optimizer pass.
 */
export function commonsBucketRendition(r: Rendition): Rendition {
  const match = r.src.match(COMMONS_THUMB);
  if (!match) return r;
  const source = Number(match[1]);
  const list = (r.srcSet ?? '').split(',').map((c) => c.trim()).filter(Boolean)
    .filter((c) => { const w = Number(c.match(/\s(\d+)w$/)?.[1]); return Number.isFinite(w) && w <= source; });
  return { src: r.src, ...(list.length > 1 ? { srcSet: list.join(', ') } : {}), maxWidth: source, ...(r.fallbacks ? { fallbacks: r.fallbacks } : {}) };
}

/**
 * The same picture through the Next image optimizer (resized, WebP), for a publisher photo whose
 * host serves only large JPEGs. The publisher's own rendition stays the fallback, so a refused or
 * failed optimization still shows the photo. Hosts with right-sized renditions of their own
 * (Commons buckets, YouTube, F1 media Cloudinary) are returned without the optimizer.
 */
export function optimizedRendition(r: Rendition): Rendition {
  // Commons (audit 2026-11-01 DRV-6, review finding 4): the bucket renditions right-size the photo
  // without spending a transformation; the srcset stops at the bucket the page chose.
  if (COMMONS_THUMB.test(r.src)) return commonsBucketRendition(r);
  let host: string;
  try { host = new URL(r.src).hostname; } catch { return r; }
  if (!OPTIMIZER_HOST.test(host)) return r;
  const cover = OPTIMIZER_WIDTHS.find((w) => w >= (r.maxWidth ?? 1920)) ?? OPTIMIZER_WIDTHS.at(-1)!;
  const widths = OPTIMIZER_WIDTHS.filter((w) => w <= cover);
  const at = (w: number) => `/_next/image?url=${encodeURIComponent(r.src)}&w=${w}&q=75`;
  // The optimizer never enlarges: the covering width is labelled with the photo's real width.
  const label = (w: number) => (r.maxWidth ? Math.min(w, r.maxWidth) : w);
  return { src: at(cover), srcSet: widths.map((w) => `${at(w)} ${label(w)}w`).join(', '), maxWidth: r.maxWidth, fallbacks: [r.src, ...(r.fallbacks ?? [])] };
}
