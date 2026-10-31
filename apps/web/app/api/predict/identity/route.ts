import { NextRequest, NextResponse } from 'next/server';
import {
  createPredictionIdentity,
  predictionCookieSecret,
  readPredictionIdentity,
  PREDICTION_COOKIE,
} from '@apex/db';
import { isSameOriginMutationRequest, validateJsonMutationRequest } from '@/lib/mutation-guard';
import { readJsonObject, errorResponse } from '@/lib/api-input';
import { rateLimitShared, rateLimitUnavailable } from '@/lib/distributed-rate-limit';
import { tooMany } from '@/lib/rate-limit';

export const runtime = 'nodejs';

function privateResponse(response: Response): Response {
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('vary', 'Cookie');
  return response;
}

function fail(error: string, status: number): Response {
  return privateResponse(NextResponse.json({ ok: false, error }, { status }));
}

function configuredSecret(): string | null {
  if (!process.env.DATABASE_URL) return null;
  try { return predictionCookieSecret(); } catch { return null; }
}

/** Confirmation is read-only: a missing cookie can never create a participant. */
export async function GET(req: NextRequest): Promise<Response> {
  if (!isSameOriginMutationRequest(req)) return fail('Cross-origin identity confirmation is not allowed.', 403);
  const secret = configuredSecret();
  if (!secret) return fail('Predictions are temporarily unavailable.', 503);
  const quota = await rateLimitShared(req, { limit: 120, windowMs: 60_000, bucket: 'predict-identity-read', readFallback: true });
  if (!quota.available) return privateResponse(rateLimitUnavailable(quota));
  if (!quota.ok) return privateResponse(tooMany(quota));
  const identity = readPredictionIdentity(req.cookies.get(PREDICTION_COOKIE)?.value, secret);
  if (!identity) return fail('Confirm your prediction session before saving.', 428);
  return privateResponse(NextResponse.json({ ok: true, identity }));
}

/** Provisioning only sets an HttpOnly signed cookie. No prediction is written. */
export async function POST(req: NextRequest): Promise<Response> {
  const guard = validateJsonMutationRequest(req);
  if (guard) return privateResponse(guard);
  const secret = configuredSecret();
  if (!secret) return fail('Predictions are temporarily unavailable.', 503);
  const quota = await rateLimitShared(req, { limit: 20, windowMs: 60_000, bucket: 'predict-identity-create' });
  if (!quota.available) return privateResponse(rateLimitUnavailable(quota));
  if (!quota.ok) return privateResponse(tooMany(quota));
  try {
    const body = await readJsonObject(req, 1_024);
    // The server exclusively chooses new IDs; callers cannot ask us to sign a victim's ID.
    if (Object.keys(body).length) return fail('Identity setup accepts an empty JSON object.', 400);
  } catch (error) { return privateResponse(errorResponse(error)); }

  const identity = createPredictionIdentity(secret, req.cookies.get(PREDICTION_COOKIE)?.value);
  const response = NextResponse.json({ ok: true, identity: identity.id });
  response.cookies.set(PREDICTION_COOKIE, identity.token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV !== 'development',
    maxAge: 60 * 60 * 24 * 365, path: '/',
  });
  return privateResponse(response);
}
