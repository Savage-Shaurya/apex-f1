import { isEditorialId, listEditorialAudit } from '@apex/db';
import { authorizeAdminRequest } from '@/lib/admin-auth';
import { errorResponse, InputError } from '@/lib/api-input';
import { encodeEditorialCursor, parseEditorialCursor } from '@/lib/article-console';
import { rateLimitShared, rateLimitUnavailable } from '@/lib/distributed-rate-limit';
import { tooMany } from '@/lib/rate-limit';

export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: Request) {
  const authorization = await authorizeAdminRequest(req, 'read');
  if (authorization.response) return authorization.response;
  let id: string;
  let limit: number;
  let cursor: ReturnType<typeof parseEditorialCursor>;
  try {
    const url = new URL(req.url);
    const identity = url.searchParams.get('id');
    if (!isEditorialId(identity)) throw new InputError('A valid article identity is required.');
    id = identity;
    const rawLimit = url.searchParams.get('limit') ?? '25';
    if (!/^\d{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50) throw new InputError('Audit page size must be between 1 and 50.');
    limit = Number(rawLimit);
    cursor = parseEditorialCursor(url.searchParams.get('cursor'));
  } catch (error) { return errorResponse(error); }
  if (!process.env.DATABASE_URL) return json({ ok: false, error: 'Article storage is temporarily unavailable.' }, 503);
  const quota = await rateLimitShared(req, { limit: 60, windowMs: 60_000, bucket: 'articles-read' });
  if (!quota.available) return rateLimitUnavailable(quota);
  if (!quota.ok) return tooMany(quota);
  try {
    const page = await listEditorialAudit(id, limit, cursor);
    return json({ ok: true, entries: page.entries, nextCursor: encodeEditorialCursor(page.next) });
  } catch { return json({ ok: false, error: 'Editorial audit could not be loaded. Please try again shortly.' }, 503); }
}
