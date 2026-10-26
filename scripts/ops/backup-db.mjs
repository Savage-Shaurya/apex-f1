#!/usr/bin/env node
// Apex nightly logical backup -> private Supabase Storage bucket.
//
//   node scripts/ops/backup-db.mjs
//
// Required environment (GitHub encrypted secrets in CI, never echoed):
//   SUPABASE_BACKUP_DB_URL     postgresql://<role>.<ref>:<password>@<pooler-host>:5432/postgres
//                              (SESSION pooler, port 5432; the 6543 transaction pooler breaks pg_dump)
//   SUPABASE_URL               https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service key used only for the Storage API
// Optional:
//   SUPABASE_DB_CA_PATH        CA file for the database TLS chain (default: the Supabase root CA bundled in
//                              packages/db/src/supabase-ca.ts). TLS is always sslmode=verify-full.
//   PG_BIN_DIR                 folder holding pg_dump/pg_restore (default: PATH). Client major >= server major.
//   BACKUP_BUCKET              default apex-backups
//   BACKUP_EXPECTED_PUBLIC_TABLES  default 35
//   BACKUP_KEEP_DAILY / BACKUP_KEEP_WEEKLY  default 14 / 8
//
// What it does: pg_dump (custom format, gzip level 9, schemas public + drizzle) over verified TLS ->
// pg_restore --list sanity check (35 public tables) -> SHA-256 -> upload daily/YYYY-MM-DD.dump (+ .sha256)
// and weekly/YYYY-Www.dump (+ .sha256) -> download and re-verify -> latest.json manifest -> prune to the
// newest 14 daily + 8 weekly -> confirm unauthenticated reads fail. Read-only against the database.
// Every failure exits non-zero with a message that has no secrets in it.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_SCHEMA = 'apex-backup-manifest/1';
export const DEFAULT_RETENTION = Object.freeze({ keepDaily: 14, keepWeekly: 8 });
const DAILY_RE = /^daily\/(\d{4}-\d{2}-\d{2})\.dump(\.sha256)?$/;
const WEEKLY_RE = /^weekly\/(\d{4}-W\d{2})\.dump(\.sha256)?$/;
const OBJECT_RE = /^(?:daily\/\d{4}-\d{2}-\d{2}|weekly\/\d{4}-W\d{2})\.dump$/;

// ---------- pure helpers (unit tested) ----------

export function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Mon=1 .. Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this ISO week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function backupKeys(now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const week = isoWeekKey(now);
  return {
    date,
    daily: `daily/${date}.dump`,
    dailyChecksum: `daily/${date}.dump.sha256`,
    weekly: `weekly/${week}.dump`,
    weeklyChecksum: `weekly/${week}.dump.sha256`,
  };
}

