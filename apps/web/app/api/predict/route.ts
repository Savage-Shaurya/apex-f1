import { NextRequest, NextResponse } from 'next/server';
import type { UiRace } from '@apex/api-client/jolpica';
import { readPredictionRaceContext } from '@/lib/prediction-race-context';
import {
  predictionCookieSecret, readPredictionIdentity, PREDICTION_COOKIE,
  getPrediction, getPredictionAttemptReceipt, predictionAttemptPayloadHash, savePredictionAttempt,
  type PredictionAttemptReceipt,
} from '@apex/db';
import { PREDICT_QUESTIONS } from '@/lib/predict';
import { tooMany } from '@/lib/rate-limit';
import { rateLimitShared, rateLimitUnavailable } from '@/lib/distributed-rate-limit';
import { isSameOriginMutationRequest, validateJsonMutationRequest } from '@/lib/mutation-guard';
import { readJsonObject, errorResponse } from '@/lib/api-input';

export const runtime = 'nodejs';
const VALID_IDS = new Set<string>(PREDICT_QUESTIONS.map((q) => q.id));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BODY_KEYS = new Set(['season', 'round', 'raceSlug', 'picks', 'handle', 'expectedRevision']);

function privateResponse(response: Response): Response {
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('vary', 'Cookie');
  return response;
}
const fail = (error: string, status: number, kind?: string) => privateResponse(NextResponse.json({ ok: false, error, ...(kind ? { kind } : {}) }, { status }));
function validRace(season: unknown, round: unknown): boolean {
  return typeof season === 'number' && Number.isInteger(season) && season >= 1950 && season <= new Date().getUTCFullYear() + 1
    && typeof round === 'number' && Number.isInteger(round) && round >= 1 && round <= 30;
}
function configuredSecret(): string | null {
  if (!process.env.DATABASE_URL) return null;
  try { return predictionCookieSecret(); } catch { return null; }
}
function requestIdentity(req: Request, secret: string): string | Response {
  const jar = new NextRequest(req.url, { headers: req.headers }).cookies;
  const identity = readPredictionIdentity(jar.get(PREDICTION_COOKIE)?.value, secret);
  if (!identity) return fail('Confirm your prediction session before saving.', 428, 'identity_required');
  if (req.headers.get('x-apex-prediction-identity') !== identity) {
    return fail('Your prediction session changed. Reload before saving again.', 412, 'identity_mismatch');
  }
  return identity;
}
function receiptResponse(receipt: PredictionAttemptReceipt): Response {
  if (receipt.outcome === 'locked') return fail('Picks are locked or have already been scored.', 409, 'race_locked');
  if (receipt.outcome === 'conflict') return fail('These picks changed in another tab. Reload before saving again.', 409, 'attempt_conflict');
  return privateResponse(NextResponse.json({ ok: true, replayed: true, current: receipt.current, revision: receipt.revision }));
}

/** Cookie-authorized readback never provisions an identity or changes a prediction. */
export async function GET(req: Request): Promise<Response> {
  if (!isSameOriginMutationRequest(req)) return fail('Cross-origin prediction readback is not allowed.', 403);
  const secret = configuredSecret();
  if (!secret) return fail('Predictions are temporarily unavailable.', 503);
  const identity = requestIdentity(req, secret);
  if (typeof identity !== 'string') return identity;
  const quota = await rateLimitShared(req, { limit: 120, windowMs: 60_000, bucket: 'predict-read', readFallback: true });
  if (!quota.available) return privateResponse(rateLimitUnavailable(quota));
  if (!quota.ok) return privateResponse(tooMany(quota));
  const params = new URL(req.url).searchParams;
  if ([...params.keys()].some((key) => !['season', 'round', 'attemptId'].includes(key))
    || params.getAll('season').length !== 1 || params.getAll('round').length !== 1 || params.getAll('attemptId').length > 1) return fail('Invalid prediction readback.', 400);
  const seasonValue = params.get('season')!;
  const roundValue = params.get('round')!;
  const season = Number(seasonValue), round = Number(roundValue);
  const attemptId = params.get('attemptId');
  if (!/^\d{4}$/.test(seasonValue) || !/^\d{1,2}$/.test(roundValue) || !validRace(season, round)
    || (attemptId !== null && !UUID.test(attemptId))) return fail('Invalid prediction readback.', 400);
  try {
    const [prediction, receipt] = await Promise.all([
      getPrediction(identity, season, round),
      attemptId ? getPredictionAttemptReceipt({ clientId: identity, season, round, attemptId }) : Promise.resolve(null),
    ]);
    return privateResponse(NextResponse.json({ ok: true, identity, prediction, receipt }));
  } catch { return fail('Your saved picks could not be read. Try again shortly.', 503); }
}

