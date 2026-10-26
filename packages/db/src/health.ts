import { sql } from 'drizzle-orm';
import { getDb, getWorkerDb } from './client';

/** Cheapest possible liveness probe on the web runtime connection: one `select 1`. */
export async function pingDatabase(): Promise<void> {
  await getDb().execute(sql`select 1`);
}

export interface IngestionRunSummary {
  source: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

/**
 * Latest run per source plus the most recent failures, for operators. Bounded
 * (sources seen in the last 14 days; 10 failures) and never returns item payloads.
 * Uses the jobs role: the least-privileged web role cannot read ingestion_run.
 */
export async function recentIngestionSummary(): Promise<{ latest: IngestionRunSummary[]; failures: (IngestionRunSummary & { error: string | null })[] }> {
  const db = getWorkerDb();
  const latest = await db.execute(sql`
    select distinct on (source) source, status, started_at, ended_at
    from ingestion_run
    where started_at > now() - interval '14 days'
    order by source, started_at desc
    limit 50`);
  const failures = await db.execute(sql`
    select source, status, started_at, ended_at, left(error, 300) as error
    from ingestion_run
    where status = 'failed'
    order by started_at desc
    limit 10`);
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);
  type Row = Record<string, unknown>;
  const shape = (row: Row): IngestionRunSummary => ({ source: String(row.source), status: String(row.status), startedAt: iso(row.started_at)!, endedAt: iso(row.ended_at) });
  return {
    latest: (latest as unknown as Row[]).map(shape),
    failures: (failures as unknown as Row[]).map((row) => ({ ...shape(row), error: row.error === null || row.error === undefined ? null : String(row.error) })),
  };
}
