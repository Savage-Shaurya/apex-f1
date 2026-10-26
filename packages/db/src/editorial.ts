import { sql, type SQL } from 'drizzle-orm';
import { getDb } from './client';

export type EditorialStatus = 'draft' | 'published';
export interface EditorialInput {
  title: string;
  slug: string;
  dek: string | null;
  section: string | null;
  bodyMd: string;
  status: EditorialStatus;
}
export interface EditorialSummary {
  id: string;
  slug: string;
  title: string;
  section: string | null;
  status: EditorialStatus;
  visibility: 'draft' | 'public' | 'scheduled' | 'restricted';
  editable: boolean;
  publishedAt: string | null;
  // PostgreSQL's precision-preserving token must never pass through a JS Date.
  revision: string;
}
export interface EditorialArticle extends EditorialSummary {
  dek: string | null;
  bodyMd: string;
}
export interface EditorialPublication extends EditorialSummary {
  embargoUntil: string | null;
  isPremium: boolean;
}
export interface EditorialPublicationPatch {
  publishedAt?: string | null;
  embargoUntil?: string | null;
  isPremium?: boolean;
}
export interface EditorialCursor { id: string; revision: string }
export interface EditorialAuditEntry {
  id: string;
  articleId: string | null;
  actor: string;
  operation: 'create' | 'update' | 'publication';
  previousRevision: string | null;
  revision: string;
  publication: Record<string, unknown>;
  createdAt: string;
}
export class EditorialConflict extends Error {
  constructor(message: string, readonly status: 404 | 409) { super(message); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
export function isEditorialId(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
export function isEditorialRevision(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !REVISION.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}
/** Publication dates require an explicit ISO timezone; no implicit local dates. */
export function isEditorialPublicationDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !isEditorialRevision(value)) return false;
  return Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}
function database() {
  if (!process.env.DATABASE_URL) throw new Error('Article storage is not configured.');
  return getDb();
}
const SUMMARY = sql`id, slug, title, section, published_at::text as published_at,
  updated_at::text as revision,
  case when published_at is null then 'draft' else 'published' end as status,
  case when is_premium or embargo_until > clock_timestamp() then 'restricted'
       when published_at > clock_timestamp() then 'scheduled'
       when published_at is null then 'draft' else 'public' end as visibility,
  (not is_premium and (embargo_until is null or embargo_until <= clock_timestamp())
    and (published_at is null or published_at <= clock_timestamp())) as editable`;
function summary(row: Record<string, unknown>): EditorialSummary {
  return {
    id: String(row.id), slug: String(row.slug), title: String(row.title),
    section: typeof row.section === 'string' ? row.section : null,
    status: row.status === 'published' ? 'published' : 'draft',
    visibility: row.visibility as EditorialSummary['visibility'], editable: row.editable === true,
    publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
    revision: String(row.revision),
  };
}
function detail(row: Record<string, unknown>): EditorialArticle {
  return { ...summary(row), dek: typeof row.dek === 'string' ? row.dek : null, bodyMd: typeof row.body_md === 'string' ? row.body_md : '' };
}
function publication(row: Record<string, unknown>): EditorialPublication {
  return { ...summary(row), embargoUntil: typeof row.embargo_until === 'string' ? row.embargo_until : null, isPremium: row.is_premium === true };
}

/** The executor seam permits exact SQL tests against an isolated fixture only. */
export function createEditorialRepository(execute: (statement: SQL) => Promise<Record<string, unknown>[]>) {
function audited(statement: SQL, actor: string, operation: EditorialAuditEntry['operation'], previousRevision: string | null) {
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(actor)) throw new Error('Invalid editorial actor.');
  return sql`with changed as (${statement}), recorded as (
    insert into editorial_audit (article_id, actor, operation, previous_revision, revision, publication)
    select id, ${actor}, ${operation}, ${previousRevision}::text::timestamptz, revision::timestamptz,
      jsonb_build_object('status', status, 'visibility', visibility, 'publishedAt', published_at,
        'embargoUntil', embargo_until, 'isPremium', is_premium) from changed
    returning id
  ) select * from changed`;
}
/** Keyset pagination keeps reads bounded without transferring every article body. */
async function listEditorialArticles(limit = 25, cursor?: EditorialCursor): Promise<{ articles: EditorialSummary[]; next: EditorialCursor | null }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (cursor && (!isEditorialId(cursor.id) || !isEditorialRevision(cursor.revision)))) throw new Error('Invalid article pagination.');
  const rows = await execute(sql`select ${SUMMARY} from article
    ${cursor ? sql`where (updated_at, id) < (${cursor.revision}::text::timestamptz, ${cursor.id}::uuid)` : sql``}
    order by updated_at desc, id desc limit ${limit + 1}`);
  const articles = rows.slice(0, limit).map(summary);
  const last = articles.at(-1);
  return { articles, next: rows.length > limit && last ? { id: last.id, revision: last.revision } : null };
}
async function getEditorialArticle(id: string): Promise<EditorialArticle | null> {
  if (!isEditorialId(id)) throw new Error('Invalid article identity.');
  const rows = await execute(sql`select ${SUMMARY}, dek, body_md from article where id = ${id}::uuid limit 1`);
  return rows[0] ? detail(rows[0]) : null;
}
async function getEditorialPublication(id: string): Promise<EditorialPublication | null> {
  if (!isEditorialId(id)) throw new Error('Invalid article identity.');
  const rows = await execute(sql`select ${SUMMARY}, embargo_until::text as embargo_until, is_premium from article where id = ${id}::uuid limit 1`);
  return rows[0] ? publication(rows[0]) : null;
}
async function listEditorialAudit(articleId: string, limit = 25, cursor?: EditorialCursor): Promise<{ entries: EditorialAuditEntry[]; next: EditorialCursor | null }> {
  if (!isEditorialId(articleId) || !Number.isInteger(limit) || limit < 1 || limit > 50 || (cursor && (!isEditorialId(cursor.id) || !isEditorialRevision(cursor.revision)))) throw new Error('Invalid editorial audit page.');
  const rows = await execute(sql`select id, article_id, actor, operation, previous_revision::text as previous_revision,
      revision::text as revision, publication, created_at::text as created_at from editorial_audit
    where article_id = ${articleId}::uuid
      ${cursor ? sql`and (created_at, id) < (${cursor.revision}::text::timestamptz, ${cursor.id}::uuid)` : sql``}
    order by created_at desc, id desc limit ${limit + 1}`);
  const entries: EditorialAuditEntry[] = rows.slice(0, limit).map((row) => ({
    id: String(row.id), articleId: typeof row.article_id === 'string' ? row.article_id : null,
    actor: String(row.actor), operation: row.operation as EditorialAuditEntry['operation'],
    previousRevision: typeof row.previous_revision === 'string' ? row.previous_revision : null,
    revision: String(row.revision), publication: row.publication as Record<string, unknown>, createdAt: String(row.created_at),
  }));
  const last = entries.at(-1);
  return { entries, next: rows.length > limit && last ? { id: last.id, revision: last.createdAt } : null };
}
/** Policy changes have their own explicit contract and never rewrite content. */
async function updateEditorialPublication(id: string, revision: string, patch: EditorialPublicationPatch, actor = 'system'): Promise<EditorialPublication> {
  const keys = Object.keys(patch);
  if (!isEditorialId(id) || !isEditorialRevision(revision) || !keys.length || keys.some((key) => !['publishedAt', 'embargoUntil', 'isPremium'].includes(key)) ||
    (Object.hasOwn(patch, 'publishedAt') && patch.publishedAt !== null && !isEditorialPublicationDate(patch.publishedAt)) ||
    (Object.hasOwn(patch, 'embargoUntil') && patch.embargoUntil !== null && !isEditorialPublicationDate(patch.embargoUntil)) ||
    (Object.hasOwn(patch, 'isPremium') && typeof patch.isPremium !== 'boolean')) throw new Error('Invalid article publication policy.');
  const rows = await execute(audited(sql`update article set
      published_at = ${Object.hasOwn(patch, 'publishedAt') ? sql`${patch.publishedAt}::text::timestamptz` : sql`published_at`},
      embargo_until = ${Object.hasOwn(patch, 'embargoUntil') ? sql`${patch.embargoUntil}::text::timestamptz` : sql`embargo_until`},
      is_premium = ${Object.hasOwn(patch, 'isPremium') ? sql`${patch.isPremium}` : sql`is_premium`},
      updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
    where id = ${id}::uuid and updated_at = ${revision}::text::timestamptz
    returning ${SUMMARY}, embargo_until::text as embargo_until, is_premium`, actor, 'publication', revision));
  if (rows[0]) return publication(rows[0]);
  if (!await getEditorialPublication(id)) throw new EditorialConflict('This article no longer exists.', 404);
  throw new EditorialConflict('This article changed after you opened it. Reload its publication policy before saving.', 409);
}
function derived(input: EditorialInput) {
  const words = input.bodyMd.split(/\s+/).filter(Boolean).length;
  return { excerpt: (input.dek ?? input.bodyMd).slice(0, 200), readTime: Math.max(1, Math.round(words / 200)) };
}
async function createEditorialArticle(input: EditorialInput, id?: string, actor = 'system'): Promise<EditorialArticle> {
  if (id !== undefined && !isEditorialId(id)) throw new Error('Invalid article identity.');
  const { excerpt, readTime } = derived(input);
  const rows = await execute(audited(sql`insert into article (id, slug, title, dek, body_md, section, excerpt, read_time_minutes, published_at)
    values (${id ? sql`${id}::uuid` : sql`gen_random_uuid()`}, ${input.slug}, ${input.title}, ${input.dek}, ${input.bodyMd}, ${input.section}, ${excerpt}, ${readTime},
      ${input.status === 'published' ? sql`clock_timestamp()` : sql`null`})
    returning ${SUMMARY}, dek, body_md, embargo_until::text as embargo_until, is_premium`, actor, 'create', null));
  if (!rows[0]) throw new Error('Article storage returned no confirmation.');
  return detail(rows[0]);
}

