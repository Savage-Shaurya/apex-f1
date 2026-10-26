import { teamColoursFromTiming, type TeamColours } from '@/lib/team-colours';
import snapshot from './team-colour-snapshot.json';

/** Shape of the committed last-good OpenF1 colour snapshot. */
export interface TeamColourSnapshot {
  source: string;
  season: number;
  session_key: number;
  session: string;
  location: string;
  session_end: string;
  drivers: Array<{ name_acronym: string; team_name: string; team_colour: string }>;
}

/**
 * Colours from the persisted last-good OpenF1 answer, only for the season it
 * was captured in (a new season's liveries are never guessed from the old one).
 */
export function snapshotColours(
  snapshot: TeamColourSnapshot,
  season: number | null,
  standings: ReadonlyArray<{ constructorSlug: string; code: string }>,
): TeamColours {
  if (season === null || snapshot.season !== season) return Object.freeze({});
  return teamColoursFromTiming(standings, snapshot.drivers);
}

/** The committed snapshot (see team-colour-snapshot.json for its session and capture time). */
export const TEAM_COLOUR_SNAPSHOT = snapshot as TeamColourSnapshot;

/** Last-good colours for a season from the committed snapshot. */
export function lastGoodColours(season: number | null, standings: ReadonlyArray<{ constructorSlug: string; code: string }>): TeamColours {
  return snapshotColours(TEAM_COLOUR_SNAPSHOT, season, standings);
}
