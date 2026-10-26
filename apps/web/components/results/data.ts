import { jolpica } from '@apex/api-client/jolpica';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { buildProgression, roundPointsFrom, type FinalStanding, type ProgressionState, type SprintRaceInput } from './progression';
import type { BoardProgression } from './StandingsBoard';

/** First season of the constructors' championship (Jolpica returns no table before it). */
export const CONSTRUCTORS_FROM = 1958;

export interface SeasonResultsSummary {
  progression: BoardProgression | null;
  /** Why the chart is absent, in plain words (null when it is drawn). */
  progressionNote: string | null;
  /** Distinct race winners this season (drivers or constructors), from race results. */
  winners: number | null;
  /** Rounds with a published classification. */
  roundsRun: number | null;
}

/**
 * Season race results plus sprint results, summed into running totals that
 * must reproduce the official table (components/results/progression.ts).
 * Any failed read leaves the chart out with that reason; the official table
 * still renders.
 */
/** `throughRound` is the round the official table was published after; later results are left out so both describe the same moment. */
export async function loadSeasonSummary(season: number, kind: 'drivers' | 'teams', finals: FinalStanding[], throughRound: number | null): Promise<SeasonResultsSummary> {
  const opts = { ...SPORT_READ_OPTIONS, revalidate: 1800 };
  // Season results carry no session list, so sprint weekends come from the calendar.
  const [results, schedule] = await Promise.all([
    readPublicSport(() => jolpica.getSeasonResults(season, opts)),
    readPublicSport(() => jolpica.getSchedule(season, { ...opts, revalidate: 3600 })),
  ]);
  if (results.state === 'unavailable') {
    return { progression: null, progressionNote: 'The round-by-round chart can\'t be shown right now. The table below is the official one.', winners: null, roundsRun: null };
  }
  const races = [...results.data].filter((r) => throughRound == null || Number(r.round) <= throughRound).sort((a, b) => Number(a.round) - Number(b.round));
  const winnerIds = new Set(races.map((r) => {
    const w = r.Results.find((x) => x.position === '1');
    return kind === 'drivers' ? w?.Driver.driverId : w?.Constructor?.constructorId;
  }).filter(Boolean));

  if (schedule.state === 'unavailable') {
    return { progression: null, progressionNote: 'The round-by-round chart can\'t be shown right now. The table below is the official one.', winners: winnerIds.size, roundsRun: races.length };
  }
  const run = new Set(races.map((r) => Number(r.round)));
  const sprintRounds = schedule.data.filter((r) => r.Sprint && run.has(Number(r.round))).map((r) => Number(r.round));
  const sprintReads = await Promise.all(sprintRounds.map((round) => readPublicSport(() => jolpica.getSprint(season, round, opts))));
  if (sprintReads.some((r) => r.state === 'unavailable')) {
    return { progression: null, progressionNote: 'The round-by-round chart can\'t be shown right now. The table below is the official one.', winners: winnerIds.size, roundsRun: races.length };
  }
  const sprints: SprintRaceInput[] = sprintRounds.map((round, i) => ({ round, rows: (sprintReads[i] as { state: 'available'; data: SprintRaceInput['rows'] }).data }));
  const state: ProgressionState = buildProgression(roundPointsFrom(races, sprints, kind), finals);
  if (state.state !== 'available') {
    return {
      progression: null,
      progressionNote: state.state === 'mismatch' ? state.reason : 'No round of this season has been classified yet.',
      winners: winnerIds.size,
      roundsRun: races.length,
    };
  }
  const p = state.progression;
  return {
    progression: { rounds: p.rounds, totals: Object.fromEntries(p.totals), positions: Object.fromEntries(p.positions) },
    progressionNote: null,
    winners: winnerIds.size,
    roundsRun: races.length,
  };
}
