import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { Media, type MediaCredit } from '@/components/ds';
import { normalizeHex } from '@/components/ds/color';
import { Kicker, LitPortrait, TeamBar } from './carbon/primitives';
import { fitSize } from './fit';

export type HeroPicture =
  | { kind: 'cutout'; src: string; glyph: string | null }
  | { kind: 'portrait'; src: string; credit: MediaCredit | null }
  | { kind: 'none' };

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

/**
 * Driver Prestige hero, Carbon & Light: the night stage with the static
 * floodlight, the driver lit in their team light on the right (the shared
 * Portrait with masked key and rim light, the crop fading into the floor,
 * the race number as an outlined plane behind), identity on the left. The
 * surname is fitted to its column by length, so it never clips or breaks
 * mid-word. A historic driver shows their Commons photograph (credited on
 * /references) as a framed print; without any picture, a type plate with the racing years.
 * Entrance is pure CSS (first frame = first paint), off under reduced motion.
 */
export function ProfileHero({
  firstName,
  lastName,
  crumbs,
  meta,
  team,
  description,
  picture,
  teamColor,
  plateYears,
  number,
  children,
  compact = false,
}: {
  firstName: string;
  lastName: string;
  crumbs: { label: string; href?: string }[];
  meta: string[];
  /** The current team (from the driver's latest race entry), linked to its page when known. */
  team: { name: string; color: string; href?: string | null } | null;
  description?: string | null;
  picture: HeroPicture;
  teamColor: string | null;
  plateYears?: string | null;
  number?: number | null;
  children?: ReactNode;
  compact?: boolean;
}) {
  const fullName = `${firstName} ${lastName}`;
  const tc = normalizeHex(teamColor) ?? '#9b9ea7';
  const surnameSize = fitSize(lastName, compact ? 'clamp(2.6rem, 1rem + 6vw, 6.5rem)' : 'clamp(3rem, 0.8rem + 8vw, 8.75rem)', { stretch: 1.22 });
  return (
    <section aria-labelledby="driver-name" className="relative isolate overflow-hidden border-b border-[color:var(--bc-rule)]" style={{ '--team': tc } as CSSProperties}>
      <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-70" />
      <div aria-hidden className="bc-flood-static absolute inset-0 -z-10" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_45%_60%_at_78%_55%,color-mix(in_srgb,var(--team)_16%,transparent),transparent_70%)]" />
      <div className="ds-container grid items-end gap-x-10 gap-y-6 pt-6 md:grid-cols-12 md:pt-10">
        <div className={`min-w-0 pb-10 md:col-span-7 md:pb-14 ${compact ? 'lg:col-span-8' : 'lg:col-span-7'}`}>
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-x-2 text-[0.875rem] text-[color:var(--bc-titanium)]">
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <li key={i} className="flex min-w-0 items-center gap-2">
                    {c.href && !last
                      ? <Link href={c.href} className="inline-flex min-h-11 items-center text-[color:var(--bc-silver)] underline-offset-4 hover:text-white hover:underline">{c.label}</Link>
                      : <span aria-current={last ? 'page' : undefined} className="min-w-0 [overflow-wrap:anywhere]">{c.label}</span>}
                    {!last && <span aria-hidden>/</span>}
                  </li>
                );
              })}
            </ol>
          </nav>
          <Kicker className="bc-in-up mt-5" as="div">
            {team && (team.href
              ? <Link href={team.href} className="inline-flex min-h-11 items-center gap-2 text-[color:var(--bc-white)] underline decoration-white/30 underline-offset-4 hover:decoration-[color:var(--bc-red)]"><TeamBar color={team.color} />{team.name}</Link>
              : <span className="inline-flex items-center gap-2 text-[color:var(--bc-white)]"><TeamBar color={team.color} />{team.name}</span>)}
            {meta.map((m, i) => <span key={m} className="inline-flex items-center gap-3">{(team || i > 0) && <span aria-hidden className="text-[color:var(--bc-titanium)]">/</span>}{m}</span>)}
          </Kicker>
          <h1 id="driver-name" className="mt-5" style={{ containerType: 'inline-size' }}>
            <span className="bc-mask"><span className="bc-in-rise block text-[clamp(1.25rem,2.2vw,1.75rem)] font-medium text-[color:var(--bc-silver)]" style={d(100)}>{firstName}</span></span>{' '}
            <span className="mt-1 block"><span className="bc-mask" style={{ fontSize: surnameSize }}><span className="bc-in-rise bc-display block whitespace-nowrap text-[color:var(--bc-white)]" style={d(180)}>{lastName}</span></span></span>
          </h1>
          {description && (
            <p className="bc-in-up mt-5 max-w-[42ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)] first-letter:uppercase" style={d(300)}>{description}</p>
          )}
          {children && <div className="bc-in-up mt-8" style={d(380)}>{children}</div>}
        </div>
        <div className={`bc-in-strike relative md:col-span-5 ${compact ? 'lg:col-span-4' : 'lg:col-span-5'}`} style={d(200)}>
          <Stage picture={picture} fullName={fullName} plateYears={plateYears} teamColor={tc} number={number ?? null} compact={compact} />
        </div>
      </div>
    </section>
  );
}

function Stage({ picture, fullName, plateYears, teamColor, number, compact }: { picture: HeroPicture; fullName: string; plateYears?: string | null; teamColor: string; number: number | null; compact: boolean }) {
  const width = compact ? 'max-w-[22rem]' : 'max-w-[34rem]';
  if (picture.kind === 'cutout') {
    return (
      <div className={`relative mx-auto w-full ${width}`}>
        {number !== null && <span aria-hidden className="dr-plane absolute -top-2 right-0 z-0 text-[clamp(7rem,18vw,15rem)] opacity-45">{number}</span>}
        <LitPortrait src={picture.src} name={fullName} teamColor={teamColor} framing="bust" ratio="4 / 5" priority sizes="(max-width: 768px) 90vw, 40vw" className="relative z-[1]" />
        <div aria-hidden className="absolute inset-x-[-20%] bottom-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      </div>
    );
  }
  if (picture.kind === 'portrait') {
    return (
      <div className={`relative mx-auto mb-10 w-full md:mb-14 ${compact ? 'max-w-[18rem]' : 'max-w-[24rem]'}`}>
        <div className="dr-frame">
          <Media src={picture.src} alt={fullName} kind="portrait" priority sizes="(max-width: 768px) 80vw, 30vw" />
        </div>
      </div>
    );
  }
  const plate = plateYears ?? fullName.split(/\s+/).map((w) => w[0]).join('');
  return (
    <div className={`relative mx-auto mb-10 flex w-full flex-col justify-end overflow-hidden rounded-[18px] p-6 ring-1 ring-white/10 md:mb-14 ${compact ? 'max-w-[18rem]' : 'max-w-[24rem]'}`} style={{ aspectRatio: '4 / 5', background: 'radial-gradient(closest-side at 50% 35%, rgb(233 240 255 / 0.08), transparent), #0a0a0c' }}>
      <div style={{ containerType: 'inline-size' }}>
        <span aria-hidden className="bc-mono block whitespace-nowrap leading-[0.9] text-[color:var(--bc-silver)]" style={{ fontSize: fitSize(plate, '5rem', { oneLine: true }) }}>{plate}</span>
      </div>
      <p className="bc-label mt-4 text-[color:var(--bc-titanium)]">No photograph on record</p>
      <span className="sr-only">No photograph of {fullName} is available.</span>
    </div>
  );
}
