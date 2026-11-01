/**
 * The team's emblem in light, for a team with no picture anywhere: a wide
 * carbon plate lit in the team colour with a red rule and the team's name
 * engraved in outline. Decoration only (the name is the h1 above), never
 * presented as a photograph.
 */
export function TeamEmblem({ name, compact }: { name: string; compact: boolean }) {
  return (
    <div aria-hidden data-team-emblem className={`relative mx-auto overflow-hidden rounded-[22px] bg-[color:var(--bc-carbon)] ring-1 ring-[color:var(--bc-rule)] ${compact ? 'max-w-[960px]' : 'max-w-[1400px]'}`} style={{ aspectRatio: compact ? '1200 / 220' : '1200 / 300' }}>
      <div className="bc-carbon absolute inset-0 opacity-70" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_90%_at_70%_100%,color-mix(in_srgb,var(--team)_38%,transparent),transparent_70%)]" />
      <div className="absolute -left-[5%] top-[58%] h-[14%] w-[110%] -rotate-[4deg] bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--team)_70%,white_10%)_25%,color-mix(in_srgb,var(--team)_70%,white_10%)_75%,transparent)] opacity-60" />
      <div className="absolute -left-[5%] top-[74%] h-[3%] w-[110%] -rotate-[4deg] bg-[linear-gradient(90deg,transparent,var(--bc-red)_30%,var(--bc-red)_70%,transparent)]" />
      <div className="absolute inset-0 grid place-items-center px-[4%] [container-type:inline-size]">
        <p className="tc-outline bc-display whitespace-nowrap leading-none" style={{ fontSize: `min(9rem, calc(100cqi / ${Math.max(4, name.length) * 0.78}))` }}>{name}</p>
      </div>
    </div>
  );
}
