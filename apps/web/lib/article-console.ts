import { EditorialConflict, isEditorialId, isEditorialRevision, type EditorialArticle, type EditorialCursor, type EditorialInput } from '@apex/db';
import { InputError, stringField } from './api-input';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
export function parseEditorialInput(body: Record<string, unknown>): EditorialInput {
  const title = stringField(body, 'title', 250, true);
  const slug = stringField(body, 'slug', 100, true);
  const bodyMd = stringField(body, 'bodyMd', 100_000, true);
  if (!SLUG.test(slug)) throw new InputError('Use 1–100 lowercase letters, numbers or hyphens for the article URL.');
  if (body.status !== undefined && body.status !== 'draft' && body.status !== 'published') throw new InputError('Invalid publication status.');
  return { title, slug, bodyMd, dek: stringField(body, 'dek', 1_000) || null, section: stringField(body, 'section', 80) || null, status: body.status === 'published' ? 'published' : 'draft' };
}
export function parseEditorialIdentity(body: Record<string, unknown>): { id: string; revision: string } {
  if (!isEditorialId(body.id) || !isEditorialRevision(body.revision)) throw new InputError('A valid article identity and revision are required.');
  return { id: body.id, revision: body.revision };
}
export function encodeEditorialCursor(cursor: EditorialCursor | null): string | null {
  return cursor ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null;
}
export function parseEditorialCursor(value: string | null): EditorialCursor | undefined {
  if (!value) return undefined;
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new InputError('Invalid article page.');
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parseEditorialIdentity(parsed as Record<string, unknown>);
  } catch { throw new InputError('Invalid article page.'); }
}
export function editorialRefreshTargets(): { path: string; type?: 'page' }[] {
  // Every article includes related editorial, not just the edited URL.
  return [{ path: '/latest' }, { path: '/' }, { path: '/search' }, { path: '/sitemap.xml' }, { path: '/sitemap-index.xml' }, { path: '/article/[slug]', type: 'page' }];
}
export interface EditorialMutationServices {
  create(input: EditorialInput, id?: string): Promise<EditorialArticle>;
  update(id: string, revision: string, input: EditorialInput): Promise<EditorialArticle>;
  load?(id: string): Promise<EditorialArticle | null>;
  canPublish?: boolean;
  refresh(path: string, type?: 'page'): void;
}
function duplicate(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : null;
  }
  return false;
}
/** Storage confirmation survives a partial cache failure and is never retried. */
export async function saveEditorialArticle(method: 'POST' | 'PATCH', body: Record<string, unknown>, services: EditorialMutationServices): Promise<Response> {
  const input = parseEditorialInput(body);
  if (method === 'PATCH' && body.status === undefined) throw new InputError('Publication status is required when updating an article.');
  const identity = method === 'PATCH' ? parseEditorialIdentity(body) : null;
  if (method === 'POST' && body.id !== undefined && !isEditorialId(body.id)) throw new InputError('Invalid article identity.');
  if (services.canPublish === false) {
    if (input.status === 'published') return Response.json({ ok: false, error: 'Publication permission is required.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    if (identity) {
      try {
        if (!services.load) throw new Error('Publication permission could not be checked.');
        const current = await services.load(identity.id);
        if (current?.status === 'published') return Response.json({ ok: false, error: 'Publication permission is required to change a published article.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
      } catch { return Response.json({ ok: false, error: 'Publication permission could not be checked. No save was attempted.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
    }
  }
  try {
    const saved = identity ? await services.update(identity.id, identity.revision, input) : await services.create(input, typeof body.id === 'string' ? body.id : undefined);
    let refreshPending = false;
    for (const target of editorialRefreshTargets()) {
      try { services.refresh(target.path, target.type); } catch { refreshPending = true; }
    }
    return Response.json({ ok: true, article: saved, id: saved.id, slug: saved.slug, ...(refreshPending ? { refreshPending: true } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const status = error instanceof EditorialConflict ? error.status : duplicate(error) ? 409 : 503;
    const message = error instanceof EditorialConflict ? error.message : duplicate(error) ? 'This article URL already exists. Choose a different URL for the new article.' : 'Article storage is temporarily unavailable. Your changes have not been confirmed.';
    return Response.json({ ok: false, error: message, ...(status === 503 ? { writeUncertain: true } : {}) }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
