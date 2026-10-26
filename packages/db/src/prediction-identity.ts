import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PREDICTION_COOKIE = 'apex_pid';

export function predictionCookieSecret(): string {
  const secret = process.env.PREDICTION_COOKIE_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('Prediction identity is not configured.');
  return secret;
}
function signature(id: string, secret: string): string {
  return createHmac('sha256', secret).update(`apex-prediction:v1:${id}`).digest('base64url');
}
/** Unsigned legacy cookies are never accepted as proof of identity. */
export function readPredictionIdentity(token: string | undefined, secret: string): string | null {
  if (!token || token.length > 128) return null;
  const [version, id, mac, extra] = token.split('.');
  if (version !== 'v1' || !id || !ID.test(id) || !mac || extra !== undefined) return null;
  const expected = Buffer.from(signature(id, secret));
  const actual = Buffer.from(mac);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null;
}
export function createPredictionIdentity(secret: string, existingToken?: string): { id: string; token: string } {
  const id = readPredictionIdentity(existingToken, secret) ?? randomUUID();
  return { id, token: `v1.${id}.${signature(id, secret)}` };
}