function isRealDate(value) {
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

/**
 * Decide which backup objects to delete. Only names that match the strict daily/weekly patterns are ever
 * candidates; anything else (latest.json, notes, other folders, malformed dates) is left alone.
 */
export function planRetention(names, { keepDaily = DEFAULT_RETENTION.keepDaily, keepWeekly = DEFAULT_RETENTION.keepWeekly, protect = [] } = {}) {
  positiveInteger(keepDaily, 'keepDaily');
  positiveInteger(keepWeekly, 'keepWeekly');
  const protectedNames = new Set(protect);
  const keep = [];
  const remove = [];
  const groups = [
    { re: DAILY_RE, limit: keepDaily, valid: isRealDate },
    { re: WEEKLY_RE, limit: keepWeekly, valid: key => Number(key.slice(6)) >= 1 && Number(key.slice(6)) <= 53 },
  ];
  const claimed = new Set();
  for (const group of groups) {
    const dumps = new Map(); // key -> name
    const sidecars = new Map();
    for (const name of names) {
      const match = name.match(group.re);
      if (!match || !group.valid(match[1])) continue;
      claimed.add(name);
      (match[2] ? sidecars : dumps).set(match[1], name);
    }
    const ordered = [...dumps.keys()].sort().reverse(); // newest first (zero-padded keys sort lexically)
    const keptKeys = new Set(ordered.slice(0, group.limit));
    for (const key of ordered) if (protectedNames.has(dumps.get(key))) keptKeys.add(key);
    const oldestKept = [...keptKeys].sort()[0];
    for (const [key, name] of dumps) (keptKeys.has(key) ? keep : remove).push(name);
    for (const [key, name] of sidecars) {
      if (protectedNames.has(name) || keptKeys.has(key)) keep.push(name);
      else if (dumps.has(key)) remove.push(name); // its dump is being deleted
      else if (ordered.length >= group.limit && oldestKept && key < oldestKept) remove.push(name); // stale orphan
      else keep.push(name);
    }
  }
  for (const name of names) if (!claimed.has(name)) keep.push(name);
  return { keep: keep.sort(), delete: remove.sort() };
}

const SECRET_PATTERN = /postgres(?:ql)?:\/\/|eyJ[A-Za-z0-9_-]{10,}|sb_secret_|password/i;

function assertNoSecrets(value) {
  for (const item of Object.values(value)) {
    const text = typeof item === 'string' ? item : JSON.stringify(item);
    if (SECRET_PATTERN.test(text)) throw new Error('Manifest field looks like a secret; refusing to write it.');
  }
}

export function validateManifest(manifest) {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA) throw new Error('Manifest schema is not ' + MANIFEST_SCHEMA + '.');
  if (!/^[0-9a-f]{64}$/.test(manifest.sha256 ?? '')) throw new Error('Manifest sha256 must be 64 lowercase hex characters.');
  if (!Number.isInteger(manifest.bytes) || manifest.bytes < 1) throw new Error('Manifest bytes must be a positive integer.');
  if (!OBJECT_RE.test(manifest.object ?? '') || !manifest.object.startsWith('daily/')) throw new Error('Manifest object must be daily/YYYY-MM-DD.dump.');
  if (manifest.checksumObject !== manifest.object + '.sha256') throw new Error('Manifest checksumObject must sit next to the object.');
  if (manifest.weeklyObject !== undefined && (!OBJECT_RE.test(manifest.weeklyObject) || !manifest.weeklyObject.startsWith('weekly/'))) throw new Error('Manifest weeklyObject must be weekly/YYYY-Www.dump.');
  if (Number.isNaN(Date.parse(manifest.createdAt ?? ''))) throw new Error('Manifest createdAt must be an ISO timestamp.');
  if (!Number.isInteger(manifest.publicTables) || manifest.publicTables < 1) throw new Error('Manifest publicTables must be a positive integer (tables).');
  assertNoSecrets(manifest);
  return manifest;
}

export function buildManifest(input) {
  const { expectedPublicTables, ...rest } = input;
  if (expectedPublicTables !== undefined && rest.publicTables !== expectedPublicTables) {
    throw new Error(`Backup has ${rest.publicTables} public tables, expected ${expectedPublicTables}; refusing to publish it as latest.`);
  }
  const manifest = {
    schema: MANIFEST_SCHEMA,
    createdAt: rest.createdAt,
    projectRef: rest.projectRef,
    bucket: rest.bucket,
    object: rest.object,
    checksumObject: rest.object + '.sha256',
    ...(rest.weeklyObject ? { weeklyObject: rest.weeklyObject } : {}),
    bytes: rest.bytes,
    sha256: rest.sha256,
    format: 'pg_dump-custom',
    compression: 'gzip-9',
    pgDumpVersion: rest.pgDumpVersion,
    serverVersion: rest.serverVersion,
    schemas: [...rest.schemas],
    publicTables: rest.publicTables,
    tableDataEntries: rest.tableDataEntries,
    retention: { daily: rest.keepDaily ?? DEFAULT_RETENTION.keepDaily, weekly: rest.keepWeekly ?? DEFAULT_RETENTION.keepWeekly },
  };
  return validateManifest(manifest);
}

