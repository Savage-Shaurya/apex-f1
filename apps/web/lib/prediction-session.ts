export const PREDICTION_IDENTITY_LOCK = 'apex-prediction-identity-v1';
export const PREDICTION_ATTEMPT_STORAGE = 'apex-prediction-attempts-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PredictionAttemptInput {
  season: number;
  round: number;
  raceSlug: string;
  picks: Record<string, string>;
  expectedRevision: string | null;
}

export interface PredictionAttempt {
  id: string;
  identity: string;
  input: PredictionAttemptInput;
}

export interface PredictionAttemptStore {
  read(): PredictionAttempt[];
  write(attempts: PredictionAttempt[]): void;
}

export type PredictionIdentityLock = <T>(signal: AbortSignal, task: () => Promise<T>) => Promise<T>;

export function browserIdentityLock(): PredictionIdentityLock | undefined {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.locks?.request) return undefined;
  return (signal, task) => navigator.locks.request(PREDICTION_IDENTITY_LOCK, { mode: 'exclusive', signal }, task);
}

export function snapshotPredictionInput(input: PredictionAttemptInput): PredictionAttemptInput {
  return { season: input.season, round: input.round, raceSlug: input.raceSlug, expectedRevision: input.expectedRevision,
    picks: Object.fromEntries(Object.entries(input.picks).filter(([, pick]) => pick !== '').sort(([a], [b]) => a.localeCompare(b))) };
}

export function samePredictionInput(a: PredictionAttemptInput, b: PredictionAttemptInput): boolean {
  return JSON.stringify(snapshotPredictionInput(a)) === JSON.stringify(snapshotPredictionInput(b));
}

export function samePredictionRace(a: PredictionAttemptInput, b: PredictionAttemptInput): boolean {
  return a.season === b.season && a.round === b.round && a.raceSlug === b.raceSlug;
}

export function validPredictionIdentity(identity: unknown): identity is string {
  return typeof identity === 'string' && UUID.test(identity);
}

function validateAttempts(value: unknown): PredictionAttempt[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('Invalid prediction attempt storage.');
  for (const attempt of value) {
    if (!attempt || typeof attempt !== 'object' || !validPredictionIdentity(attempt.id) || !validPredictionIdentity(attempt.identity)
      || !attempt.input || typeof attempt.input !== 'object' || !Number.isInteger(attempt.input.season)
      || !Number.isInteger(attempt.input.round) || typeof attempt.input.raceSlug !== 'string'
      || (attempt.input.expectedRevision !== null && typeof attempt.input.expectedRevision !== 'string')
      || !attempt.input.picks || typeof attempt.input.picks !== 'object' || Array.isArray(attempt.input.picks)
      || Object.entries(attempt.input.picks).some(([key, pick]) => key.length > 64 || typeof pick !== 'string' || pick.length > 64)) {
      throw new Error('Invalid prediction attempt storage.');
    }
  }
  return value as PredictionAttempt[];
}

/** IDs and captured picks survive a reload; signed HttpOnly tokens never enter storage. */
export function browserPredictionAttemptStore(): PredictionAttemptStore {
  if (typeof window === 'undefined') throw new Error('Prediction attempt storage is unavailable.');
  const storage = window.sessionStorage;
  return {
    read() {
      const raw = storage.getItem(PREDICTION_ATTEMPT_STORAGE);
      if (raw === null) return [];
      if (raw.length > 50_000) throw new Error('Prediction attempt storage is too large.');
      return validateAttempts(JSON.parse(raw));
    },
    write(attempts) {
      validateAttempts(attempts);
      const raw = JSON.stringify(attempts);
      if (raw.length > 50_000) throw new Error('Prediction attempt storage is too large.');
      // Verify persistence before uploading: privacy/storage failures cannot lose the replay key.
      storage.setItem(PREDICTION_ATTEMPT_STORAGE, raw);
      if (storage.getItem(PREDICTION_ATTEMPT_STORAGE) !== raw) throw new Error('Prediction attempt storage was not retained.');
    },
  };
}
