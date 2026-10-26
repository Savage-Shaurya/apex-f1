'use client';

import Link from 'next/link';
import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { gsap } from 'gsap';
import { cn } from '@apex/ui';
import { RollingNumber } from '@/components/motion/RollingNumber';

export interface StudioCardDriver {
  slug: string;
  position: number;
  firstName: string;
  lastName: string;
  team: string;
  color: string;
  number: number | null;
  torso: string | null;
  headshot: string | null;
  points: number;
  wins: number;
  gapToLeader: number;
}

/**
 * Champion card, studio edition. Combines three React Bits ideas, rebuilt to
 * run on transforms and CSS variables only:
 *   TiltedCard   the card leans toward a fine pointer (gsap.quickTo, no loop of its own)
 *   SpotlightCard a soft key light follows the pointer across the surface
 *   GlareHover   one glare streak crosses the glass on hover or focus
 * and fixes the "sticker": the transparent portrait sits inside a team-colour
 * light field, is lit by a key and a rim masked to its silhouette, fades into
 * the floor at the crop line, and floats a plane in front of the driver's
 * race number for depth.
 */
export function StudioCard({ d, leader }: { d: StudioCardDriver; leader: boolean }) {
  const card = useRef<HTMLElement>(null);
  const tilt = useRef<{ x: (v: number) => void; y: (v: number) => void; nx: (v: number) => void; ny: (v: number) => void } | null>(null);

  const ensure = () => {
    if (tilt.current || !card.current) return tilt.current;
    if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return null;
    const el = card.current;
    const num = el.querySelector<HTMLElement>('[data-plane="number"]');
    tilt.current = {
      x: gsap.quickTo(el, 'rotationY', { duration: 0.6, ease: 'power3.out' }),
      y: gsap.quickTo(el, 'rotationX', { duration: 0.6, ease: 'power3.out' }),
      nx: num ? gsap.quickTo(num, 'x', { duration: 0.8, ease: 'power3.out' }) : () => {},
      ny: num ? gsap.quickTo(num, 'y', { duration: 0.8, ease: 'power3.out' }) : () => {},
    };
    return tilt.current;
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const el = card.current;
    if (!el || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--mx', `${px * 100}%`);
    el.style.setProperty('--my', `${py * 100}%`);
    const t = ensure();
    if (!t) return;
    t.x((px - 0.5) * 9);
    t.y((0.5 - py) * 7);
    t.nx((0.5 - px) * 18);
    t.ny((0.5 - py) * 12);
  };
  const leave = () => {
    const t = tilt.current;
    if (!t) return;
    t.x(0); t.y(0); t.nx(0); t.ny(0);
  };

  const img = d.torso ?? d.headshot;
  const vars = { '--team': d.color, '--src': img ? `url("${img}")` : 'none', '--mx': '50%', '--my': '30%' } as CSSProperties;
  return (
    <div className="h-full [perspective:1100px]">
      <article
        ref={card}
        onPointerMove={move}
        onPointerLeave={leave}
        style={vars}
        className="group @container relative isolate aspect-[4/5] h-full overflow-hidden lg:aspect-auto lg:min-h-[26rem] rounded-[22px] bg-[#08080a] ring-1 ring-white/10 [transform-style:preserve-3d] transition-shadow duration-500 hover:shadow-[0_30px_80px_-30px_color-mix(in_srgb,var(--team)_55%,transparent)]"
      >
        {/* softbox above, team light field behind */}
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgb(255_255_255/0.07),transparent_32%)]" />
        <div aria-hidden className="bc-field absolute left-1/2 top-[8%] h-[80%] w-[120%] -translate-x-1/2 rounded-full opacity-75" />
        {/* race number plane, behind the driver */}
        {d.number !== null && (
          <span data-plane="number" aria-hidden className="bc-display pointer-events-none absolute right-3 top-[10%] select-none text-[min(13rem,46cqi)] leading-none text-transparent [-webkit-text-stroke:1.5px_color-mix(in_srgb,var(--team)_70%,white_10%)] opacity-60">
            {d.number}
          </span>
        )}
        {/* the driver, lit */}
        {img ? (
          // The fade mask spans the whole card, so the portrait's team glow is never clipped by a box edge.
          <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_52%,transparent_74%)]">
            <div className="absolute inset-x-[6%] bottom-[22%] top-[11%]">
              {/* eslint-disable-next-line @next/next/no-img-element -- CDN crop; the box reserves the space */}
              <img src={img} alt={`${d.firstName} ${d.lastName}`} loading="lazy" decoding="async" className="bc-cutout absolute inset-0 h-full w-full object-contain object-bottom" />
              <div aria-hidden className="bc-lit bc-lit--key" />
              <div aria-hidden className="bc-lit bc-lit--top" />
              <div aria-hidden className="bc-lit bc-lit--rim" />
            </div>
          </div>
        ) : (
          <p className="absolute inset-0 grid place-items-center text-sm text-[color:var(--bc-titanium)]">Portrait unavailable</p>
        )}
        {/* spotlight (follows a fine pointer) and glare streak */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 bg-[radial-gradient(420px_circle_at_var(--mx)_var(--my),rgb(255_255_255/0.10),transparent_60%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"><div className="bc-glare" /></div>
        {/* floor and caption */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[40%] bg-[linear-gradient(180deg,transparent,rgb(5_5_6/0.85)_40%,rgb(5_5_6/0.97))]" />
        <div className="absolute left-5 top-5 flex items-center gap-2">
          <span className="bc-display text-[2.4rem] leading-none text-white">P{d.position}</span>
        </div>
        <p className="bc-label absolute right-5 top-6 max-w-[55%] text-right leading-snug text-[0.68rem] text-[color:var(--bc-silver)]">{d.team}</p>
        <div className="absolute inset-x-5 bottom-5">
          <p className="text-[0.9rem] text-[color:var(--bc-silver)]">{d.firstName}</p>
          <h3 className="bc-display mt-1 whitespace-nowrap text-[length:min(2.6rem,calc((100cqw_-_2.5rem)/var(--n)))]" style={{ '--n': Math.max(6, d.lastName.length) * 0.92 } as CSSProperties}>
            <Link href={`/drivers/${d.slug}`} className="after:absolute after:inset-0 after:content-['']">{d.lastName}</Link>
          </h3>
          <div className="mt-4 flex items-end justify-between gap-4 border-t border-white/10 pt-3">
            <p>
              <span className="bc-mono flex text-[1.6rem] leading-none"><RollingNumber value={d.points} /></span>
              <span className="bc-label mt-1.5 block text-[0.64rem] text-[color:var(--bc-titanium)]">Points · {d.wins} {d.wins === 1 ? 'win' : 'wins'}</span>
            </p>
            <p className={cn('bc-mono text-right text-[0.85rem]', leader ? 'text-[color:var(--bc-white)]' : 'text-[color:var(--bc-silver)]')}>
              {leader ? 'Leader' : `−${d.gapToLeader} to P1`}
            </p>
          </div>
        </div>
      </article>
    </div>
  );
}
