/**
 * Environment scope for shared Redis keys (audit F-07).
 *
 * Every budget, quota, backoff and cache key in Upstash is written under the
 * scope of the process that writes it, so a laptop, a CI job or a preview
 * deployment started with `production.env` can never spend or pause the live
 * site's Jolpica/OpenF1 budget or overwrite its snapshots:
 *
 *   - production (VERCEL_ENV=production, or APEX_ENV=production on a
 *     self-hosted production server without VERCEL_ENV): the original,
 *     unscoped keys (`apex:jolpica:v1:{jolpica}:quota`), so a deploy keeps the
 *     quota history it already has;
 *   - everything else: `apex:<scope>:...`, where scope is VERCEL_ENV (preview,
 *     development) or APEX_ENV, else `local`, plus an optional
 *     APEX_REDIS_SCOPE label (`local-auditfix-data`) to isolate one worktree,
 *     agent or CI job from the others.
 *
 * A separate Upstash database for non-production is still the stronger
 * isolation (DEPLOY.md); this scope guarantees that even a shared database
 * cannot mix the budgets.
 */
type Env = Readonly<Record<string, string | undefined>>;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function label(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && LABEL.test(trimmed) ? trimmed : null;
}

/** null = production (unscoped keys); otherwise the scope label. */
export function redisKeyScope(env: Env = process.env): string | null {
  const vercel = label(env.VERCEL_ENV);
  if (vercel === 'production') return null;
  const apex = label(env.APEX_ENV);
  if (!vercel && apex === 'production') return null;
  const base = vercel ?? (apex && apex !== 'production' ? apex : 'local');
  const extra = label(env.APEX_REDIS_SCOPE);
  return extra ? `${base}-${extra}` : base;
}

/** `apex:<rest>` for production, `apex:<scope>:<rest>` everywhere else. */
export function scopedRedisKey(key: string, env: Env = process.env): string {
  if (!key.startsWith('apex:')) throw new Error('Redis keys must start with "apex:"');
  const scope = redisKeyScope(env);
  return scope ? `apex:${scope}:${key.slice(5)}` : key;
}
