import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { test } from 'node:test';
import { createPredictionIdentity, readPredictionIdentity, predictionCookieSecret } from './prediction-identity';
import { scorePicks, type ScoringRaceResult } from './prediction-scoring';
import { databaseConnectionOptions } from './client';
import { SUPABASE_ROOT_CA } from './supabase-ca';
import { jolpicaResultIdentity } from './ingestion';
import { upsertPrediction, setPredictionScores } from './predictions';
import { persistCurrentSeason } from './seed';
import { persistVideos } from './videos';
import { reserveNewsletterEdition } from './newsletter';

const secret = 'offline-test-secret-with-at-least-32-bytes';
const results: ScoringRaceResult[] = [
  { position: '1', Driver: { driverId: 'winner' } },
  { position: '2', Driver: { driverId: 'second' }, FastestLap: { rank: '1' } },
  { position: '3', Driver: { driverId: 'third' } },
];
const qualifying = [{ position: '1', Driver: { driverId: 'third' } }];

test('signed anonymous identity survives refresh while forged and unsigned IDs are rejected', () => {
  const created = createPredictionIdentity(secret);
  assert.equal(readPredictionIdentity(created.token, secret), created.id);
  assert.equal(createPredictionIdentity(secret, created.token).id, created.id);
  assert.equal(readPredictionIdentity(created.id, secret), null);
  assert.equal(readPredictionIdentity(`${created.token}x`, secret), null);
  assert.equal(readPredictionIdentity(`${created.token}!`, secret), null);
  assert.equal(readPredictionIdentity(created.token, `${secret}other`), null);
  assert.equal(readPredictionIdentity(`v1.__proto__.bad`, secret), null);
  assert.equal(readPredictionIdentity('x'.repeat(129), secret), null);
  assert.notEqual(createPredictionIdentity(secret, created.id).id, created.id);
});
test('prediction signing refuses an absent or weak application secret', () => {
  const previous = process.env.PREDICTION_COOKIE_SECRET;
  try {
    delete process.env.PREDICTION_COOKIE_SECRET;
    assert.throws(predictionCookieSecret);
    process.env.PREDICTION_COOKIE_SECRET = 'short';
    assert.throws(predictionCookieSecret);
  } finally { if (previous === undefined) delete process.env.PREDICTION_COOKIE_SECRET; else process.env.PREDICTION_COOKIE_SECRET = previous; }
});
test('complete official classifications award all 13 points including any podium member', () => {
  assert.equal(scorePicks({ pole: 'third', winner: 'winner', podium: 'second', fastest_lap: 'second' }, results, qualifying)?.total, 13);
  assert.equal(scorePicks({}, results, qualifying)?.total, 0);
});
test('missing qualifying, podium or fastest-lap evidence remains pending', () => {
  assert.equal(scorePicks({}, results, []), null);
  assert.equal(scorePicks({}, results.slice(0, 2), qualifying), null);
  assert.equal(scorePicks({}, results.map((r) => ({ ...r, FastestLap: undefined })), qualifying), null);
});
test('duplicate driver, pole and fastest-lap classifications remain pending', () => {
  assert.equal(scorePicks({}, [...results, results[0]!], qualifying), null);
  assert.equal(scorePicks({}, results, [...qualifying, qualifying[0]!]), null);
  assert.equal(scorePicks({}, results.map((r) => ({ ...r, FastestLap: { rank: '1' } })), qualifying), null);
});
test('database TLS verifies its chain and bounds pools without modifying global trust', () => {
  const previous = process.env.DATABASE_SSL_CA_PATH;
  const globalTrust = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    delete process.env.DATABASE_SSL_CA_PATH;
    const opts = databaseConnectionOptions('postgresql://audit:example@aws-0-test.pooler.supabase.com:6543/postgres');
    assert.equal(opts.ssl.rejectUnauthorized, true);
    assert.equal(opts.ssl.ca, SUPABASE_ROOT_CA);
    assert.equal(opts.max, 1);
    assert.equal(opts.prepare, false);
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, globalTrust);
    assert.equal(databaseConnectionOptions('postgresql://audit@example.com/test').ssl.ca, undefined);
    assert.equal(databaseConnectionOptions('postgresql://audit@supabase.com.evil.invalid/test').ssl.ca, undefined);
    process.env.DATABASE_SSL_CA_PATH = 'relative/ca.pem';
    assert.throws(() => databaseConnectionOptions('postgresql://audit@example.com/test'), /absolute path/);
  } finally { if (previous === undefined) delete process.env.DATABASE_SSL_CA_PATH; else process.env.DATABASE_SSL_CA_PATH = previous; }
});
test('bundled public Supabase CA matches the reviewed official certificate fingerprint', () => {
  assert.equal(new X509Certificate(SUPABASE_ROOT_CA).fingerprint256.replaceAll(':', ''), '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA');
});
test('result source IDs stay stable across classification corrections and reject ambiguous historic entries', () => {
  const initial = jolpicaResultIdentity(2026, 1, ['driver_a', 'driver_b']);
  const reversed = jolpicaResultIdentity(2026, 1, ['driver_b', 'driver_a']);
  assert.deepEqual(initial.get('driver_a'), reversed.get('driver_a'));
  assert.throws(() => jolpicaResultIdentity(1978, 14, ['ertl', 'ertl']), /archive source IDs/);
});
test('all external persistence entry points fail before any connection when DB is absent', async () => {
  const previous = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    await assert.rejects(upsertPrediction({ clientId: 'offline', season: 2026, round: 1, raceSlug: 'test', picks: { winner: 'driver' }, lockAt: new Date(Date.now() + 1000) }), /not configured/);
    await assert.rejects(setPredictionScores([]), /not configured/);
    await assert.rejects(persistCurrentSeason(2026, [], [], { driverRound: null, teamRound: null }), /not configured/);
    await assert.rejects(persistVideos([]), /not configured/);
    await assert.rejects(reserveNewsletterEdition('offline:test'), /not configured/);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});
