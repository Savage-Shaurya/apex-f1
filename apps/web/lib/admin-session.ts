import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { configuredAdminUsers, type AdminPrincipal } from './admin-auth';
import { createUpstashRedisTransport, liveStoreConfig } from './live-shared-store';
import { getRequestTargetOrigin } from './mutation-guard';

const PREFIX = 'apex:admin:v1:{auth}';
export const ADMIN_SESSION_SECONDS = 1_800;
export const ADMIN_SESSION_IDLE_SECONDS = 900;
const USERNAME = /^[a-z][a-z0-9._-]{0,63}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
type Environment = Readonly<Record<string, string | undefined>>;
export interface AdminSessionActor extends AdminPrincipal { passwordHash: string; totpSecret: string; fingerprint: string; }
export interface AdminSessionConfiguration { secret: string; actors: AdminSessionActor[]; }

export function deployedAdminAuthentication(env: Environment = process.env): boolean {
  return env.NODE_ENV === 'production' || Boolean(env.VERCEL || env.VERCEL_ENV);
}
export function basicAdminAuthenticationAllowed(env: Environment = process.env): boolean {
  return ['development', 'test'].includes(env.NODE_ENV ?? '') && !deployedAdminAuthentication(env);
}
export function adminSessionCookieName(env: Environment = process.env): string {
  return deployedAdminAuthentication(env) ? '__Host-apex_admin' : 'apex_admin';
}

/** Every named actor needs an independently provisioned second factor; legacy owners cannot log in. */
/** `requireStore: false` checks the credential shape only (startup: Redis is optional, review R-01). */
export function adminSessionConfiguration(env: Environment = process.env, options: { requireStore?: boolean } = {}): AdminSessionConfiguration {
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]{43,86}$/.test(secret) || Buffer.from(secret, 'base64url').length < 32 || Buffer.from(secret, 'base64url').toString('base64url') !== secret) throw new Error('Administrator sessions are unavailable');
  const users = configuredAdminUsers(env);
  if (!users.length || env.ADMIN_PASSWORD) throw new Error('Administrator sessions are unavailable');
  const raw = env.ADMIN_MFA_SECRETS_JSON;
  if (!raw || Buffer.byteLength(raw) > 8_192) throw new Error('Administrator sessions are unavailable');
  const input: unknown = JSON.parse(raw);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Administrator sessions are unavailable');
  const factors = input as Record<string, unknown>;
  if (Object.keys(factors).length !== users.length || Object.keys(factors).some(name => !users.some(user => user.username === name))) throw new Error('Administrator sessions are unavailable');
  const secrets = new Set<string>();
  const actors = users.map(user => {
    const totpSecret = factors[user.username];
    if (typeof totpSecret !== 'string' || !/^[A-Z2-7]{32}$/.test(totpSecret) || secrets.has(totpSecret)) throw new Error('Administrator sessions are unavailable');
    secrets.add(totpSecret);
    const fingerprint = createHmac('sha256', secret).update(JSON.stringify([user.username, user.passwordHash, [...user.capabilities].sort(), totpSecret])).digest('hex');
    return { ...user, capabilities: [...user.capabilities], totpSecret, fingerprint };
  });
  if (options.requireStore !== false && !liveStoreConfig(env)) throw new Error('Administrator sessions are unavailable');
  return { secret, actors };
}

/** Strict cookie authentication never inherits the originless Basic/CLI exception. */
export function adminSessionOriginAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');
  const target = getRequestTargetOrigin(req);
  const site = req.headers.get('sec-fetch-site');
  if (!origin || !target || (site !== null && site !== 'same-origin')) return false;
  try { return new URL(origin).origin === origin && origin === target; } catch { return false; }
}

export function adminSessionCookie(req: Request): { present: boolean; token: string | null } {
  const raw = req.headers.get('cookie') ?? '';
  if (raw.length > 16_384) return { present: true, token: null };
  // Reject duplicate and mixed development/deployed cookies instead of choosing one.
  const values = raw.split(';').map(part => part.trim()).filter(part => /^(?:__Host-apex_admin|apex_admin)=/.test(part));
  if (!values.length) return { present: false, token: null };
  const name = adminSessionCookieName();
  if (values.length !== 1 || !values[0]!.startsWith(`${name}=`)) return { present: true, token: null };
  const token = values[0]!.slice(name.length + 1);
  return { present: true, token: TOKEN.test(token) && Buffer.from(token, 'base64url').toString('base64url') === token ? token : null };
}
export function adminSessionSetCookie(token: string, clear = false): string {
  if (!clear && !TOKEN.test(token)) throw new Error('Invalid administrator session');
  return `${adminSessionCookieName()}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : ADMIN_SESSION_SECONDS}${deployedAdminAuthentication() ? '; Secure' : ''}`;
}