export async function POST(req: Request): Promise<Response> {
  const guard = validateJsonMutationRequest(req);
  if (guard) return privateResponse(guard);
  const quota = await rateLimitShared(req, { limit: 20, windowMs: 60_000, bucket: 'predict' });
  if (!quota.available) return privateResponse(rateLimitUnavailable(quota));
  if (!quota.ok) return privateResponse(tooMany(quota));
  const secret = configuredSecret();
  if (!secret) return fail('Predictions are temporarily unavailable.', 503);
  let body: Record<string, unknown>;
  try { body = await readJsonObject(req, 8_192); } catch (error) { return privateResponse(errorResponse(error)); }

  const { season, round, raceSlug, picks, handle, expectedRevision } = body;
  if (Object.keys(body).some((key) => !BODY_KEYS.has(key)) || !validRace(season, round)
    || typeof raceSlug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(raceSlug)
    || !picks || typeof picks !== 'object' || Array.isArray(picks)
    || (handle !== undefined && typeof handle !== 'string')
    || (expectedRevision !== null && (typeof expectedRevision !== 'string' || expectedRevision.length > 128 || !Number.isFinite(Date.parse(expectedRevision))))) return fail('Invalid payload.', 400);
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(picks)) {
    if (!VALID_IDS.has(key) || typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) {
      if (VALID_IDS.has(key) && value === '') continue;
      return fail('Invalid prediction choices.', 400);
    }
    clean[key] = value;
  }
  if (!Object.keys(clean).length) return fail('Choose at least one driver.', 400);
  const identity = requestIdentity(req, secret);
  if (typeof identity !== 'string') return identity;
  // Per-identity brake on top of the per-IP one: fresh attempt ids cannot turn
  // one session into an unbounded stream of race verifications.
  const identityQuota = await rateLimitShared(req, { limit: 30, windowMs: 3_600_000, bucket: 'predict-identity', subject: identity });
  if (!identityQuota.available) return privateResponse(rateLimitUnavailable(identityQuota));
  if (!identityQuota.ok) return privateResponse(tooMany(identityQuota));
  const attemptId = req.headers.get('x-apex-prediction-attempt');
  if (!attemptId || !UUID.test(attemptId)) return fail('A valid prediction save attempt is required.', 400, 'attempt_required');
  const captured = {
    clientId: identity, season: season as number, round: round as number, raceSlug, picks: clean,
    // No public names: the leaderboard is anonymous (privacy and terms say so), so a sent handle is never stored.
    handle: null,
    attemptId, expectedRevision: expectedRevision as string | null,
  };

  // A confirmed previous write remains confirmable if qualifying passed or a provider is down.
  try {
    const receipt = await getPredictionAttemptReceipt(captured);
    if (receipt) {
      if (receipt.payloadHash !== predictionAttemptPayloadHash(captured)) return fail('This save attempt was already used for different picks or a different revision.', 409, 'attempt_conflict');
      return receiptResponse(receipt);
    }
  } catch { return fail('Your save could not be confirmed. Try again shortly.', 503); }

  let canonical: UiRace | undefined;
  let eligible: Set<string>;
  try {
    // Shared cached reads (BE-2): saves never spend fresh Jolpica requests.
    const context = await readPredictionRaceContext(captured.season, captured.round);
    canonical = context.race ?? undefined;
    eligible = context.eligibleDriverIds;
    if (!eligible.size) return fail('Driver choices are temporarily unavailable.', 503);
  } catch { return fail('Race verification is temporarily unavailable. Try again shortly.', 503); }
  if (!canonical || canonical.season !== captured.season || canonical.slug !== raceSlug) return fail('The race does not match the official calendar.', 400);
  const qualifying = canonical.sessions.find((session) => session.kind === 'Q');
  const lockAt = qualifying && /T\d{2}:\d{2}/.test(qualifying.iso) ? new Date(qualifying.iso) : null;
  if (!lockAt || !Number.isFinite(lockAt.getTime())) return fail('The qualifying deadline is not available yet.', 503);
  if (Object.values(clean).some((driverId) => !eligible.has(driverId))) return fail('Choose a driver from this season’s official entry list.', 400);

  try {
    // The transaction checks exact view revision and the database clock, then stores its receipt atomically.
    const saved = await savePredictionAttempt({ ...captured, raceSlug: canonical.slug, lockAt });
    if (saved.kind === 'locked') return fail('Picks are locked or have already been scored.', 409, 'race_locked');
    if (saved.kind === 'conflict') return fail('These picks or this save attempt changed. Reload before saving again.', 409, 'attempt_conflict');
    return privateResponse(NextResponse.json({ ok: true, replayed: saved.kind === 'replayed', current: saved.current, revision: saved.revision }));
  } catch (error) {
    // The database deliberately leaves no receipt/write when canonical Q is
    // missing or withdrawn. Report that precise availability failure safely.
    if (error instanceof Error && error.message === 'Canonical prediction deadline is unavailable.') {
      return fail('The qualifying deadline is temporarily unavailable. Try again shortly.', 503);
    }
    return fail('Your picks could not be confirmed. Try again shortly.', 500);
  }
}
