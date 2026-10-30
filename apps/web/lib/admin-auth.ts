/** Administrative authentication is checked at both Proxy and every privileged handler. */
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { getRequestTargetOrigin } from './mutation-guard';
import { rateLimitShared, rateLimitUnavailable } from './distributed-rate-limit';
import { tooMany } from './rate-limit';
import { adminSessionConfiguration, adminSessionCookie, adminSessionOriginAllowed, basicAdminAuthenticationAllowed, readAdminSession } from './admin-session';

/** Existing owner/development credentials do not silently gain newly added powers. */
export const LEGACY_ADMIN_CAPABILITIES = ['read', 'write', 'publish', 'image'] as const;
export const ADMIN_CAPABILITIES = [...LEGACY_ADMIN_CAPABILITIES, 'newsletter-reconcile'] as const;
export type AdminCapability = typeof ADMIN_CAPABILITIES[number];
export interface AdminPrincipal {
  username: string;
  capabilities: readonly AdminCapability[];
  legacy: boolean;
}
interface ConfiguredAdmin extends AdminPrincipal { passwordHash: string; }
const USERNAME = /^[a-z][a-z0-9._-]{0,63}$/;
const HASH = /^scrypt\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
const SCRYPT = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const cacheKey = randomBytes(32);
const verified = new Map<string, { principal: AdminPrincipal; expires: number }>();
let cachedConfiguration = '';
let verifying = 0;

/** Fixed-length digest comparison avoids revealing individual credential prefixes. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export function hasAdminCapability(principal: AdminPrincipal, capability: AdminCapability): boolean {
  return principal.capabilities.includes(capability);
}

export function adminAuthenticationConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD || process.env.ADMIN_USERS_JSON);
}

/** Invalid named-principal configuration fails the whole gate closed, including legacy credentials. */
export function configuredAdminUsers(environment: Record<string, string | undefined> = process.env): ConfiguredAdmin[] {
  const raw = environment.ADMIN_USERS_JSON;
  if (!raw) return [];
  if (Buffer.byteLength(raw) > 65_536) throw new Error('Invalid administrator configuration');
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length < 1 || data.length > 32) throw new Error('Invalid administrator configuration');
  const names = new Set<string>();
  return data.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid administrator configuration');
    const value = entry as Record<string, unknown>;
    if (Object.keys(value).some(key => !['username', 'passwordHash', 'capabilities'].includes(key)) ||
      typeof value.username !== 'string' || !USERNAME.test(value.username) || names.has(value.username) ||
      (value.username === 'apex' && Boolean(environment.ADMIN_PASSWORD)) ||
      typeof value.passwordHash !== 'string' || !HASH.test(value.passwordHash) ||
      !Array.isArray(value.capabilities) || !value.capabilities.length || value.capabilities.length > ADMIN_CAPABILITIES.length ||
      value.capabilities.some(capability => !ADMIN_CAPABILITIES.includes(capability)) ||
      new Set(value.capabilities).size !== value.capabilities.length) throw new Error('Invalid administrator configuration');
    names.add(value.username);
    return { username: value.username, passwordHash: value.passwordHash, capabilities: [...value.capabilities] as AdminCapability[], legacy: false };
  });
}

function credentials(req: Request): { authorization: string; username: string; password: string } | null {
  const authorization = req.headers.get('authorization');
  if (!authorization || authorization.length > 2_048 || !/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization)) return null;
  try {
    const raw = Buffer.from(authorization.slice(6), 'base64');
    if (raw.toString('base64') !== authorization.slice(6)) return null;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    const colon = text.indexOf(':');
    if (colon < 1) return null;
    const username = text.slice(0, colon), password = text.slice(colon + 1);
    if (!USERNAME.test(username) || !password || Buffer.byteLength(password) > 512) return null;
    return { authorization, username, password };
  } catch { return null; }
}

/** Legacy compatibility only. Request handlers must use the asynchronous gated helper. */
export function isAuthorizedAdminRequest(req: Request): boolean {
  if (!basicAdminAuthenticationAllowed()) return false;
  try { configuredAdminUsers(); } catch { return false; }
  const parsed = credentials(req);
  return Boolean(process.env.ADMIN_PASSWORD && parsed?.username === 'apex' && safeEqual(parsed.password, process.env.ADMIN_PASSWORD));
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, SCRYPT, (error, key) => error ? reject(error) : resolve(key)));
}