function base32(secret: string): Buffer {
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('Invalid second factor');
  const bytes = Buffer.alloc(20);
  let accumulator = 0, bits = 0, index = 0;
  for (const character of secret) {
    accumulator = (accumulator << 5) | BASE32.indexOf(character); bits += 5;
    if (bits >= 8) { bits -= 8; bytes[index++] = (accumulator >>> bits) & 255; }
  }
  return bytes;
}
/** RFC 6238 SHA-1, 30-second steps; exported for operator-independent test vectors. */
export function adminTotpCode(secret: string, counter: number, digits = 6): string {
  if (!Number.isSafeInteger(counter) || counter < 0 || ![6, 8].includes(digits)) throw new Error('Invalid second factor');
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
export function matchingAdminTotpCounter(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code) || !Number.isSafeInteger(now) || now < 30_000) return null;
  const current = Math.floor(now / 30_000);
  let matched: number | null = null;
  for (const counter of [current - 1, current, current + 1]) {
    if (timingSafeEqual(Buffer.from(code), Buffer.from(adminTotpCode(secret, counter)))) matched = counter;
  }
  return matched;
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function sessionDigest(config: AdminSessionConfiguration, token: string): string { return createHmac('sha256', config.secret).update(token).digest('hex'); }
function execute(config: AdminSessionConfiguration, command: string[], signal: AbortSignal): Promise<unknown> {
  void config;
  const store = liveStoreConfig();
  if (!store) throw new Error('Administrator sessions are unavailable');
  // EVAL reads run on the authoritative primary, so cross-instance logout is immediately visible.
  return createUpstashRedisTransport(store, { maxBytes: 4_096 })(command, signal);
}
const CLOCK = "local time = redis.call('TIME'); local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)";
/**
 * Login quota (R3-SEC-2). Counting failures per username alone let anyone who
 * knew the name keep the owner locked out from any address. Attempts are now
 * counted per username + client address (5 per 5 min), with a much higher
 * per-username backstop across all addresses (50 per 5 min) so a distributed
 * guesser is still bounded. The per-address bucket is checked first, so one
 * noisy client cannot drain the backstop beyond its own 5 attempts.
 */
