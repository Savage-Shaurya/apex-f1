import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDb, getDb } from './client';
import { predictionSourceVersion, scorePendingPredictionsForRace, setPredictionScores, type PredictionScoreUpdate } from './predictions';
import type { PredictionPicks } from './schema';

/** Exercises actual Drizzle serialization without creating a network connection. */
test('stale graders cannot replace an intervening grade and conflicts are distinct from pending picks', async () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousCa = process.env.DATABASE_SSL_CA_PATH;
  process.env.DATABASE_URL = 'postgresql://offline-fixture@audit.invalid/never-connected';
  delete process.env.DATABASE_SSL_CA_PATH;
  const client = getDb().$client;
  const originalUnsafe = client.unsafe;
  const originalBegin = client.begin;
  const picks: PredictionPicks = { winner: 'winner' };
  const updatedAt = '2026-01-01 10:20:30.123456+00';
  const row = { id: '10000000-0000-4000-8000-000000000001', clientId: 'synthetic-client', picks, score: null as number | null, updatedAt, scoreSourceVersion: null as string | null };
  let interleaveGrade = false;
  let reads = 0;
  let acceptedHash = '';
  const observation = { source: 'jolpica', scope: 'classification:2026:1', generation: '1', observationId: '90000000-0000-4000-8000-000000000001' };
  const statements: { query: string; parameters: unknown[] }[] = [];

  Reflect.set(client, 'unsafe', (query: string, parameters: unknown[] = []) => {
    // Transaction-local timeouts (bounded-transaction.ts) open every transaction; no fixture state.
    if (/^select set_config\('statement_timeout'/.test(query)) { const none = Promise.resolve([]); return Object.assign(none, { values: () => none }); }
    statements.push({ query, parameters });
    let rows: Record<string, unknown>[];
    if (/^\s*update prediction p/.test(query)) {
      assert.match(query, /p\.score_source_version IS NOT DISTINCT FROM v\.previous_version/);
      assert.match(query, /as v\(id, score, picks, updated_at, previous_version, version\)/);
      assert.match(query, /p\.updated_at = v\.updated_at and p\.picks = v\.picks/);
      assert.equal(parameters.length % 6, 0);
      if (interleaveGrade) {
        row.score = 13;
        row.scoreSourceVersion = 'intervening-official-correction';
        interleaveGrade = false;
      }
      rows = [];
      for (let offset = 0; offset < parameters.length; offset += 6) {
        const [id, score, expectedPicks, expectedUpdatedAt, expectedVersion, version] = parameters.slice(offset, offset + 6);
        if (row.id === id && JSON.stringify(row.picks) === expectedPicks && row.updatedAt === expectedUpdatedAt && row.scoreSourceVersion === expectedVersion) {
          row.score = score as number;
          row.scoreSourceVersion = version as string;
          rows.push({ id: row.id });
        }
      }
    } else if (/^select generation/.test(query)) {
      rows = [{ generation: '1' }];
    } else if (/^select content_hash/.test(query)) {
      rows = [{ content_hash: acceptedHash, applied_observation_id: observation.observationId, details: {} }];
    } else if (/^select count/.test(query)) {
      rows = [{ pending: row.score === null ? 1 : 0, deferred: row.scoreSourceVersion === acceptedHash ? 0 : 1 }];
    } else if (/^update source_snapshot/.test(query)) {
      rows = [];
    } else if (/^select .* from "prediction"/.test(query)) {
      reads++;
      rows = [{ ...row }];
    } else {
      throw new Error('Fixture refuses every statement outside prediction grading.');
    }
    const result = Promise.resolve(rows);
    return Object.assign(result, { values: () => result.then((values) => values.map((value) => Object.values(value))) });
  });
  Reflect.set(client, 'begin', async (callback: (connection: typeof client) => Promise<unknown>) => callback(client));

  const update = (sourceVersion: string, expectedScoreSourceVersion: string | null = null): PredictionScoreUpdate => ({
    id: row.id, score: 5, expectedPicks: { ...picks }, expectedUpdatedAt: updatedAt, expectedScoreSourceVersion, sourceVersion,
  });
  try {
    const oldSnapshot = update('older-official-snapshot');
    assert.equal(await setPredictionScores([update('newer-official-snapshot')]), 1);
    assert.equal(row.scoreSourceVersion, 'newer-official-snapshot');
    assert.equal(await setPredictionScores([oldSnapshot]), 0);
    assert.equal(row.scoreSourceVersion, 'newer-official-snapshot');
    assert.equal(await setPredictionScores([update('reviewed-correction', 'newer-official-snapshot')]), 1);
    assert.equal(await setPredictionScores([{ ...update('stale-picks', 'reviewed-correction'), expectedPicks: { winner: 'other' } }]), 0);
    assert.equal(await setPredictionScores([{ ...update('stale-time', 'reviewed-correction'), expectedUpdatedAt: '2026-01-01 10:20:30.123455+00' }]), 0);
    await assert.rejects(setPredictionScores([{ ...update('missing-previous'), expectedScoreSourceVersion: undefined as unknown as string }]), /Invalid prediction score/);

    row.score = null;
    row.scoreSourceVersion = null;
    interleaveGrade = true;
    const results = [
      { position: '1', Driver: { driverId: 'winner' } },
      { position: '2', Driver: { driverId: 'second' }, FastestLap: { rank: '1' } },
      { position: '3', Driver: { driverId: 'third' } },
    ];
    const qualifying = [{ position: '1', Driver: { driverId: 'third' } }];
    acceptedHash = predictionSourceVersion(2026, 1, results, qualifying);
    await assert.rejects(scorePendingPredictionsForRace(2026, 1, results, qualifying), /accepted classification observation/);
    assert.deepEqual(await scorePendingPredictionsForRace(2026, 1, results, qualifying, { observation }), { graded: 0, pending: 0, conflicted: 1, deferred: 1, nextCursor: null, complete: false });
    assert.equal(row.scoreSourceVersion, 'intervening-official-correction');
    assert.equal(reads, 1, 'Conflict summaries aggregate current scores without rereading every participant.');
    row.score = null;
    row.scoreSourceVersion = null;
    acceptedHash = predictionSourceVersion(2026, 1, results, []);
    assert.deepEqual(await scorePendingPredictionsForRace(2026, 1, results, [], { observation }), { graded: 0, pending: 1, conflicted: 0, deferred: 1, nextCursor: null, complete: false });
    acceptedHash = predictionSourceVersion(2026, 1, results, qualifying);
    assert.deepEqual(await scorePendingPredictionsForRace(2026, 1, results, qualifying, { observation }), { graded: 1, pending: 0, conflicted: 0, deferred: 0, nextCursor: null, complete: true });
    assert.match(statements.find((statement) => /^select .* from "prediction"/.test(statement.query))!.query, /order by "prediction"\."id"(?: asc)? limit/);
    await assert.rejects(setPredictionScores(Array.from({ length: 501 }, () => update('bounded'))), /bounded to 500/);
    assert.equal(statements.some((statement) => statement.query.includes('newer-official-snapshot')), false, 'Source versions remain bound SQL parameters.');
  } finally {
    Reflect.set(client, 'unsafe', originalUnsafe);
    Reflect.set(client, 'begin', originalBegin);
    await closeDb();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousCa === undefined) delete process.env.DATABASE_SSL_CA_PATH; else process.env.DATABASE_SSL_CA_PATH = previousCa;
  }
});