export function parseRestoreList(text) {
  if (!/^;\s+Format: CUSTOM\s*$/m.test(text)) throw new Error('Not a pg_dump custom-format archive listing.');
  const result = { publicTables: 0, tables: 0, tableDataEntries: 0, policies: 0, dumpedFrom: null, dumpedBy: null, format: 'CUSTOM' };
  result.dumpedFrom = text.match(/Dumped from database version: (\S+)/)?.[1] ?? null;
  result.dumpedBy = text.match(/Dumped by pg_dump version: (\S+)/)?.[1] ?? null;
  for (const line of text.split('\n')) {
    const match = line.match(/^\d+; \d+ \d+ (TABLE DATA|TABLE|POLICY) (\S+) /);
    if (!match) continue;
    if (match[1] === 'TABLE') {
      result.tables++;
      if (match[2] === 'public') result.publicTables++;
    } else if (match[1] === 'TABLE DATA') result.tableDataEntries++;
    else result.policies++;
  }
  return result;
}

export function pgEnvironmentFromUrl(databaseUrl, caPath) {
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error('SUPABASE_BACKUP_DB_URL is not a valid postgres URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('SUPABASE_BACKUP_DB_URL must be a postgres:// or postgresql:// URL.');
  if (!url.username || !url.password) throw new Error('SUPABASE_BACKUP_DB_URL must include a user and password.');
  const port = url.port || '5432';
  if (port === '6543') throw new Error('Port 6543 is the transaction pooler; pg_dump needs the session pooler (5432) or a direct connection.');
  if (!caPath) throw new Error('A CA file is required for verified TLS.');
  return {
    PGHOST: url.hostname,
    PGPORT: port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: caPath,
    PGCONNECT_TIMEOUT: '20',
    PGAPPNAME: 'apex-backup',
  };
}

export function redactSecrets(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  return out
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g, '[redacted-jwt]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-key]');
}

// ---------- side-effecting helpers ----------

class BackupError extends Error {}
const fail = message => { throw new BackupError(message); };

function run(tool, args, env, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-8000); });
    child.on('error', error => { clearTimeout(timer); reject(new BackupError(`${path.basename(tool)} could not start (${error.code ?? 'error'}). Install the PostgreSQL client or set PG_BIN_DIR.`)); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: err }); });
  });
}

