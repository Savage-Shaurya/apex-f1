import { EditorialConflict, isEditorialPublicationDate, type EditorialPublication, type EditorialPublicationPatch } from '@apex/db';
import { InputError } from './api-input';
import { editorialRefreshTargets, parseEditorialIdentity } from './article-console';

export function parseEditorialPublication(body: Record<string, unknown>): { id: string; revision: string; patch: EditorialPublicationPatch } {
  const identity = parseEditorialIdentity(body);
  const patch: EditorialPublicationPatch = {};
  if (Object.keys(body).some((key) => !['id', 'revision', 'publishedAt', 'embargoUntil', 'isPremium'].includes(key))) throw new InputError('Unsupported publication policy field.');
  for (const field of ['publishedAt', 'embargoUntil'] as const) {
    if (!Object.hasOwn(body, field)) continue;
    const value = body[field];
    if (value !== null && !isEditorialPublicationDate(value)) throw new InputError(`${field} must be an ISO timestamp with timezone, or null.`);
    patch[field] = value;
  }
  if (Object.hasOwn(body, 'isPremium')) {
    if (typeof body.isPremium !== 'boolean') throw new InputError('isPremium must be a boolean.');
    patch.isPremium = body.isPremium;
  }
  if (!Object.keys(patch).length) throw new InputError('At least one publication policy field is required.');
  return { ...identity, patch };
}
export interface EditorialPublicationServices {
  update(id: string, revision: string, patch: EditorialPublicationPatch): Promise<EditorialPublication>;
  refresh(path: string, type?: 'page'): void;
}
export async function saveEditorialPublication(body: Record<string, unknown>, services: EditorialPublicationServices): Promise<Response> {
  const { id, revision, patch } = parseEditorialPublication(body);
  try {
    const publication = await services.update(id, revision, patch);
    let refreshPending = false;
    for (const target of editorialRefreshTargets()) {
      try { services.refresh(target.path, target.type); } catch { refreshPending = true; }
    }
    return Response.json({ ok: true, publication, ...(refreshPending ? { refreshPending: true } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const conflict = error instanceof EditorialConflict;
    return Response.json({ ok: false, error: conflict ? error.message : 'Publication changes have not been confirmed. Reload its policy before retrying.', ...(!conflict ? { writeUncertain: true } : {}) }, { status: conflict ? error.status : 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
