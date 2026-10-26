/**
 * Live team colours: Jolpica constructorId -> the official timing feed's
 * `team_colour` (OpenF1 drivers), joined through the current standings'
 * driver codes. Teams with no colour in the feed (historical constructors,
 * or any team while timing is unavailable) get the neutral colour.
 */

export type TeamColours = Readonly<Record<string, string>>;

/** Neutral rule colour for teams the timing feed does not describe. */
export const NEUTRAL_TEAM_COLOUR = '#8A8D91';

const HEX = /^#?([0-9A-Fa-f]{6})$/;

export function normaliseTeamColour(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(HEX);
  return match ? `#${match[1]!.toUpperCase()}` : null;
}

/**
 * Build the constructorId -> colour map. The first driver row with a valid
 * colour wins for a constructor; nothing is guessed for the rest.
 */
export function teamColoursFromTiming(
  standings: ReadonlyArray<{ constructorSlug: string; code: string }>,
  timing: ReadonlyArray<{ name_acronym: string; team_colour?: string | null }>,
): TeamColours {
  const byCode = new Map<string, string>();
  for (const driver of timing) {
    const colour = normaliseTeamColour(driver.team_colour);
    if (colour && driver.name_acronym && !byCode.has(driver.name_acronym)) byCode.set(driver.name_acronym, colour);
  }
  const out: Record<string, string> = {};
  for (const row of standings) {
    if (!row.constructorSlug || out[row.constructorSlug]) continue;
    const colour = byCode.get(row.code);
    if (colour) out[row.constructorSlug] = colour;
  }
  return Object.freeze(out);
}
