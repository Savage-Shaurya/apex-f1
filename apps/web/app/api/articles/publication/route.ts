import { revalidatePath } from 'next/cache';
import { getEditorialPublication, isEditorialId, updateEditorialPublication } from '@apex/db';
import { authorizeAdminRequest } from '@/lib/admin-auth';
import { rateLimit, tooMany } from '@/lib/rate-limit';
import { rateLimitShared, rateLimitUnavailable } from '@/lib/distributed-rate-limit';
import { validateJsonMutationRequest } from '@/lib/mutation-guard';
import { errorResponse, InputError, readJsonObject } from '@/lib/api-input';
import { saveEditorialPublication } from '@/lib/article-publication';

export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: Request) {
  const authorization = await authorizeAdminRequest(req, 'read');
  if (authorization.response) return authorization.response;
  const id = new URL(req.url).searchParams.get('id');
  if (!isEditorialId(id)) return errorResponse(new InputError('A valid article identity is required.'));
  if (!process.env.DATABASE_URL) return json({ ok: false, error: 'Article storage is temporarily unavailable.' }, 503);
  const quota = await rateLimitShared(req, { limit: 60, windowMs: 60_000, bucket: 'articles-read' });
  if (!quota.available) return rateLimitUnavailable(quota);
  if (!quota.ok) return tooMany(quota);
  try {
    const publication = await getEditorialPublication(id);
    return publication ? json({ ok: true, publication }) : json({ ok: false, error: 'This article no longer exists.' }, 404);
  } catch { return json({ ok: false, error: 'Publication policy could not be loaded. Please try again shortly.' }, 503); }
}
export async function PATCH(req: Request) {
  const authorization = await authorizeAdminRequest(req, 'publish');
  if (authorization.response) return authorization.response;
  const guard = validateJsonMutationRequest(req);
  if (guard) return guard;
  const parseQuota = rateLimit(req, { limit: 60, windowMs: 60_000, bucket: 'articles-parse' });
  if (!parseQuota.ok) return tooMany(parseQuota);
  if (!process.env.DATABASE_URL) return json({ ok: false, error: 'Article storage is temporarily unavailable.' }, 503);
  let body: Record<string, unknown>;
  try { body = await readJsonObject(req, 2_048); } catch (error) { return errorResponse(error); }
  const quota = await rateLimitShared(req, { limit: 30, windowMs: 60_000, bucket: 'articles-write' });
  if (!quota.available) return rateLimitUnavailable(quota);
  if (!quota.ok) return tooMany(quota);
  try { return await saveEditorialPublication(body, { update: (id, revision, patch) => updateEditorialPublication(id, revision, patch, authorization.principal.username), refresh: revalidatePath }); }
  catch (error) { return errorResponse(error); }
}
