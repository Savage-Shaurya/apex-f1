/**
 * Real-PostgreSQL release smoke (BE-4, with BE-3 and BE-10 coverage).
 *
 * Runs only against a disposable loopback server over verified TLS:
 *   APEX_CI_PG_ADMIN_URL  postgres superuser URL on 127.0.0.1/localhost (e.g. the CI container)
 *   APEX_CI_PG_CA_PATH    absolute path to the CA (self-signed cert) that server presents
 *
 * It recreates database `apex_ci` and the four Apex roles with random
 * passwords, simulates the Supabase template (default ACLs to browser roles, a
 * SECURITY DEFINER event trigger), then applies, in release order:
 *   security/supabase/0000_template_reconcile.sql -> Drizzle journal (as apex_owner)
 *   -> security/0005_fresh_runtime_roles.sql -> security/0006_role_session_timeouts.sql
 * and checks every guard, the per-role privilege matrix (allowed and 42501
 * denied) and the real @apex/db SQL paths: job leases, cron run records,
 * fenced video snapshots, the /video saved-copy reader, classification
 * progress and transaction-local timeouts. Nothing here can reach a hosted
 * database: non-loopback hosts are refused before connecting.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const ADMIN_URL = process.env.APEX_CI_PG_ADMIN_URL ?? '';
const CA_PATH = process.env.APEX_CI_PG_CA_PATH ?? '';
const DATABASE = 'apex_ci';
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

function loopbackUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('APEX_CI_PG_ADMIN_URL is not a valid URL.'); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Refusing a non-loopback database host: this smoke only runs against a disposable local server.');
  return url;
}
const admin = loopbackUrl(ADMIN_URL);
if (!CA_PATH || !isAbsolute(CA_PATH)) throw new Error('APEX_CI_PG_CA_PATH must be the absolute path of the test server CA.');
const ca = readFileSync(CA_PATH, 'utf8');
const tls = { rejectUnauthorized: true, ca };
const connect = (url: URL | string, extra: Record<string, unknown> = {}) => postgres(String(url), { max: 1, prepare: false, ssl: tls, onnotice: () => undefined, ...extra });
const urlFor = (user: string, password: string, database = DATABASE) => {
  const url = new URL(admin.toString());
  url.username = user; url.password = password; url.pathname = `/${database}`;
  return url;
};

type Case = { label: string; ok: boolean; detail?: string };
const cases: Case[] = [];
async function expectOk(label: string, run: () => Promise<unknown>): Promise<void> {
  try { await run(); cases.push({ label, ok: true }); }
  catch (error) { cases.push({ label, ok: false, detail: `${(error as { code?: string }).code ?? ''} ${(error as Error).message}`.slice(0, 300) }); }
}
async function expectCode(label: string, code: string, run: () => Promise<unknown>, contains?: string): Promise<void> {
  try { await run(); cases.push({ label, ok: false, detail: `expected ${code}, statement succeeded` }); }
  catch (error) {
    const actual = (error as { code?: string }).code;
    const message = (error as Error).message;
    const ok = actual === code && (!contains || message.includes(contains));
    cases.push({ label, ok, ...(ok ? {} : { detail: `expected ${code}${contains ? ` (${contains})` : ''}, got ${actual}: ${message}`.slice(0, 300) }) });
  }
}
function expectEqual(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  cases.push({ label, ok, ...(ok ? {} : { detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` }) });
}
const file = (path: string) => readFileSync(here(path), 'utf8');
/** One connection, release setting selected, whole reviewed file as one simple-protocol script. */
async function applyScript(url: URL, setting: string | null, script: string): Promise<void> {
  const sql = connect(url);
  try {
    if (setting) await sql.unsafe(setting).simple();
    await sql.unsafe(script).simple();
  } finally { await sql.end({ timeout: 5 }); }
}

const passwords = Object.fromEntries(['apex_owner', 'apex_runtime', 'apex_worker', 'apex_public'].map((role) => [role, randomBytes(24).toString('hex')]));

