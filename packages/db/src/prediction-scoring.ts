import type { PredictionPicks } from './schema/prediction';

export const PREDICT_QUESTIONS = [
  { id: 'pole', label: 'Pole position', points: 3 },
  { id: 'winner', label: 'Race winner', points: 5 },
  { id: 'podium', label: 'Podium finish (top 3)', points: 3 },
  { id: 'fastest_lap', label: 'Fastest lap', points: 2 },
] as const;
export type PredictQId = (typeof PREDICT_QUESTIONS)[number]['id'];
export const PREDICT_MAX = PREDICT_QUESTIONS.reduce((n, q) => n + q.points, 0);
export type ScoringRaceResult = { position: string; Driver: { driverId: string }; FastestLap?: { rank?: string } };
export type ScoringQualifyingResult = { position: string; Driver: { driverId: string } };
export interface ScoredQuestion { id: PredictQId; label: string; points: number; pick: string | null; actual: string | null; correct: boolean; awarded: number }
export interface PredictionScore { total: number; questions: ScoredQuestion[] }

/** Missing or inconsistent official classifications remain pending, never zero-graded. */
export function scorePicks(picks: PredictionPicks, results: ScoringRaceResult[], qualifying: ScoringQualifyingResult[]): PredictionScore | null {
  const top = [1, 2, 3].map((position) => results.filter((r) => r.position === String(position)));
  const pole = qualifying.filter((q) => q.position === '1');
  const fastest = results.filter((r) => r.FastestLap?.rank === '1');
  if (top.some((r) => r.length !== 1) || pole.length !== 1 || fastest.length !== 1) return null;
  const podium = top.map((rows) => rows[0]!.Driver.driverId);
  const driverIds = results.map((r) => r.Driver.driverId);
  const qualifyingIds = qualifying.map((q) => q.Driver.driverId);
  if (new Set(driverIds).size !== driverIds.length || new Set(qualifyingIds).size !== qualifyingIds.length || new Set(podium).size !== 3) return null;
  const poleId = pole[0]!.Driver.driverId;
  const fastestId = fastest[0]!.Driver.driverId;
  if (!poleId || !fastestId || podium.some((id) => !id)) return null;
  const actual: Record<PredictQId, string> = { pole: poleId, winner: podium[0]!, podium: podium[2]!, fastest_lap: fastestId };
  const questions = PREDICT_QUESTIONS.map((q): ScoredQuestion => {
    const pick = picks[q.id] ?? null;
    const correct = Boolean(pick && (q.id === 'podium' ? podium.includes(pick) : pick === actual[q.id]));
    return { ...q, pick, actual: actual[q.id], correct, awarded: correct ? q.points : 0 };
  });
  return { total: questions.reduce((n, q) => n + q.awarded, 0), questions };
}
