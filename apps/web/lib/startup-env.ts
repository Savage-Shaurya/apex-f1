import { inspectProductionSecurityConfiguration } from './security-configuration';
import { logEvent } from './log';
import { siteOriginIssue } from '../components/shell/site-metadata';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Production fail-fast. On the production deployment (VERCEL_ENV=production),
 * or wherever APEX_STRICT_ENV=true is set for a local production rehearsal,
 * the server refuses to start when security-critical configuration is missing
 * or unsafe. The error names fields and fixed reasons only, never values.
 *
 * Preview deployments and local `next start` are not forced, so a preview
 * without production secrets still boots (its admin, cron and form routes
 * fail closed on their own).
 */
export function strictEnvironment(env: Env): boolean {
  return env.VERCEL_ENV === 'production' || env.APEX_STRICT_ENV === 'true';
}

/** Fields whose absence degrades one feature (mail, paid inference) rather than safety: logged, not fatal. */
const WARN_ONLY = new Set(['RESEND_API_KEY', 'RESEND_AUDIENCE_ID', 'RESEND_FROM_EMAIL', 'HUGGINGFACE_TOKEN', 'GROQ_API_KEY']);

/** NEXT_PUBLIC_* values are inlined into the browser bundle; a secret-shaped name there is a leak. */
export function publicSecretFields(env: Env): string[] {
  // NEXT_PUBLIC_POSTHOG_KEY is a public project key by design (consent-gated in the browser).
  return Object.keys(env).filter((key) => key.startsWith('NEXT_PUBLIC_') && key !== 'NEXT_PUBLIC_POSTHOG_KEY' && /(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|DATABASE|SERVICE_ROLE)/.test(key.slice('NEXT_PUBLIC_'.length)));
}

export function assertProductionEnvironment(env: Env): void {
  if (!strictEnvironment(env)) return;
  const inspection = inspectProductionSecurityConfiguration(env as Record<string, string | undefined>);
  const fatal = inspection.issues.filter((issue) => issue.severity === 'error' && !WARN_ONLY.has(issue.field));
  const warnings = inspection.issues.filter((issue) => issue.severity !== 'error' || WARN_ONLY.has(issue.field));
  const originIssue = siteOriginIssue(env);
  if (originIssue && !fatal.some((issue) => issue.field === 'NEXT_PUBLIC_SITE_URL')) fatal.push({ field: 'NEXT_PUBLIC_SITE_URL', code: originIssue, severity: 'error', message: 'Set the public HTTPS origin of this deployment; it is the only source for canonicals, the sitemap and OG images.' });
  for (const field of publicSecretFields(env)) fatal.push({ field, code: 'public-secret', severity: 'error', message: 'NEXT_PUBLIC_ values ship to every browser; keep secrets in server-only variables.' });
  if (warnings.length) logEvent('warn', 'startup.config-warning', { issues: warnings.map((issue) => `${issue.field} (${issue.code})`) });
  if (fatal.length) {
    logEvent('error', 'startup.config-invalid', { issues: fatal.map((issue) => `${issue.field} (${issue.code})`) });
    throw new Error(`Apex refused to start: production configuration is incomplete or unsafe.\n${fatal.map((issue) => `  - ${issue.field} (${issue.code}): ${issue.message}`).join('\n')}\nSet these in Vercel > Settings > Environment Variables (Production) and redeploy. See docs/LAUNCH-CHECKLIST.md.`);
  }
  logEvent('info', 'startup.config-ok', { checked: inspection.issues.length === 0 ? 'all' : 'with-warnings' });
}
