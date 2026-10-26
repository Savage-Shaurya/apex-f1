import { revalidatePath } from 'next/cache';
import { createEditorialArticle, getEditorialArticle, isEditorialId, listEditorialArticles, updateEditorialArticle } from '@apex/db';
import { authorizeAdminRequest, hasAdminCapability } from '@/lib/admin-auth';
import { rateLimit, tooMany } from '@/lib/rate-limit';
import { rateLimitShared, rateLimitUnavailable } from '@/lib/distributed-rate-limit';
import { validateJsonMutationRequest } from '@/lib/mutation-guard';
import { readJsonObject, InputError, errorResponse } from '@/lib/api-input';
import { encodeEditorialCursor, parseEditorialCursor, saveEditorialArticle } from '@/lib/article-console';

export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: Request) {
  const authorization = await authorizeAdminRequest(req, 'read');
  if (authorization.response) return authorization.response;
  if (!process.env.DATABASE_URL) return json({ ok: false, error: 'Article storage is temporarily unavailable.' }, 503);
  let id: string | null;
  let cursor: ReturnType<typeof parseEditorialCursor>;
  let limit: number;
  try {
    const url = new URL(req.url);
    id = url.searchParams.get('id');
    if (id !== null && !isEditorialId(id)) throw new InputError('Invalid article identity.');
    cursor = parseEditorialCursor(url.searchParams.get('cursor'));
    const rawLimit = url.searchParams.get('limit') ?? '25';
    if (!/^\d{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50) throw new InputError('Article page size must be between 1 and 50.');
    limit = Number(rawLimit);
  } catch (error) { return errorResponse(error); }
  const quota = await rateLimitShared(req, { limit: 60, windowMs: 60_000, bucket: 'articles-read', localFallback: true });
  if (!quota.available) return rateLimitUnavailable(quota);
  if (!quota.ok) return tooMany(quota);
  try {
    if (id) {
      const article = await getEditorialArticle(id);
      return article ? json({ ok: true, article }) : json({ ok: false, error: 'This article no longer exists.' }, 404);
    }
    const page = await listEditorialArticles(limit, cursor);
    return json({ ok: true, articles: page.articles, nextCursor: encodeEditorialCursor(page.next) });
  } catch { return json({ ok: false, error: 'Articles could not be loaded. Please try again shortly.' }, 503); }
}

async function mutate(req: Request, method: 'POST' | 'PATCH') {
  const authorization = await authorizeAdminRequest(req, 'write');
  if (authorization.response) return authorization.response;
  const guard = validateJsonMutationRequest(req);
  if (guard) return guard;
  const parseQuota = rateLimit(req, { limit: 60, windowMs: 60_000, bucket: 'articles-parse' });
  if (!parseQuota.ok) return tooMany(parseQuota);
  if (!process.env.DATABASE_URL) return json({ ok: false, error: 'Article storage is temporarily unavailable.' }, 503);
  let body: Record<string, unknown>;
  try { body = await readJsonObject(req, 131_072); } catch (error) { return errorResponse(error); }
  const quota = await rateLimitShared(req, { limit: 30, windowMs: 60_000, bucket: 'articles-write' });
  if (!quota.available) return rateLimitUnavailable(quota);
  if (!quota.ok) return tooMany(quota);
  try {
    const actor = authorization.principal.username;
    return await saveEditorialArticle(method, body, { create: (input, id) => createEditorialArticle(input, id, actor), update: (id, revision, input) => updateEditorialArticle(id, revision, input, actor), load: getEditorialArticle, canPublish: hasAdminCapability(authorization.principal, 'publish'), refresh: revalidatePath });
  } catch (error) { return errorResponse(error); }
}
export async function POST(req: Request) { return mutate(req, 'POST'); }
export async function PATCH(req: Request) { return mutate(req, 'PATCH'); }
