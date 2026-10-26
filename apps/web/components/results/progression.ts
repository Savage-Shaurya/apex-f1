/* ---------------------------------------------------------------------------
 * Championship progression from real classifications.
 *
 * Running totals are summed from each round's race (and sprint) points as
 * Jolpica publishes them. They are shown only when they reproduce the
 * provider's own final table exactly for every entry; otherwise (dropped
 * scores before 1991, shared drives, penalties applied to the table, the
 * pre-1979 constructors' rule of one car per round) the chart is withheld
 * with that reason, never drawn from numbers that disagree with the table.
 * ------------------------------------------------------------------------- */

export interface RoundPoints {
  round: number;
  /** The round's race name as Jolpica publishes it. */
  name: string;
  /** Points scored in that round by entry id (race + sprint). */
  points: ReadonlyMap<string, number>;
  /** Finishing position in the race by entry id (best car for constructors). */
  finish?: ReadonlyMap<string, number>;
}

export interface FinalStanding {
  id: string;
  points: number;
}

export interface Progression {
  rounds: Array<{ round: number; name: string }>;
  /** Cumulative points after each round, by entry id (index = round index). */
  totals: Map<string, number[]>;
  /** Championship position after each round, by entry id (1 = leader). */
  positions: Map<string, number[]>;
}

export type ProgressionState =
  | { state: 'available'; progression: Progression }
  | { state: 'mismatch'; reason: string }
  | { state: 'empty' };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Sum each round's points into running totals and rank entries after every
 * round. Ties keep the provider's final-table order (the final countback),
 * which only matters for display order of equal totals.
 */
export function buildProgression(rounds: readonly RoundPoints[], finals: readonly FinalStanding[]): ProgressionState {
  if (rounds.length === 0 || finals.length === 0) return { state: 'empty' };
  const ordered = [...rounds].sort((a, b) => a.round - b.round);
  const ids = finals.map((f) => f.id);
  const order = new Map(ids.map((id, index) => [id, index]));
  const totals = new Map<string, number[]>(ids.map((id) => [id, []]));
  const running = new Map<string, number>(ids.map((id) => [id, 0]));

  for (const round of ordered) {
    for (const [id, pts] of round.points) {
      if (!running.has(id)) return { state: 'mismatch', reason: 'A classified entry is missing from the official championship table, so the progression chart is not shown.' };
      running.set(id, round2(running.get(id)! + pts));
    }
    for (const id of ids) totals.get(id)!.push(running.get(id)!);
  }

  for (const f of finals) {
    if (round2(running.get(f.id) ?? 0) !== round2(f.points)) {
      return {
        state: 'mismatch',
        reason: 'This season\'s official totals can\'t be rebuilt round by round (for example because of dropped scores, shared drives or penalties), so the progression chart is not shown.',
      };
    }
  }

  const positions = new Map<string, number[]>(ids.map((id) => [id, []]));
  ordered.forEach((_, index) => {
    const ranked = [...ids].sort((a, b) => (totals.get(b)![index]! - totals.get(a)![index]!) || (order.get(a)! - order.get(b)!));
    ranked.forEach((id, rank) => positions.get(id)!.push(rank + 1));
  });

  return {
    state: 'available',
    progression: { rounds: ordered.map((r) => ({ round: r.round, name: r.name })), totals, positions },
  };
}

/** Minimal Jolpica result rows used to build per-round points. */
export interface ResultRaceInput {
  round: string;
  raceName: string;
  Results: Array<{ position: string; positionText: string; points: string; Driver: { driverId: string }; Constructor?: { constructorId: string } }>;
}

export interface SprintRaceInput {
  round: number;
  rows: Array<{ points: string; Driver: { driverId: string }; Constructor?: { constructorId: string } }>;
}

/** Per-round points by driver or constructor from season results plus sprint results. */
export function roundPointsFrom(
  races: readonly ResultRaceInput[],
  sprints: readonly SprintRaceInput[],
  kind: 'drivers' | 'teams',
): RoundPoints[] {
  const idOf = (row: { Driver: { driverId: string }; Constructor?: { constructorId: string } }) =>
    kind === 'drivers' ? row.Driver.driverId : row.Constructor?.constructorId ?? null;
  const sprintByRound = new Map(sprints.map((s) => [s.round, s.rows]));
  return races.map((race) => {
    const round = Number(race.round);
    const points = new Map<string, number>();
    const finish = new Map<string, number>();
    const add = (id: string | null, value: string) => {
      if (!id) return;
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      points.set(id, round2((points.get(id) ?? 0) + n));
    };
    for (const row of race.Results) {
      const id = idOf(row);
      add(id, row.points);
      const pos = /^\d+$/.test(row.positionText) ? Number(row.position) : null;
      if (id && pos != null && (!finish.has(id) || pos < finish.get(id)!)) finish.set(id, pos);
    }
    for (const row of sprintByRound.get(round) ?? []) add(idOf(row), row.points);
    return { round, name: race.raceName, points, finish };
  });
}

/** Standings after a given round index, ordered by position then the final-table order. */
export function standingsAt(progression: Progression, index: number, finalOrder: readonly string[]): Array<{ id: string; points: number; position: number; change: number | null }> {
  const i = Math.max(0, Math.min(index, progression.rounds.length - 1));
  return finalOrder
    .map((id) => {
      const pos = progression.positions.get(id)?.[i] ?? Number.POSITIVE_INFINITY;
      const prev = i > 0 ? progression.positions.get(id)?.[i - 1] ?? null : null;
      return { id, points: progression.totals.get(id)?.[i] ?? 0, position: pos, change: prev == null ? null : prev - pos };
    })
    .sort((a, b) => a.position - b.position);
}
