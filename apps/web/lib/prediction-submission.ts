import {
  browserIdentityLock,
  browserPredictionAttemptStore,
  samePredictionInput,
  samePredictionRace,
  snapshotPredictionInput,
  validPredictionIdentity,
  type PredictionAttempt,
  type PredictionAttemptInput,
  type PredictionAttemptStore,
  type PredictionIdentityLock,
} from './prediction-session';

export const PREDICTION_SUBMISSION_DEADLINE_MS = 20_000;
export type PredictionSubmissionInput = PredictionAttemptInput;

export type PredictionSubmission =
  | { kind: 'accepted'; revision: string }
  | { kind: 'rejected'; status: number; message?: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'superseded'; message: string }
  | { kind: 'uncertain'; reason: 'timeout' | 'network' | 'invalid-response' }
  | { kind: 'cancelled' };

interface Options {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  identityLock?: PredictionIdentityLock;
  attemptStore?: PredictionAttemptStore;
  newAttemptId?: () => string;
}

type JsonRecord = Record<string, unknown>;
const unavailable = (message = 'Your prediction session could not be confirmed. No save request was sent. Your choices are still here.'): PredictionSubmission => ({ kind: 'unavailable', message });
function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}
function revision(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && Number.isFinite(Date.parse(value));
}

