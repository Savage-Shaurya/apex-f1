import { isAbsolute } from 'node:path';
import { configuredAdminUsers } from './admin-auth';
import { posthogResourceOrigin } from './security-headers';
import { adminSessionConfiguration } from './admin-session';

export interface SecurityConfigurationIssue {
  field: string;
  code: string;
  severity: 'error' | 'warning';
  message: string;
}
export interface SecurityConfigurationReadiness {
  ready: boolean;
  issues: SecurityConfigurationIssue[];
  /** This validates configuration shape only; it does not contact or accept a service. */
  serviceConnectionsVerified: false;
}

/** Pure release preflight: returns field names and fixed diagnostics, never supplied values. */
export function inspectProductionSecurityConfiguration(environment: Record<string, string | undefined>): SecurityConfigurationReadiness {
  const issues: SecurityConfigurationIssue[] = [];
  const error = (field: string, code: string, message: string) => issues.push({ field, code, severity: 'error' as const, message });
  const strong = (field: string) => {
    const value = environment[field];
    if (!value) error(field, 'missing', 'Configure a private random secret before release.');
    else if (Buffer.byteLength(value) < 32 || Buffer.byteLength(value) > 512 || /[\r\n]/.test(value)) error(field, 'invalid-secret', 'Use 32 to 512 UTF-8 bytes with no line breaks; generate a random value.');
  };
  strong('CRON_SECRET'); strong('PREDICTION_COOKIE_SECRET');
  if (!environment.ADMIN_USERS_JSON) error('ADMIN_USERS_JSON', 'missing-admin', 'Configure individually scoped administrator credentials with second factors.');
  if (environment.ADMIN_PASSWORD) { strong('ADMIN_PASSWORD'); error('ADMIN_PASSWORD', 'legacy-admin-disabled', 'Remove the legacy password-only owner credential from production.'); }
  try { adminSessionConfiguration(environment); }
  catch { error('ADMIN_SESSION_SECRET', 'invalid-admin-session', 'Configure a private random base64url session secret, shared Redis and a unique 32-character Base32 second factor for every named administrator.'); }
  if (environment.ADMIN_USERS_JSON) {
    try {
      const users = configuredAdminUsers(environment);
      if (!users.some(user => user.capabilities.includes('read') && user.capabilities.includes('write') && user.capabilities.includes('publish'))) {
        error('ADMIN_USERS_JSON', 'missing-publisher', 'Configure at least one operator who can read, write and publish editorial content.');
      }
    } catch { error('ADMIN_USERS_JSON', 'invalid-admin', 'Use bounded unique usernames, fixed-format scrypt hashes and explicit supported capabilities.'); }
  }
  if (environment.ADMIN_LOCAL_DEV_BYPASS === 'true') error('ADMIN_LOCAL_DEV_BYPASS', 'development-bypass', 'Remove the development bypass from release configuration.');
  if (environment.DISTRIBUTED_RATE_LIMIT_REQUIRED !== 'true') error('DISTRIBUTED_RATE_LIMIT_REQUIRED', 'shared-store-required', 'Set the explicit shared quota requirement to true for release.');
  try {
    const url = new URL(environment.UPSTASH_REDIS_REST_URL ?? '');
    if (url.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.upstash\.io$/.test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error();
  } catch { error('UPSTASH_REDIS_REST_URL', 'invalid-store-origin', 'Configure the canonical HTTPS Upstash REST origin.'); }
  const redisToken = environment.UPSTASH_REDIS_REST_TOKEN;
  if (!redisToken || redisToken.length > 4_096 || !/^[a-zA-Z0-9._~+/-]+={0,2}$/.test(redisToken)) error('UPSTASH_REDIS_REST_TOKEN', 'invalid-store-token', 'Configure the private Redis REST token.');
  const databaseIdentity = (field: string): string | null => {
    try {
      const url = new URL(environment[field] ?? '');
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password || url.pathname === '/' || url.hash) throw new Error();
      const username = decodeURIComponent(url.username);
      if (/^postgres(?:\.|$)/i.test(username)) error(field, 'owner-role', 'Use a dedicated least-privileged database role instead of the owner account.');
      if (['disable', 'allow', 'prefer'].includes(url.searchParams.get('sslmode') ?? '') || url.searchParams.get('ssl') === 'false') error(field, 'insecure-tls', 'Database TLS certificate and hostname verification must remain enabled.');
      return username;
    } catch { error(field, 'invalid-database', 'Configure the dedicated PostgreSQL connection privately.'); return null; }
  };
  const runtimeIdentity = databaseIdentity('DATABASE_URL');
  const workerIdentity = databaseIdentity('DATABASE_WORKER_URL');
  if (runtimeIdentity && workerIdentity && runtimeIdentity === workerIdentity) error('DATABASE_WORKER_URL', 'shared-database-identity', 'Jobs require a distinct dedicated role from the web runtime connection.');
  if (environment.DATABASE_SSL_CA_PATH && !isAbsolute(environment.DATABASE_SSL_CA_PATH)) error('DATABASE_SSL_CA_PATH', 'relative-ca-path', 'A trusted custom CA certificate path must be absolute.');
  try {
    if (!environment.NEXT_PUBLIC_SITE_URL) throw new Error();
    posthogResourceOrigin(environment.NEXT_PUBLIC_SITE_URL);
  } catch { error('NEXT_PUBLIC_SITE_URL', 'invalid-public-origin', 'Configure the canonical public HTTPS origin before release.'); }
  for (const field of ['RESEND_API_KEY', 'RESEND_AUDIENCE_ID']) {
    if (!environment[field] || /[\r\n]/.test(environment[field]!)) error(field, 'missing-mail-service', 'Configure the private newsletter provider account before delivery acceptance.');
  }
  if (!environment.RESEND_FROM_EMAIL || !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(environment.RESEND_FROM_EMAIL) || environment.RESEND_FROM_EMAIL.toLowerCase().endsWith('@resend.dev')) error('RESEND_FROM_EMAIL', 'invalid-newsletter-sender', 'Configure a verified custom-domain newsletter sender.');
  for (const [flag, key] of [['HUGGINGFACE_INFERENCE_ENABLED', 'HUGGINGFACE_TOKEN'], ['GROQ_INFERENCE_ENABLED', 'GROQ_API_KEY']] as const) {
    if (environment[flag] !== undefined && !['true', 'false'].includes(environment[flag]!)) error(flag, 'invalid-inference-flag', 'Inference flags must explicitly be true or false.');
    if (environment[flag] === 'true' && !environment[key]) error(key, 'missing-inference-token', 'Enabled paid inference needs a private provider token and entitlement acceptance.');
  }
  try { posthogResourceOrigin(environment.NEXT_PUBLIC_POSTHOG_HOST); }
  catch { error('NEXT_PUBLIC_POSTHOG_HOST', 'invalid-analytics-origin', 'Use a canonical public HTTPS analytics origin without credentials, ports, paths or query strings.'); }
  return { ready: !issues.some(issue => issue.severity === 'error'), issues, serviceConnectionsVerified: false };
}
