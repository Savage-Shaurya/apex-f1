import { authenticateAdminPassword, authorizeAdminRequest } from './admin-auth';
import { adminSessionConfiguration, adminSessionOriginAllowed, adminSessionSetCookie, consumeAdminAccountLoginQuota, createAdminSession, matchingAdminTotpCounter, revokeAdminSession } from './admin-session';
import { InputError, readJsonObject } from './api-input';
import { rateLimitShared } from './distributed-rate-limit';
import { clientIp } from './rate-limit';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie', ...headers } });
}
function unavailable(): Response { return json({ ok: false, error: 'Administrator authentication is temporarily unavailable.' }, 503, { 'Retry-After': '30' }); }
function originGuard(req: Request): Response | null {
  if (!adminSessionOriginAllowed(req)) return json({ ok: false, error: 'Same-origin request required.' }, 403);
  if (req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return json({ ok: false, error: 'Content-Type must be application/json.' }, 415);
  return null;
}
export async function loginAdmin(req: Request): Promise<Response> {
  const guard = originGuard(req); if (guard) return guard;
  try {
    const quota = await rateLimitShared(req, { limit: 20, windowMs: 300_000, bucket: 'admin-login-network' });
    if (!quota.available) return unavailable();
    if (!quota.ok) return json({ ok: false, error: 'Too many login attempts.' }, 429, { 'Retry-After': String(quota.retryAfter) });
    const config = adminSessionConfiguration();
    const body = await readJsonObject(req, 2_048);
    if (Object.keys(body).length !== 3 || Object.keys(body).some(key => !['username', 'password', 'otp'].includes(key)) || typeof body.username !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(body.username) || typeof body.password !== 'string' || !body.password || Buffer.byteLength(body.password) > 512 || typeof body.otp !== 'string' || !/^\d{6}$/.test(body.otp)) throw new InputError('Invalid login request.');
    const accountQuota = await consumeAdminAccountLoginQuota(config, body.username, clientIp(req), req.signal);
    if (!accountQuota.ok) return json({ ok: false, error: 'Too many login attempts.' }, 429, { 'Retry-After': String(accountQuota.retryAfter) });
    const authenticated = await authenticateAdminPassword(body.username, body.password);
    const actor = config.actors.find(item => item.username === body.username);
    // Do not consume second-factor state until the password is valid.
    const counter = authenticated && actor ? matchingAdminTotpCounter(actor.totpSecret, body.otp) : null;
    const session = counter !== null && actor ? await createAdminSession(config, actor, counter, req.signal) : null;
    if (!session) return json({ ok: false, error: 'Credentials or verification code could not be accepted.' }, 401);
    return json({ ok: true, expiresAt: session.expiresAt }, 200, { 'Set-Cookie': adminSessionSetCookie(session.token) });
  } catch (error) {
    if (error instanceof InputError) return json({ ok: false, error: error.message }, error.status);
    return unavailable();
  }
}
export async function logoutAdmin(req: Request): Promise<Response> {
  const guard = originGuard(req); if (guard) return guard;
  try {
    const quota = await rateLimitShared(req, { limit: 30, windowMs: 60_000, bucket: 'admin-logout-network' });
    if (!quota.available) return unavailable();
    if (!quota.ok) return json({ ok: false, error: 'Too many logout attempts.' }, 429, { 'Retry-After': String(quota.retryAfter) });
    const body = await readJsonObject(req, 64);
    if (Object.keys(body).length) throw new InputError('Invalid logout request.');
    await revokeAdminSession(req);
    return json({ ok: true }, 200, { 'Set-Cookie': adminSessionSetCookie('', true) });
  } catch (error) {
    if (error instanceof InputError) return json({ ok: false, error: error.message }, error.status);
    // Keep the cookie on uncertain revocation, so the operator can retry logout.
    return unavailable();
  }
}
export async function inspectAdminSession(req: Request): Promise<Response> {
  const gate = await authorizeAdminRequest(req);
  if (gate.response) return gate.response;
  return json({ ok: true, username: gate.principal.username, capabilities: [...gate.principal.capabilities] });
}
