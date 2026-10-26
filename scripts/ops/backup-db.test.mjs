import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backupKeys,
  isoWeekKey,
  planRetention,
  buildManifest,
  validateManifest,
  parseRestoreList,
  pgEnvironmentFromUrl,
  redactSecrets,
} from './backup-db.mjs';

const SHA = 'a'.repeat(64);

test('backup keys use the UTC date for daily and the ISO week for weekly copies', () => {
  assert.deepEqual(backupKeys(new Date('2026-10-26T03:30:00Z')), {
    date: '2026-10-26',
    daily: 'daily/2026-10-26.dump',
    dailyChecksum: 'daily/2026-10-26.dump.sha256',
    weekly: 'weekly/2026-W44.dump',
    weeklyChecksum: 'weekly/2026-W44.dump.sha256',
  });
  // Late evening in a western zone is already the next UTC day.
  assert.equal(backupKeys(new Date('2026-12-31T23:59:59-05:00')).date, '2027-01-01');
});

test('ISO week keys handle year boundaries and 53-week years', () => {
  assert.equal(isoWeekKey(new Date('2027-01-01T00:00:00Z')), '2026-W53');
  assert.equal(isoWeekKey(new Date('2024-12-30T12:00:00Z')), '2025-W01');
  assert.equal(isoWeekKey(new Date('2026-01-04T12:00:00Z')), '2026-W01');
  assert.equal(isoWeekKey(new Date('2026-01-05T00:00:00Z')), '2026-W02');
});

function days(count, start = '2026-10-01') {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.parse(start + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    out.push(`daily/${d}.dump`, `daily/${d}.dump.sha256`);
  }
  return out;
}

test('retention keeps the newest 14 daily dumps and deletes older dumps with their checksums', () => {
  const names = days(20); // 2026-10-01 .. 2026-10-20
  const plan = planRetention(names);
  const deletedDumps = plan.delete.filter(name => name.endsWith('.dump'));
  assert.deepEqual(deletedDumps, [
    'daily/2026-10-01.dump', 'daily/2026-10-02.dump', 'daily/2026-10-03.dump',
    'daily/2026-10-04.dump', 'daily/2026-10-05.dump', 'daily/2026-10-06.dump',
  ]);
  for (const dump of deletedDumps) assert.ok(plan.delete.includes(dump + '.sha256'));
  assert.equal(plan.keep.filter(name => name.startsWith('daily/') && name.endsWith('.dump')).length, 14);
  assert.ok(plan.keep.includes('daily/2026-10-20.dump'));
  assert.ok(plan.keep.includes('daily/2026-10-07.dump.sha256'));
});

test('retention keeps the newest 8 weekly dumps across a year boundary', () => {
  const weeks = ['2026-W45', '2026-W46', '2026-W47', '2026-W48', '2026-W49', '2026-W50', '2026-W51', '2026-W52', '2026-W53', '2027-W01'];
  const names = weeks.flatMap(w => [`weekly/${w}.dump`, `weekly/${w}.dump.sha256`]);
  const plan = planRetention(names);
  assert.deepEqual(plan.delete.sort(), [
    'weekly/2026-W45.dump', 'weekly/2026-W45.dump.sha256',
    'weekly/2026-W46.dump', 'weekly/2026-W46.dump.sha256',
  ]);
  assert.ok(plan.keep.includes('weekly/2027-W01.dump'));
});

test('retention never deletes unknown files, the manifest, or a protected object', () => {
  const names = [...days(16), 'latest.json', 'daily/notes.txt', 'daily/2026-13-99.dump', 'other/2020-01-01.dump'];
  const plan = planRetention(names, { protect: ['daily/2026-10-01.dump'] });
  for (const name of ['latest.json', 'daily/notes.txt', 'daily/2026-13-99.dump', 'other/2020-01-01.dump', 'daily/2026-10-01.dump']) {
    assert.equal(plan.delete.includes(name), false, name);
  }
  assert.deepEqual(plan.delete.filter(n => n.endsWith('.dump')), ['daily/2026-10-02.dump']);
});

test('an orphan checksum is only deleted when its dump is gone and it is outside retention', () => {
  const plan = planRetention(['daily/2026-01-01.dump.sha256', ...days(14)]);
  assert.deepEqual(plan.delete, ['daily/2026-01-01.dump.sha256']);
});

test('retention limits are configurable but must be positive integers', () => {
  const plan = planRetention(days(5), { keepDaily: 2 });
  assert.equal(plan.delete.filter(n => n.endsWith('.dump')).length, 3);
  assert.throws(() => planRetention([], { keepDaily: 0 }), /positive/);
  assert.throws(() => planRetention([], { keepWeekly: 1.5 }), /positive/);
});