/** Lost write confirmations retain the signed identity, replay key, revision and exact payload. */
export async function submitPrediction(input: PredictionSubmissionInput, options: Options = {}): Promise<PredictionSubmission> {
  const { signal, fetchImpl = fetch, newAttemptId = () => crypto.randomUUID() } = options;
  if (signal?.aborted) return { kind: 'cancelled' };
  const snapshot = snapshotPredictionInput(input);
  const controller = new AbortController();
  let timedOut = false;
  let uploaded = false;
  let completeAbort: (result: PredictionSubmission) => void = () => {};
  const aborted = new Promise<PredictionSubmission>((resolve) => { completeAbort = resolve; });
  let stopOperation: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => { stopOperation = reject; });
  // An ignored fetch abort must still release a held cross-tab bootstrap lock.
  void stopped.catch(() => {});
  const onAbort = () => {
    stopOperation(new Error('Prediction operation cancelled.'));
    completeAbort(timedOut
      ? uploaded ? { kind: 'uncertain', reason: 'timeout' } : unavailable('Prediction setup took too long. No save request was sent. Your choices are still here.')
      : { kind: 'cancelled' });
  };
  const cancel = () => controller.abort();
  controller.signal.addEventListener('abort', onAbort, { once: true });
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, PREDICTION_SUBMISSION_DEADLINE_MS);

  const transport = async (url: string, init: RequestInit = {}): Promise<{ response: Response; payload: JsonRecord | null }> => {
    if (controller.signal.aborted) throw new Error('Prediction operation cancelled.');
    const response = await Promise.race([fetchImpl(url, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...init, signal: controller.signal }), stopped]);
    const payload = record(await Promise.race([response.json(), stopped]));
    if (controller.signal.aborted) throw new Error('Prediction operation cancelled.');
    return { response, payload };
  };

  const request = async (): Promise<PredictionSubmission> => {
    let store: PredictionAttemptStore;
    let attempts: PredictionAttempt[];
    try {
      store = options.attemptStore ?? browserPredictionAttemptStore();
      attempts = store.read();
      // Even the first attempt must have durable storage available before uploading.
      store.write(attempts);
    } catch { return unavailable('Your browser could not retain a safe save attempt. Enable session storage before saving. Your choices are still here.'); }

    const pending = attempts.filter((attempt) => samePredictionRace(attempt.input, snapshot));
    const identityLock = options.identityLock ?? browserIdentityLock();
    const setup = async (): Promise<string | PredictionSubmission> => {
      const first = await transport('/api/predict/identity');
      if (first.response.ok && first.payload?.ok === true && validPredictionIdentity(first.payload.identity)) {
        if (pending.some((attempt) => attempt.identity !== first.payload!.identity)) {
          return unavailable('Your saved prediction session changed. No new save was sent. Restore the original session before retrying an uncertain save.');
        }
        return first.payload.identity;
      }
      if (first.response.status !== 428) return unavailable();
      if (pending.length) return unavailable('Your earlier prediction session is missing. No new save was sent. Restore its cookie before retrying.');
      if (!identityLock) return unavailable('This browser cannot safely coordinate a new prediction session across tabs. Use a browser with Web Locks support. No save request was sent.');
      const created = await transport('/api/predict/identity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!created.response.ok || created.payload?.ok !== true || !validPredictionIdentity(created.payload.identity)) return unavailable();
      // Set-Cookie in a response is not proof the browser accepted it.
      const confirmed = await transport('/api/predict/identity');
      return confirmed.response.ok && confirmed.payload?.ok === true && confirmed.payload.identity === created.payload.identity
        ? created.payload.identity : unavailable('Your browser did not confirm the prediction cookie. No save request was sent. Enable cookies before saving.');
    };

    try {
      const ready = identityLock ? await identityLock(controller.signal, setup) : await setup();
      if (typeof ready !== 'string') return ready;
      if (controller.signal.aborted) return { kind: 'cancelled' };
      // A reload can expose the committed revision of an uncertain write. Reuse
      // its captured revision when the requested choices are still identical.
      let attempt = pending.find((saved) => samePredictionInput(saved.input, { ...snapshot, expectedRevision: saved.input.expectedRevision }));
      const replaying = Boolean(attempt);
      // A changed payload cannot replace an unresolved write until its precise receipt is known.
      if (!attempt && pending.length) {
        for (const previous of pending) {
          const params = new URLSearchParams({ season: String(snapshot.season), round: String(snapshot.round), attemptId: previous.id });
          const checked = await transport('/api/predict?' + params, { headers: { 'X-Apex-Prediction-Identity': ready } });
          const receipt = record(checked.payload?.receipt);
          const previousHash = await predictionPayloadHash(previous.input);
          if (controller.signal.aborted) return { kind: 'cancelled' };
          if (!checked.response.ok || checked.payload?.ok !== true || checked.payload.identity !== ready || !receipt
            || receipt.payloadHash !== previousHash || !['applied', 'locked', 'conflict'].includes(String(receipt.outcome))) {
            return unavailable('An earlier save still needs confirmation. No changed picks were sent. Retry the original choices or reload to check them first.');
          }
          attempts = attempts.filter((saved) => saved.id !== previous.id);
        }
        store.write(attempts);
      }
      if (!attempt) {
        const id = newAttemptId();
        if (!validPredictionIdentity(id)) return unavailable();
        attempt = { id, identity: ready, input: snapshot };
        attempts = [...attempts, attempt];
        try { store.write(attempts); }
        catch { return unavailable('Your browser could not retain this save attempt. No save request was sent. Your choices are still here.'); }
      }
      const savedAttempt = attempt;
      if (controller.signal.aborted) return { kind: 'cancelled' };
      uploaded = true;
      const response = await fetchImpl('/api/predict', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Apex-Prediction-Identity': savedAttempt.identity, 'X-Apex-Prediction-Attempt': savedAttempt.id },
        body: JSON.stringify(savedAttempt.input), signal: controller.signal,
      });
      let payload: JsonRecord | null;
      try { payload = record(await response.json()); }
      catch { return response.ok ? { kind: 'uncertain', reason: 'invalid-response' } : { kind: 'rejected', status: response.status === 409 ? 412 : response.status }; }
      if (controller.signal.aborted) return timedOut ? { kind: 'uncertain', reason: 'timeout' } : { kind: 'cancelled' };
      const clearAttempt = () => {
        // Re-read before cleanup so another same-tab call cannot lose its pending replay key.
        try { store.write(store.read().filter((saved) => saved.id !== savedAttempt.id)); } catch { /* A retained receipt makes a later replay safe. */ }
      };
      if (!response.ok) {
        // A quota/identity rejection of a retry cannot disprove its earlier
        // uncertain commit. Only a recorded outcome can settle that attempt.
        if (response.status < 500 && (!replaying || payload?.kind === 'race_locked' || payload?.kind === 'attempt_conflict')) clearAttempt();
        const message = typeof payload?.error === 'string' ? payload.error.trim().slice(0, 300) : undefined;
        // The form's existing 409 state means race locked; revision/request conflicts are distinct.
        const status = response.status === 409 && payload?.kind !== 'race_locked' ? 412 : response.status;
        return { kind: 'rejected', status, ...(message ? { message } : {}) };
      }
      if (payload?.ok !== true || typeof payload.current !== 'boolean' || typeof payload.replayed !== 'boolean'
        || (payload.current ? !revision(payload.revision) : payload.revision !== null && !revision(payload.revision))) {
        return { kind: 'uncertain', reason: 'invalid-response' };
      }
      clearAttempt();
      return payload.current
        ? { kind: 'accepted', revision: payload.revision as string }
        : { kind: 'superseded', message: 'Your earlier save was confirmed. The current picks have since changed. Reload to review the current choices before saving again.' };
    } catch {
      return controller.signal.aborted
        ? timedOut ? uploaded ? { kind: 'uncertain', reason: 'timeout' } : unavailable() : { kind: 'cancelled' }
        : uploaded ? { kind: 'uncertain', reason: 'network' } : unavailable();
    }
  };

  try { return await Promise.race([request(), aborted]); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

/** Same normalization as the database receipt; it is a content checksum, not authentication. */
export async function predictionPayloadHash(input: PredictionSubmissionInput): Promise<string> {
  const payload = { handle: null, season: input.season, round: input.round, raceSlug: input.raceSlug,
    picks: snapshotPredictionInput(input).picks, expectedRevision: input.expectedRevision };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function predictionFailureFeedback(result: Exclude<PredictionSubmission, { kind: 'accepted' }>): string {
  if (result.kind === 'cancelled') return '';
  if (result.kind === 'unavailable' || result.kind === 'superseded') return result.message;
  if (result.kind === 'uncertain' || result.status >= 500) {
    const cause = result.kind === 'uncertain' && result.reason === 'timeout'
      ? 'The save confirmation took too long.' : 'We could not confirm the save.';
    return cause + ' Your picks may have been saved. Your choices are still here. Reload this page to check saved picks before trying again.';
  }
  return result.message ?? (result.status === 409 ? 'Picks are locked for this race.'
    : result.status === 429 ? 'Too many attempts. Wait a little before trying again.'
      : result.status === 412 ? 'These picks changed in another tab. Reload to review the current choices.'
        : 'The save request was rejected. Check your choices before trying again.');
}