async function provision(): Promise<void> {
  const root = connect(admin);
  try {
    await root.unsafe(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    for (const role of ['apex_runtime', 'apex_worker', 'apex_public', 'apex_owner']) await root.unsafe(`DROP ROLE IF EXISTS ${role}`);
    // Supabase's own roles, as the template has them.
    for (const role of ['supabase_admin', 'anon', 'authenticated', 'service_role']) {
      const exists = await root`select 1 from pg_roles where rolname = ${role}`;
      if (!exists.length) await root.unsafe(`CREATE ROLE ${role} NOLOGIN`);
    }
    await root.unsafe(`CREATE ROLE apex_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '${passwords.apex_owner}'`);
    for (const role of ['apex_runtime', 'apex_worker', 'apex_public']) await root.unsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '${passwords[role]}'`);
    await root.unsafe(`CREATE DATABASE ${DATABASE}`);
  } finally { await root.end({ timeout: 5 }); }
  const template = connect(urlFor(admin.username, decodeURIComponent(admin.password)));
  try {
    await template.unsafe(`
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
      CREATE EVENT TRIGGER ensure_rls ON ddl_command_end EXECUTE FUNCTION public.rls_auto_enable();
    `).simple();
  } finally { await template.end({ timeout: 5 }); }
}

async function main(): Promise<void> {
  await provision();
  const adminDb = urlFor(admin.username, decodeURIComponent(admin.password));
  const owner = urlFor('apex_owner', passwords.apex_owner!);
  const reconcile = file('../security/supabase/0000_template_reconcile.sql');
  const reconcileRelease = "SET apex.supabase_template_release = '2026-10-26-supabase-template'";

  // BE-3: the Supabase template reconcile, guards first.
  await expectCode('reconcile refuses without its release setting', 'P0001', () => applyScript(adminDb, null, reconcile), 'Select the explicitly reviewed');
  {
    const sql = connect(adminDb);
    await sql.unsafe('CREATE TABLE public.leftover (id int)');
    await sql.end({ timeout: 5 });
    await expectCode('reconcile refuses a public schema that holds anything', 'P0001', () => applyScript(adminDb, reconcileRelease, reconcile), 'public is not empty');
    const cleanup = connect(adminDb);
    await cleanup.unsafe('DROP TABLE public.leftover');
    await cleanup.end({ timeout: 5 });
  }
  await expectOk('reconcile removes template default ACLs and the SECURITY DEFINER trigger', () => applyScript(adminDb, reconcileRelease, reconcile));
  {
    const sql = connect(adminDb);
    const [state] = await sql`select
      (select count(*)::int from pg_default_acl where defaclnamespace = 'public'::regnamespace) as default_acls,
      (select count(*)::int from pg_event_trigger where evtname = 'ensure_rls') as triggers,
      (select nspowner::regrole::text from pg_namespace where nspname = 'public') as owner,
      has_schema_privilege('anon', 'public', 'USAGE') as anon_usage`;
    expectEqual('reconciled schema: owner apex_owner, no default ACLs, no trigger, no anon usage', state, { default_acls: 0, triggers: 0, owner: 'apex_owner', anon_usage: false });
    await sql.end({ timeout: 5 });
  }

  // Migrations through the real Drizzle migrator, as the migration owner.
  await expectOk('Drizzle journal applies as apex_owner', async () => {
    const client = connect(owner);
    try { await migrate(drizzle(client), { migrationsFolder: here('../migrations') }); }
    finally { await client.end({ timeout: 5 }); }
  });

  // 0005 guard and release.
  const roles = file('../security/0005_fresh_runtime_roles.sql');
  await expectCode('0005 refuses without its release setting', 'P0001', () => applyScript(owner, null, roles), 'Select the explicitly reviewed');
  await expectOk('0005 fresh runtime roles apply after the reconcile (Supabase-shaped catalog)', () => applyScript(owner, "SET apex.fresh_database_release = '2026-10-04-empty-install'", roles));

  // BE-10: role session timeouts.
  const timeouts = file('../security/0006_role_session_timeouts.sql');
  await expectCode('0006 refuses without its release setting', 'P0001', () => applyScript(adminDb, null, timeouts), 'Select the explicitly reviewed');
  await expectOk('0006 role session timeouts apply', () => applyScript(adminDb, "SET apex.role_timeouts_release = '2026-10-26-role-timeouts'", timeouts));

  const runtime = connect(urlFor('apex_runtime', passwords.apex_runtime!));
  const worker = connect(urlFor('apex_worker', passwords.apex_worker!));
  const publicRole = connect(urlFor('apex_public', passwords.apex_public!));
  try {
    const [settings] = await runtime`select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock, current_setting('idle_in_transaction_session_timeout') as idle`;
    expectEqual('a plain runtime session starts with the role timeouts', settings, { statement: '15s', lock: '5s', idle: '15s' });
    const [workerSettings] = await worker`select current_setting('statement_timeout') as statement`;
    expectEqual('a plain worker session starts with its role timeout', workerSettings, { statement: '30s' });

    // Privilege matrix: allowed and denied, through real logins.
    await expectOk('runtime reads public race facts', () => runtime`select count(*) from race`);
    await expectCode('runtime cannot write race facts', '42501', () => runtime`insert into season (year, status) values (2026, 'active')`);
    await expectCode('runtime cannot read job leases', '42501', () => runtime`select * from job_lease`);
    await expectCode('runtime cannot read the ingestion ledger', '42501', () => runtime`select * from ingestion_run`);
    await expectCode('runtime cannot write prediction scores', '42501', () => runtime`update prediction set score = 1`);
    await expectCode('public role cannot read predictions', '42501', () => publicRole`select * from prediction`);
    await expectCode('public role cannot read the newsletter ledger', '42501', () => publicRole`select * from newsletter_edition`);
    await expectOk('worker writes race facts', () => worker`insert into season (year, status) values (2026, 'active') on conflict (year) do nothing`);
    await expectCode('worker cannot truncate', '42501', () => worker`truncate season`);
    await expectCode('worker cannot create tables', '42501', () => worker.unsafe('create table public.intruder (id int)'));
    await expectCode('worker cannot delete the ingestion ledger', '42501', () => worker`delete from ingestion_run`);
  } finally {
    await Promise.all([runtime.end({ timeout: 5 }), worker.end({ timeout: 5 }), publicRole.end({ timeout: 5 })]);
  }

  // The application's own SQL, through @apex/db with verified TLS.
  process.env.DATABASE_URL = urlFor('apex_runtime', passwords.apex_runtime!).toString();
  process.env.DATABASE_WORKER_URL = urlFor('apex_worker', passwords.apex_worker!).toString();
  process.env.DATABASE_SSL_CA_PATH = CA_PATH;
  const db = await import('../src/index');
  const { sql } = await import('drizzle-orm');
  try {
    const lease = await db.claimJobLease({ key: 'ci-smoke', ttlSeconds: 60 });
    expectEqual('a job lease is claimed', Boolean(lease), true);
    expectEqual('a second claimant is refused while the lease is live', await db.claimJobLease({ key: 'ci-smoke', ttlSeconds: 60 }), null);
    if (lease) {
      expectEqual('the owner renews its lease', Boolean(await db.renewJobLease(lease, 60)), true);
      let runId = '';
      await expectOk('a cron run record opens inside the lease fence', async () => { runId = await db.openIngestionRun(lease, 'cron:ci-smoke'); });
      await expectOk('the cron run record closes with its outcome', () => db.closeIngestionRun(runId, { ok: true }));
      const observation = await db.beginSourceObservation({ source: 'youtube', scope: 'details', ttlSeconds: 60, jobLease: lease });
      const publicVideos = [
        { videoId: 'AAAAAAAAAAA', title: 'Fixture public video', channelName: 'FORMULA 1', publishedAt: '2026-10-24T10:00:00.000Z', durationSeconds: 120, thumbnailUrl: null },
        { videoId: 'BBBBBBBBBBB', title: 'Fixture second video', channelName: 'FORMULA 1', publishedAt: '2026-10-25T10:00:00.000Z', durationSeconds: 60, thumbnailUrl: null },
      ];
      await expectOk('a fenced video snapshot persists', () => db.persistVideoDetailsSnapshot({ observation, requestedVideoIds: ['AAAAAAAAAAA', 'BBBBBBBBBBB'], publicVideos, unavailableVideoIds: [] }));
      const second = await db.beginSourceObservation({ source: 'youtube', scope: 'details', ttlSeconds: 60, jobLease: lease });
      await expectOk('a later snapshot marks a verified video unavailable', () => db.persistVideoDetailsSnapshot({ observation: second, requestedVideoIds: ['BBBBBBBBBBB'], publicVideos: [], unavailableVideoIds: ['BBBBBBBBBBB'] }));
      const stored = await db.listStoredPublicVideos({ limit: 10, channelNames: ['FORMULA 1'] });
      expectEqual('the /video saved copy (runtime role) shows only public videos, newest first', stored.map((video) => video.videoId), ['AAAAAAAAAAA']);
      // Calendar: first write is full, an identical calendar is recorded without rewriting.
      const calendar = [1, 2].map((round) => ({
        circuitId: `fixture_${round}`, circuitName: `Fixture Circuit ${round}`, lat: 1, lon: 2, season: 2026, round,
        slug: `fixture-${round}`, name: `Fixture Grand Prix ${round}`, country: 'Test', city: 'Test',
        raceStartIso: `2026-0${round + 2}-08T13:00:00Z`, sessions: [{ kind: 'Q', iso: `2026-0${round + 2}-07T13:00:00Z` }, { kind: 'R', iso: `2026-0${round + 2}-08T13:00:00Z` }],
      }));
      const first = await db.reconcileRaceCalendar(2026, calendar, await db.beginSourceObservation({ source: 'jolpica', scope: 'calendar:2026', ttlSeconds: 60, jobLease: lease }));
      expectEqual('a new calendar is written in full', [first.racesPersisted, first.calendarUnchanged ?? 0], [2, 0]);
      const again = await db.reconcileRaceCalendar(2026, calendar, await db.beginSourceObservation({ source: 'jolpica', scope: 'calendar:2026', ttlSeconds: 60, jobLease: lease }));
      expectEqual('an identical calendar is recorded without rewriting its rows', [again.racesPersisted, again.calendarUnchanged], [0, 1]);
      const moved = calendar.map((race) => race.round === 2 ? { ...race, raceStartIso: '2026-04-15T13:00:00Z', sessions: [{ kind: 'R', iso: '2026-04-15T13:00:00Z' }] } : race);
      const changed = await db.reconcileRaceCalendar(2026, moved, await db.beginSourceObservation({ source: 'jolpica', scope: 'calendar:2026', ttlSeconds: 60, jobLease: lease }));
      expectEqual('a changed calendar is written in full again', [changed.racesPersisted, changed.calendarUnchanged ?? 0], [2, 0]);
      const runtimeRead = connect(urlFor('apex_runtime', passwords.apex_runtime!));
      const [movedRace] = await runtimeRead`select s.scheduled_start::text as start from session s join race r on r.id = s.race_id where r.season_year = 2026 and r.round = 2 and s.kind = 'R'`;
      await runtimeRead.end({ timeout: 5 });
      expectEqual('the moved race start is stored', String(movedRace?.start ?? '').startsWith('2026-04-15'), true);
      expectEqual('a released lease frees the job', await db.releaseJobLease(lease), true);
      expectEqual('releasing again is refused (no foreign release)', await db.releaseJobLease(lease), false);
    }
    expectEqual('classification progress reads an empty season', await db.listClassifiedRounds(2026), []);
    const [local] = await db.boundedTransaction(db.getDb(), (tx) => tx.execute(sql`select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock`));
    expectEqual('application transactions set their own local timeouts', local, { statement: '15s', lock: '5s' });
  } finally {
    await db.closeDb();
  }

  const failed = cases.filter((item) => !item.ok);
  for (const item of cases) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.label}${item.detail ? ` -- ${item.detail}` : ''}`);
  console.log(`${cases.length - failed.length}/${cases.length} database release checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  // Connection strings never appear: errors carry only their message and SQLSTATE.
  console.error(`Database smoke aborted: ${(error as { code?: string }).code ?? ''} ${(error as Error).message}`);
  process.exitCode = 1;
});
