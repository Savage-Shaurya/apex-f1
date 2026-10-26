import { getNewsletterEditionReview, listNewsletterEditionReviews, listNewsletterRecoveryAudit,
  isNewsletterEditionKey, NewsletterRecoveryConflict } from '@apex/db';
import { authorizeAdminRequest } from './admin-auth';
import { validateJsonMutationRequest } from './mutation-guard';
import { readJsonObject, InputError, errorResponse } from './api-input';
import { rateLimitShared, rateLimitUnavailable } from './distributed-rate-limit';
import { tooMany } from './rate-limit';
import { parseNewsletterRecoveryInput, recoverNewsletterEdition } from './newsletter-recovery';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' } });
async function authorize(req: Request) {
  const gate = await authorizeAdminRequest(req, 'newsletter-reconcile');
  if (gate.response) return gate;
  if (gate.principal.legacy) return { principal: null, response: json({ ok: false, error: 'Named newsletter recovery authorization is required.' }, 403) };
  return gate;
}
function failure(error: unknown) {
  if (error instanceof InputError) return errorResponse(error);
  if (error instanceof NewsletterRecoveryConflict) return json({ ok: false, error: error.message }, error.status);
  return json({ ok: false, error: 'Newsletter recovery is temporarily unavailable; no replay was enabled.' }, 503);
}

export async function listNewsletterRecovery(req: Request) {
  const gate = await authorize(req);
  if (gate.response) return gate.response;
  try {
    const query = new URL(req.url).searchParams;
    if ([...query.keys()].some((field) => !['limit', 'before'].includes(field)) || query.getAll('limit').length > 1 || query.getAll('before').length > 1)
      throw new InputError('Invalid newsletter pagination.');
    const rawLimit = query.get('limit') ?? '25', before = query.get('before') ?? undefined;
    if (!/^(?:[1-9]|1\d|2[0-5])$/.test(rawLimit) || (before !== undefined && !isNewsletterEditionKey(before))) throw new InputError('Invalid newsletter pagination.');
    const page = await listNewsletterEditionReviews(Number(rawLimit), before);
    return json({ ok: true, ...page, automaticReplayAllowed: false });
  } catch (error) { return failure(error); }
}
export async function getNewsletterRecovery(req: Request, key: string) {
  const gate = await authorize(req);
  if (gate.response) return gate.response;
  if (!isNewsletterEditionKey(key) || new URL(req.url).search) return json({ ok: false, error: 'Invalid newsletter edition identity.' }, 400);
  try {
    const edition = await getNewsletterEditionReview(key);
    if (!edition) return json({ ok: false, error: 'Newsletter edition was not found.' }, 404);
    const audit = await listNewsletterRecoveryAudit(key);
    return json({ ok: true, edition, audit, automaticReplayAllowed: false });
  } catch (error) { return failure(error); }
}
export async function postNewsletterRecovery(req: Request, key: string) {
  const gate = await authorize(req);
  if (gate.response) return gate.response;
  const boundary = validateJsonMutationRequest(req);
  if (boundary) return boundary;
  try {
    if (new URL(req.url).search) throw new InputError('Invalid newsletter recovery request.');
    const body = await readJsonObject(req, 2_048);
    const input = parseNewsletterRecoveryInput(key, body);
    if (!process.env.RESEND_API_KEY) return json({ ok: false, error: 'Newsletter provider readback is not configured.' }, 503);
    const quota = await rateLimitShared(req, { limit: 30, windowMs: 60_000, bucket: 'newsletter-recovery' });
    if (!quota.available) return rateLimitUnavailable(quota);
    if (!quota.ok) return tooMany(quota);
    const result = await recoverNewsletterEdition(input, gate.principal!.username, { apiKey: process.env.RESEND_API_KEY, signal: req.signal });
    return json({ ok: true, ...result });
  } catch (error) { return failure(error); }
}