async function storage(config, method, route, { body, headers = {}, auth = true } = {}) {
  const response = await fetch(`${config.supabaseUrl}/storage/v1${route}`, {
    method,
    headers: { ...(auth ? { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` } : {}), ...headers },
    body,
  });
  return response;
}

async function storageJson(config, method, route, payload, what) {
  const response = await storage(config, method, route, { body: payload === undefined ? undefined : JSON.stringify(payload), headers: payload === undefined ? {} : { 'content-type': 'application/json' } });
  const text = await response.text();
  if (!response.ok) fail(`Storage ${what} failed: HTTP ${response.status} ${redactSecrets(text, [config.serviceKey]).slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function ensurePrivateBucket(config) {
  const response = await storage(config, 'GET', `/bucket/${config.bucket}`);
  if (response.ok) {
    const bucket = await response.json();
    if (bucket.public !== false) fail(`Bucket ${config.bucket} is PUBLIC. Make it private in Supabase Storage before storing backups.`);
    return 'existing';
  }
  await response.text();
  await storageJson(config, 'POST', '/bucket', { id: config.bucket, name: config.bucket, public: false, allowed_mime_types: ['application/octet-stream', 'application/json', 'text/plain'] }, 'bucket create');
  const check = await storageJson(config, 'GET', `/bucket/${config.bucket}`, undefined, 'bucket read');
  if (check.public !== false) fail(`Bucket ${config.bucket} was created but is not private.`);
  return 'created';
}

async function upload(config, key, body, contentType) {
  const response = await storage(config, 'POST', `/object/${config.bucket}/${key}`, { body, headers: { 'content-type': contentType, 'x-upsert': 'true', 'cache-control': 'no-store' } });
  const text = await response.text();
  if (!response.ok) fail(`Upload of ${key} failed: HTTP ${response.status} ${redactSecrets(text, [config.serviceKey]).slice(0, 200)}`);
}

async function download(config, key) {
  const response = await storage(config, 'GET', `/object/authenticated/${config.bucket}/${key}`);
  if (!response.ok) { await response.text(); fail(`Download of ${key} for verification failed: HTTP ${response.status}`); }
  return Buffer.from(await response.arrayBuffer());
}

async function listAll(config) {
  const names = [];
  for (const prefix of ['daily', 'weekly']) {
    for (let offset = 0; ; offset += 1000) {
      const rows = await storageJson(config, 'POST', `/object/list/${config.bucket}`, { prefix: prefix + '/', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }, 'list');
      for (const row of rows) if (row.id) names.push(`${prefix}/${row.name}`); // folders have no id
      if (rows.length < 1000) break;
    }
  }
  return names;
}

async function assertNotPublic(config, key) {
  const results = [];
  for (const route of [`/object/public/${config.bucket}/${key}`, `/object/${config.bucket}/${key}`, `/object/authenticated/${config.bucket}/${key}`]) {
    const response = await storage(config, 'GET', route, { auth: false });
    await response.arrayBuffer();
    results.push(response.status);
    if (response.ok) fail(`SECURITY: unauthenticated GET ${route} returned ${response.status}. The bucket is readable without a key.`);
  }
  return results;
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

async function loadCa(root, tmp) {
  if (process.env.SUPABASE_DB_CA_PATH) {
    await stat(process.env.SUPABASE_DB_CA_PATH).catch(() => fail('SUPABASE_DB_CA_PATH does not point to a readable file.'));
    return process.env.SUPABASE_DB_CA_PATH;
  }
  const source = await readFile(path.join(root, 'packages/db/src/supabase-ca.ts'), 'utf8');
  const pem = source.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0] ?? fail('Bundled Supabase CA not found.');
  const file = path.join(tmp, 'supabase-ca.crt');
  await writeFile(file, pem + '\n', { mode: 0o600 });
  return file;
}

function readConfig() {
  const missing = ['SUPABASE_BACKUP_DB_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(name => !process.env[name]);
  if (missing.length) fail(`Missing required environment variables: ${missing.join(', ')}.`);
  let supabase;
  try { supabase = new URL(process.env.SUPABASE_URL); } catch { fail('SUPABASE_URL is not a valid URL.'); }
  if (supabase.protocol !== 'https:') fail('SUPABASE_URL must be https.');
  const int = (name, fallback) => {
    if (process.env[name] === undefined || process.env[name] === '') return fallback;
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < 1) fail(`${name} must be a positive integer.`);
    return value;
  };
  const bucket = process.env.BACKUP_BUCKET || 'apex-backups';
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket)) fail('BACKUP_BUCKET must be a lowercase bucket id.');
  return {
    databaseUrl: process.env.SUPABASE_BACKUP_DB_URL,
    supabaseUrl: supabase.origin,
    projectRef: supabase.hostname.split('.')[0],
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucket,
    expectedPublicTables: int('BACKUP_EXPECTED_PUBLIC_TABLES', 35),
    keepDaily: int('BACKUP_KEEP_DAILY', DEFAULT_RETENTION.keepDaily),
    keepWeekly: int('BACKUP_KEEP_WEEKLY', DEFAULT_RETENTION.keepWeekly),
    binDir: process.env.PG_BIN_DIR || '',
  };
}

export async function runBackup({ now = new Date(), log = message => console.log(message) } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const config = readConfig();
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'apex-backup-'));
  let secrets = [config.serviceKey];
  try {
    const caPath = await loadCa(root, tmp);
    const pgEnv = pgEnvironmentFromUrl(config.databaseUrl, caPath);
    secrets = [config.serviceKey, pgEnv.PGPASSWORD, config.databaseUrl];
    // Only our own libpq settings reach the client; no inherited PG*/TLS-bypass variables.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key) && !/^(SUPABASE_|NODE_TLS_REJECT_UNAUTHORIZED$|NODE_OPTIONS$)/.test(key)));
    Object.assign(env, pgEnv);
    const tool = name => (config.binDir ? path.join(config.binDir, name) : name);
    const keys = backupKeys(now);

    log(`1/7 bucket: ${await ensurePrivateBucket(config)} private bucket ${config.bucket}`);

    const dumpFile = path.join(tmp, 'apex.dump');
    const dump = await run(tool('pg_dump'), ['--format=custom', '--compress=9', '--schema=public', '--schema=drizzle', '--no-password', '--lock-wait-timeout=60000', `--file=${dumpFile}`], env);
    if (dump.code !== 0) fail(`pg_dump failed (exit ${dump.code}): ${redactSecrets(dump.stderr.trim().split('\n').slice(-4).join(' | '), secrets).slice(0, 600)}`);
    const body = await readFile(dumpFile);
    if (body.length < 1024) fail(`pg_dump produced only ${body.length} bytes.`);
    log(`2/7 pg_dump ok over verify-full TLS: ${body.length} bytes`);

    const list = await run(tool('pg_restore'), ['--list', dumpFile], env);
    if (list.code !== 0) fail(`pg_restore --list could not read the archive (exit ${list.code}).`);
    const toc = parseRestoreList(list.stdout);
    if (toc.publicTables !== config.expectedPublicTables) fail(`Archive has ${toc.publicTables} public tables, expected ${config.expectedPublicTables}.`);
    log(`3/7 archive readable: ${toc.publicTables} public tables, ${toc.tableDataEntries} data entries, ${toc.policies} policies (server ${toc.dumpedFrom}, pg_dump ${toc.dumpedBy})`);

    const digest = sha256(body);
    const checksumLine = Buffer.from(`${digest}  ${path.posix.basename(keys.daily)}\n`);
    await upload(config, keys.daily, body, 'application/octet-stream');
    await upload(config, keys.dailyChecksum, checksumLine, 'text/plain');
    await upload(config, keys.weekly, body, 'application/octet-stream');
    await upload(config, keys.weeklyChecksum, Buffer.from(`${digest}  ${path.posix.basename(keys.weekly)}\n`), 'text/plain');
    log(`4/7 uploaded ${keys.daily} and ${keys.weekly} (sha256 ${digest})`);

    const back = await download(config, keys.daily);
    if (back.length !== body.length || sha256(back) !== digest) fail(`Checksum mismatch after upload of ${keys.daily}.`);
    log('5/7 downloaded copy verified: size and sha256 match');

    const manifest = buildManifest({
      createdAt: now.toISOString(), projectRef: config.projectRef, bucket: config.bucket,
      object: keys.daily, weeklyObject: keys.weekly, bytes: body.length, sha256: digest,
      pgDumpVersion: toc.dumpedBy, serverVersion: toc.dumpedFrom, schemas: ['public', 'drizzle'],
      publicTables: toc.publicTables, tableDataEntries: toc.tableDataEntries,
      expectedPublicTables: config.expectedPublicTables, keepDaily: config.keepDaily, keepWeekly: config.keepWeekly,
    });
    await upload(config, 'latest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), 'application/json');

    const plan = planRetention(await listAll(config), { keepDaily: config.keepDaily, keepWeekly: config.keepWeekly, protect: [keys.daily, keys.dailyChecksum, keys.weekly, keys.weeklyChecksum] });
    if (plan.delete.length) await storageJson(config, 'DELETE', `/object/${config.bucket}`, { prefixes: plan.delete }, 'prune');
    log(`6/7 manifest latest.json written; pruned ${plan.delete.length} old object(s)${plan.delete.length ? ': ' + plan.delete.join(', ') : ''}`);

    const statuses = await assertNotPublic(config, keys.daily);
    log(`7/7 bucket is private: unauthenticated GETs returned ${statuses.join(', ')}`);
    return { manifest, deleted: plan.delete };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBackup().then(
    result => console.log(JSON.stringify({ ok: true, object: result.manifest.object, bytes: result.manifest.bytes, sha256: result.manifest.sha256, publicTables: result.manifest.publicTables, deleted: result.deleted })),
    error => {
      const known = error instanceof BackupError || /must|required|valid|positive|Port 6543|CA file/.test(error.message);
      const secrets = [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_BACKUP_DB_URL];
      try { secrets.push(decodeURIComponent(new URL(process.env.SUPABASE_BACKUP_DB_URL ?? '').password)); } catch { /* no URL */ }
      console.error(`Backup FAILED: ${known ? redactSecrets(error.message, secrets) : 'unexpected ' + (error.name || 'error') + ': ' + redactSecrets(error.message, secrets).slice(0, 300)}`);
      process.exitCode = 1;
    },
  );
}
