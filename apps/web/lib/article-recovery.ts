// Browser-safe: only the editorial contract types cross this boundary.
import type { EditorialArticle, EditorialInput } from '@apex/db';

export interface EditorialAttempt {
  id: string;
  baseRevision: string | null;
  input: EditorialInput;
}
export type EditorialRecovery =
  | { kind: 'confirmed'; article: EditorialArticle }
  | { kind: 'not-confirmed'; article: EditorialArticle | null; reason: 'missing' | 'unchanged' }
  | { kind: 'conflict'; article: EditorialArticle | null };

/** Match the API's string normalization before storing the attempted snapshot. */
export function captureEditorialAttempt(id: string, baseRevision: string | null, input: EditorialInput): EditorialAttempt {
  return { id, baseRevision, input: {
    title: input.title.trim(), slug: input.slug.trim(), bodyMd: input.bodyMd.trim(),
    dek: input.dek?.trim() || null, section: input.section?.trim() || null, status: input.status,
  } };
}

/** Preserve PostgreSQL microseconds, including equivalent timezone spellings. */
function revisionMicros(value: string): bigint | null {
  const fraction = value.match(/\.(\d{1,6})(?=Z|[+-]\d{2}(?::?\d{2})?$)/);
  const seconds = Date.parse(fraction ? value.replace(fraction[0], '') : value);
  return Number.isFinite(seconds) ? BigInt(seconds) * 1_000n + BigInt((fraction?.[1] ?? '').padEnd(6, '0')) : null;
}

/** A read of any row is insufficient evidence that an interrupted save committed. */
export function classifyEditorialRecovery(attempt: EditorialAttempt, stored: EditorialArticle | null): EditorialRecovery {
  if (!stored) return attempt.baseRevision === null
    ? { kind: 'not-confirmed', article: null, reason: 'missing' }
    : { kind: 'conflict', article: null };
  if (stored.id !== attempt.id) return { kind: 'conflict', article: stored };
  const actualRevision = revisionMicros(stored.revision);
  const baseRevision = attempt.baseRevision === null ? null : revisionMicros(attempt.baseRevision);
  if (actualRevision === null || (attempt.baseRevision !== null && baseRevision === null)) return { kind: 'conflict', article: stored };
  if (baseRevision !== null && actualRevision === baseRevision) return { kind: 'not-confirmed', article: stored, reason: 'unchanged' };
  const desired = attempt.input;
  const matches = stored.slug === desired.slug && stored.title === desired.title && stored.dek === desired.dek &&
    stored.section === desired.section && stored.bodyMd === desired.bodyMd && stored.status === desired.status;
  return matches && (baseRevision === null || actualRevision > baseRevision)
    ? { kind: 'confirmed', article: stored }
    : { kind: 'conflict', article: stored };
}