const manifestInput = {
  createdAt: '2026-10-26T03:30:12.000Z',
  projectRef: 'fikqugdusgwzfxviquby',
  bucket: 'apex-backups',
  object: 'daily/2026-10-26.dump',
  weeklyObject: 'weekly/2026-W44.dump',
  bytes: 123456,
  sha256: SHA,
  pgDumpVersion: '17.7',
  serverVersion: '17.11',
  schemas: ['public', 'drizzle'],
  publicTables: 35,
  tableDataEntries: 39,
};

test('manifest is built with format, retention and verification fields', () => {
  const manifest = buildManifest(manifestInput);
  assert.equal(manifest.schema, 'apex-backup-manifest/1');
  assert.equal(manifest.format, 'pg_dump-custom');
  assert.deepEqual(manifest.retention, { daily: 14, weekly: 8 });
  assert.equal(manifest.object, 'daily/2026-10-26.dump');
  assert.equal(manifest.checksumObject, 'daily/2026-10-26.dump.sha256');
  assert.equal(manifest.sha256, SHA);
  assert.equal(validateManifest(manifest), manifest);
  // Round trip through JSON stays valid.
  assert.deepEqual(validateManifest(JSON.parse(JSON.stringify(manifest))), manifest);
});

test('manifest validation rejects bad checksums, sizes, keys and secret-looking content', () => {
  assert.throws(() => buildManifest({ ...manifestInput, sha256: 'xyz' }), /sha256/);
  assert.throws(() => buildManifest({ ...manifestInput, bytes: 0 }), /bytes/);
  assert.throws(() => buildManifest({ ...manifestInput, object: '../etc/passwd' }), /object/);
  assert.throws(() => buildManifest({ ...manifestInput, publicTables: 34, expectedPublicTables: 35 }), /tables/);
  assert.throws(() => buildManifest({ ...manifestInput, serverVersion: 'postgresql://u:p@h/db' }), /secret/);
  assert.throws(() => validateManifest({ ...buildManifest(manifestInput), schema: 'other' }), /schema/);
});

const LIST = `;
; Archive created at 2026-10-26 03:30:12 UTC
;     dbname: postgres
;     TOC Entries: 512
;     Compression: gzip
;     Dump Version: 1.16-0
;     Format: CUSTOM
;     Integer: 4 bytes
;     Offset: 8 bytes
;     Dumped from database version: 17.11
;     Dumped by pg_dump version: 17.7
;
;
; Selected TOC Entries:
;
5; 2615 17000 SCHEMA - drizzle apex_owner
300; 1259 17010 TABLE public race apex_owner
301; 1259 17011 TABLE public "driver" apex_owner
302; 1259 17012 TABLE drizzle __drizzle_migrations apex_owner
303; 1259 17013 SEQUENCE public race_id_seq apex_owner
4000; 0 17010 TABLE DATA public race apex_owner
4001; 0 17011 TABLE DATA public "driver" apex_owner
4002; 0 17012 TABLE DATA drizzle __drizzle_migrations apex_owner
4003; 0 0 POLICY public race race_read apex_owner
`;

test('restore list parsing counts tables and data entries and reads versions', () => {
  assert.deepEqual(parseRestoreList(LIST), {
    publicTables: 2,
    tables: 3,
    tableDataEntries: 3,
    policies: 1,
    dumpedFrom: '17.11',
    dumpedBy: '17.7',
    format: 'CUSTOM',
  });
  assert.throws(() => parseRestoreList('garbage'), /archive/);
});

test('database URL becomes libpq environment with verified TLS and no URL on the command line', () => {
  const env = pgEnvironmentFromUrl('postgresql://apex_owner.ref:p%40ss@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full', '/tmp/ca.crt');
  assert.deepEqual(env, {
    PGHOST: 'aws-0-ap-northeast-2.pooler.supabase.com',
    PGPORT: '5432',
    PGUSER: 'apex_owner.ref',
    PGPASSWORD: 'p@ss',
    PGDATABASE: 'postgres',
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: '/tmp/ca.crt',
    PGCONNECT_TIMEOUT: '20',
    PGAPPNAME: 'apex-backup',
  });
  assert.throws(() => pgEnvironmentFromUrl('mysql://a:b@h/db', '/ca'), /postgres/);
  assert.throws(() => pgEnvironmentFromUrl('postgresql://a@h:5432/db', '/ca'), /password/);
  assert.throws(() => pgEnvironmentFromUrl('postgresql://a:b@h:6543/db', '/ca'), /6543/);
  assert.throws(() => pgEnvironmentFromUrl('postgresql://a:b@h:5432/db', ''), /CA/);
});

test('redaction removes passwords, keys and connection strings from error text', () => {
  const text = 'connection to postgresql://u:hunter2@db.example.com:5432/postgres failed for key eyJabc.def.ghi and hunter2';
  const out = redactSecrets(text, ['hunter2', 'eyJabc.def.ghi']);
  assert.equal(out.includes('hunter2'), false);
  assert.equal(out.includes('eyJabc'), false);
  assert.equal(out.includes('postgresql://u:'), false);
});