export const ADMIN_LOGIN_PER_ADDRESS_LIMIT = 5;
export const ADMIN_LOGIN_PER_ACCOUNT_LIMIT = 50;
const ADMIN_LOGIN_WINDOW_MS = 300_000;
const ACCOUNT_QUOTA = `local function hit(key, limit) local ttl = redis.call('PTTL', key); if ttl <= 0 then redis.call('SET', key, 1, 'PX', ${ADMIN_LOGIN_WINDOW_MS}); return {1, ${ADMIN_LOGIN_WINDOW_MS}} end; local n = tonumber(redis.call('GET', key) or '0'); if n < limit then n = redis.call('INCR', key) else n = limit + 1 end; return {n, ttl} end
local a = hit(KEYS[1], tonumber(ARGV[1])); if a[1] > tonumber(ARGV[1]) then return {0, a[2]} end
local g = hit(KEYS[2], tonumber(ARGV[2])); if g[1] > tonumber(ARGV[2]) then return {0, g[2]} end
return {1, math.max(a[2], g[2])}`;
/** Redis keys for one login attempt; `address` is the trusted client IP (or "unattributed"). */
export function adminLoginQuotaKeys(config: AdminSessionConfiguration, username: string, address: string): { perAddress: string; perAccount: string } {
  // Unknown names share one bounded bucket; arbitrary guesses cannot allocate unlimited Redis keys.
  const name = config.actors.some(actor => actor.username === username) ? `actor:${username}` : 'unknown-users';
  return { perAddress: `${PREFIX}:login:${digest(`${name}|ip:${address}`)}`, perAccount: `${PREFIX}:login:${digest(name)}` };
}
export async function consumeAdminAccountLoginQuota(config: AdminSessionConfiguration, username: string, address: string, signal: AbortSignal): Promise<{ ok: boolean; retryAfter: number }> {
  const keys = adminLoginQuotaKeys(config, username, address);
  const result = await execute(config, ['EVAL', ACCOUNT_QUOTA, '2', keys.perAddress, keys.perAccount, String(ADMIN_LOGIN_PER_ADDRESS_LIMIT), String(ADMIN_LOGIN_PER_ACCOUNT_LIMIT)], signal);
  if (!Array.isArray(result) || result.length !== 2 || (result[0] !== 0 && result[0] !== 1) || !Number.isSafeInteger(result[1]) || result[1] < 1 || result[1] > ADMIN_LOGIN_WINDOW_MS) throw new Error('Administrator sessions are unavailable');
  return { ok: result[0] === 1, retryAfter: Math.ceil(result[1] / 1_000) };
}
const CREATE = `
${CLOCK}
local step = tonumber(ARGV[1]); local current = math.floor(now / 30000)
if step < current - 1 or step > current + 1 then return nil end
local consumed = tonumber(redis.call('GET', KEYS[1]) or '-1')
if step <= consumed or redis.call('EXISTS', KEYS[2]) == 1 then return nil end
local old = redis.call('GET', KEYS[3])
if (old or '') ~= ARGV[5] then return nil end
local expires = now + ${ADMIN_SESSION_SECONDS * 1_000}
local record = cjson.encode({version=1, username=ARGV[2], fingerprint=ARGV[3], createdAt=now, seenAt=now, expiresAt=expires})
redis.call('SET', KEYS[1], step, 'PX', 120000)
if old then redis.call('DEL', KEYS[4]) end
redis.call('SET', KEYS[2], record, 'PX', ${ADMIN_SESSION_SECONDS * 1_000})
redis.call('SET', KEYS[3], ARGV[4], 'PX', ${ADMIN_SESSION_SECONDS * 1_000})
return expires`;
export async function createAdminSession(config: AdminSessionConfiguration, actor: AdminSessionActor, counter: number, signal: AbortSignal): Promise<{ token: string; expiresAt: number } | null> {
  const token = randomBytes(32).toString('base64url');
  const key = sessionDigest(config, token);
  const activeKey = `${PREFIX}:active:${digest(actor.username)}`;
  const old = await execute(config, ['EVAL', "return redis.call('GET', KEYS[1])", '1', activeKey], signal);
  if (old !== null && (typeof old !== 'string' || !/^[a-f0-9]{64}$/.test(old))) throw new Error('Administrator sessions are unavailable');
  // Declare every accessed key for hosted/clustered Redis. The atomic compare below
  // rejects a competing login if the pointer changed after this primary read.
  const result = await execute(config, ['EVAL', CREATE, '4', `${PREFIX}:otp:${digest(`${actor.username}\0${actor.totpSecret}`)}`, `${PREFIX}:session:${key}`, activeKey, `${PREFIX}:session:${old ?? key}`, String(counter), actor.username, actor.fingerprint, key, old ?? ''], signal);
  if (result === null) return null;
  if (!Number.isSafeInteger(result) || Number(result) < 1) throw new Error('Administrator sessions are unavailable');
  return { token, expiresAt: Number(result) };
}
const READ = `
${CLOCK}
local raw = redis.call('GET', KEYS[1]); if not raw then return nil end
local record = cjson.decode(raw)
if record.version ~= 1 or type(record.expiresAt) ~= 'number' or type(record.seenAt) ~= 'number' or type(record.createdAt) ~= 'number' then return redis.error_reply('Invalid session state') end
if record.expiresAt <= now or record.seenAt + ${ADMIN_SESSION_IDLE_SECONDS * 1_000} <= now or record.createdAt > now or record.seenAt > now or record.expiresAt - record.createdAt ~= ${ADMIN_SESSION_SECONDS * 1_000} then redis.call('DEL', KEYS[1]); return nil end
record.seenAt = now
local updated = cjson.encode(record)
redis.call('SET', KEYS[1], updated, 'PX', record.expiresAt - now)
return updated`;
export async function readAdminSession(req: Request): Promise<AdminPrincipal | null> {
  const cookie = adminSessionCookie(req);
  if (!cookie.token) return null;
  const config = adminSessionConfiguration();
  const result = await execute(config, ['EVAL', READ, '1', `${PREFIX}:session:${sessionDigest(config, cookie.token)}`], req.signal);
  if (result === null) return null;
  if (typeof result !== 'string' || Buffer.byteLength(result) > 1_024) throw new Error('Administrator sessions are unavailable');
  const row: unknown = JSON.parse(result);
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Administrator sessions are unavailable');
  const value = row as Record<string, unknown>;
  if (value.version !== 1 || typeof value.username !== 'string' || !USERNAME.test(value.username) || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint) || ![value.createdAt, value.seenAt, value.expiresAt].every(item => typeof item === 'number' && Number.isSafeInteger(item))) throw new Error('Administrator sessions are unavailable');
  const actor = config.actors.find(item => item.username === value.username);
  if (!actor || !timingSafeEqual(Buffer.from(actor.fingerprint), Buffer.from(value.fingerprint))) return null;
  return { username: actor.username, capabilities: [...actor.capabilities], legacy: false };
}
const LOGOUT = `local removed = redis.call('DEL', KEYS[1]); return removed`;
export async function revokeAdminSession(req: Request): Promise<void> {
  const cookie = adminSessionCookie(req);
  if (!cookie.token) return;
  const config = adminSessionConfiguration();
  const result = await execute(config, ['EVAL', LOGOUT, '1', `${PREFIX}:session:${sessionDigest(config, cookie.token)}`], req.signal);
  if (![0, 1].includes(result as number)) throw new Error('Administrator sessions are unavailable');
}
