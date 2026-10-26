/**
 * A short, redacted description of a thrown error for cron reports, logs and
 * ingestion_run.error (R3-BE-2). It keeps only the error class, a provider
 * name, a provider failure code, an HTTP status and a system or Postgres error
 * code (ECONNREFUSED, 57014, 55P03, ...), following up to three `cause` links.
 * Messages, bodies, URLs, hosts and credentials are never included.
 */
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,48}$/;
const CODE = /^[A-Za-z0-9_-]{2,32}$/;
const PROVIDER = /^[a-z0-9-]{1,32}$/;

function one(error: unknown): string | null {
  if (!error || typeof error !== 'object') return typeof error === 'string' ? 'non-Error string thrown' : null;
  const record = error as Record<string, unknown>;
  const ctor = (error as { constructor?: { name?: unknown } }).constructor?.name;
  const rawName = typeof record.name === 'string' && record.name !== 'Error' ? record.name : typeof ctor === 'string' ? ctor : 'Error';
  const parts = [NAME.test(rawName) ? rawName : 'Error'];
  if (typeof record.provider === 'string' && PROVIDER.test(record.provider)) parts.push(`provider=${record.provider}`);
  const code = record.code;
  if ((typeof code === 'string' && CODE.test(code)) || (typeof code === 'number' && Number.isSafeInteger(code))) parts.push(`code=${code}`);
  if (typeof record.status === 'number' && Number.isInteger(record.status) && record.status >= 100 && record.status <= 599) parts.push(`status=${record.status}`);
  if (typeof record.errno === 'number' && Number.isInteger(record.errno) && !parts.some((part) => part.startsWith('code='))) parts.push(`errno=${record.errno}`);
  return parts.join(' ');
}

export function describeError(error: unknown): string {
  const chain: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const text = one(current);
    if (text && !chain.includes(text)) chain.push(text);
    const record = current as { cause?: unknown; errors?: unknown };
    current = record.cause ?? (Array.isArray(record.errors) ? record.errors[0] : undefined);
  }
  return chain.length ? chain.join(' <- ') : 'unknown error';
}