/** Operator/test provisioning; generated hashes contain no reusable plaintext password. */
export async function hashAdminPassword(password: string): Promise<string> {
  const bytes = Buffer.byteLength(password);
  if (bytes < 16 || bytes > 512) throw new Error('Administrator passwords must contain 16 to 512 UTF-8 bytes');
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${(await derive(password, salt)).toString('base64url')}`;
}

async function principal(req: Request): Promise<AdminPrincipal | null> {
  const users = configuredAdminUsers();
  const configuration = createHash('sha256').update(process.env.ADMIN_USERS_JSON ?? '').update('\0').update(process.env.ADMIN_PASSWORD ?? '').digest('hex');
  if (configuration !== cachedConfiguration) { verified.clear(); cachedConfiguration = configuration; }
  const parsed = credentials(req);
  if (!parsed) return null;
  const key = createHmac('sha256', cacheKey).update(configuration).update(parsed.authorization).digest('hex');
  const saved = verified.get(key);
  if (saved && saved.expires > Date.now()) return { ...saved.principal, capabilities: [...saved.principal.capabilities] };
  let found: AdminPrincipal | null = null;
  if (parsed.username === 'apex' && process.env.ADMIN_PASSWORD && safeEqual(parsed.password, process.env.ADMIN_PASSWORD)) {
    found = { username: 'apex', capabilities: [...LEGACY_ADMIN_CAPABILITIES], legacy: true };
  } else {
    const user = users.find(item => item.username === parsed.username);
    if (!user) return null;
    // Bound expensive verification independently of the distributed request quota.
    if (verifying >= 8) throw new Error('Administrator verification busy');
    verifying++;
    try {
      const [, salt, expected] = HASH.exec(user.passwordHash)!;
      if (timingSafeEqual(await derive(parsed.password, Buffer.from(salt!, 'base64url')), Buffer.from(expected!, 'base64url'))) {
        found = { username: user.username, capabilities: [...user.capabilities], legacy: false };
      }
    } finally { verifying--; }
  }
  if (found) {
    if (verified.size >= 256) verified.delete(verified.keys().next().value!);
    verified.set(key, { principal: { ...found, capabilities: [...found.capabilities] }, expires: Date.now() + 60_000 });
  }
  return found;
}

/** Session login checks passwords without ever granting access until the second factor is consumed. */
export async function authenticateAdminPassword(username: string, password: string): Promise<AdminPrincipal | null> {
  if (!USERNAME.test(username) || !password || Buffer.byteLength(password) > 512) return null;
  const users = configuredAdminUsers();
  const user = users.find(item => item.username === username);
  if (verifying >= 8) throw new Error('Administrator verification busy');
  verifying++;
  try {
    // Unknown usernames still incur the same bounded derivation; no password cache skips login work.
    const match = user ? HASH.exec(user.passwordHash)! : null;
    const salt = match ? Buffer.from(match[1]!, 'base64url') : Buffer.alloc(16);
    const expected = match ? Buffer.from(match[2]!, 'base64url') : Buffer.alloc(32);
    const valid = timingSafeEqual(await derive(password, salt), expected);
    return valid && user ? { username: user.username, capabilities: [...user.capabilities], legacy: false } : null;
  } finally { verifying--; }
}

/** Loopback convenience is opt-in; Host alone cannot prove a caller's network address. */
export function isLocalDev(req?: Request): boolean {
  if (process.env.NODE_ENV !== 'development' || process.env.VERCEL || process.env.VERCEL_ENV ||
      adminAuthenticationConfigured() || process.env.ADMIN_LOCAL_DEV_BYPASS !== 'true' || !req) return false;
  try {
    const origin = getRequestTargetOrigin(req);
    if (!origin) return false;
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch { return false; }
}

export function adminUnauthorized(): Response {
  return new Response('Authentication required', {
    status: 401,
    headers: { ...(basicAdminAuthenticationAllowed() ? { 'WWW-Authenticate': 'Basic realm="Apex Admin", charset="UTF-8"' } : {}), 'content-type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' },
  });
}

export type AdminAuthorization = { principal: AdminPrincipal; response: null } | { principal: null; response: Response };

function privateAdminResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Authorization, Cookie');
  return response;
}

function adminForbidden(): Response {
  return privateAdminResponse(Response.json({ ok: false, error: 'forbidden' }, { status: 403 }));
}

/** Quota is checked BEFORE credentials, so denied guesses cannot continue probing the secret. */
export async function authorizeAdminRequest(req: Request, capability?: AdminCapability, options: { boundary?: 'handler' | 'proxy'; hideWhenUnconfigured?: boolean } = {}): Promise<AdminAuthorization> {
  if (isLocalDev(req)) {
    const local: AdminPrincipal = { username: 'local-development', capabilities: [...LEGACY_ADMIN_CAPABILITIES], legacy: true };
    return capability && !hasAdminCapability(local, capability)
      ? { principal: null, response: adminForbidden() } : { principal: local, response: null };
  }
  if (!adminAuthenticationConfigured()) return { principal: null, response: options.hideWhenUnconfigured
    ? privateAdminResponse(new Response('Not Found', { status: 404 })) : adminUnauthorized() };
  const quota = await rateLimitShared(req, { limit: 120, windowMs: 60_000, bucket: `admin-auth-${options.boundary ?? 'handler'}`, failClosed: true });
  if (!quota.available) return { principal: null, response: privateAdminResponse(rateLimitUnavailable(quota)) };
  if (!quota.ok) return { principal: null, response: privateAdminResponse(tooMany(quota)) };
  try {
    const cookie = adminSessionCookie(req);
    let authenticated: AdminPrincipal | null;
    if (cookie.present) {
      authenticated = await readAdminSession(req);
      if (authenticated && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !adminSessionOriginAllowed(req)) return { principal: null, response: adminForbidden() };
    } else if (basicAdminAuthenticationAllowed()) {
      authenticated = await principal(req);
    } else {
      // A malformed or incomplete deployment never falls back to password-only authentication.
      adminSessionConfiguration();
      authenticated = null;
    }
    if (!authenticated) return { principal: null, response: adminUnauthorized() };
    if (capability && !hasAdminCapability(authenticated, capability)) return { principal: null, response: adminForbidden() };
    return { principal: authenticated, response: null };
  } catch {
    return { principal: null, response: privateAdminResponse(Response.json({ ok: false, error: 'Administrator authentication is temporarily unavailable.' }, { status: 503, headers: { 'Retry-After': '5' } })) };
  }
}