/** Immutable URLs, preserved unexposed fields and an atomic compare-and-swap. */
async function updateEditorialArticle(id: string, revision: string, input: EditorialInput, actor = 'system'): Promise<EditorialArticle> {
  if (!isEditorialId(id) || !isEditorialRevision(revision)) throw new Error('Invalid article revision.');
  const { excerpt, readTime } = derived(input);
  const rows = await execute(audited(sql`update article set title = ${input.title}, dek = ${input.dek}, body_md = ${input.bodyMd},
      section = ${input.section}, excerpt = ${excerpt}, read_time_minutes = ${readTime},
      published_at = ${input.status === 'published' ? sql`coalesce(published_at, clock_timestamp())` : sql`null`},
      updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
    where id = ${id}::uuid and updated_at = ${revision}::text::timestamptz and slug = ${input.slug}
      and not is_premium and (embargo_until is null or embargo_until <= clock_timestamp())
      and (published_at is null or published_at <= clock_timestamp())
    returning ${SUMMARY}, dek, body_md, embargo_until::text as embargo_until, is_premium`, actor, 'update', revision));
  if (rows[0]) return detail(rows[0]);
  const current = await getEditorialArticle(id);
  if (!current) throw new EditorialConflict('This article no longer exists.', 404);
  if (!current.editable) throw new EditorialConflict('This console cannot change scheduled, embargoed or premium articles.', 409);
  if (current.slug !== input.slug) throw new EditorialConflict('An existing article URL cannot be changed.', 409);
  throw new EditorialConflict('This article changed after you opened it. Reload it before saving; your text has not been overwritten.', 409);
}
return { listEditorialArticles, getEditorialArticle, createEditorialArticle, updateEditorialArticle, getEditorialPublication, updateEditorialPublication, listEditorialAudit };
}

function repository() { return createEditorialRepository(async (statement) => database().execute(statement)); }
export async function listEditorialArticles(limit = 25, cursor?: EditorialCursor) { return repository().listEditorialArticles(limit, cursor); }
export async function getEditorialArticle(id: string) { return repository().getEditorialArticle(id); }
export async function createEditorialArticle(input: EditorialInput, id?: string, actor = 'system') { return repository().createEditorialArticle(input, id, actor); }
export async function updateEditorialArticle(id: string, revision: string, input: EditorialInput, actor = 'system') { return repository().updateEditorialArticle(id, revision, input, actor); }
export async function getEditorialPublication(id: string) { return repository().getEditorialPublication(id); }
export async function updateEditorialPublication(id: string, revision: string, patch: EditorialPublicationPatch, actor = 'system') { return repository().updateEditorialPublication(id, revision, patch, actor); }
export async function listEditorialAudit(articleId: string, limit = 25, cursor?: EditorialCursor) { return repository().listEditorialAudit(articleId, limit, cursor); }
