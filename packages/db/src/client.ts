import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { SUPABASE_ROOT_CA } from './supabase-ca';
import * as schema from './schema';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _client: ReturnType<typeof postgres> | null = null;
let _workerDb: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _workerClient: ReturnType<typeof postgres> | null = null;

/** TLS is verified per connection; custom CAs never modify system trust. */
export function databaseConnectionOptions(url: string) {
  let hostname: string;
  try { hostname = new URL(url).hostname; } catch { throw new Error('Invalid database connection URL.'); }
  const caPath = process.env.DATABASE_SSL_CA_PATH;
  if (caPath && !isAbsolute(caPath)) throw new Error('DATABASE_SSL_CA_PATH must be an absolute path.');
  const ca = caPath ? readFileSync(caPath, 'utf8') : /(?:^|\.)supabase\.(?:com|co)$/.test(hostname) ? SUPABASE_ROOT_CA : undefined;
  return { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 20, max_lifetime: 1800,
    connection: { statement_timeout: 15_000, lock_timeout: 5_000, idle_in_transaction_session_timeout: 15_000 },
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

export function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL not set. Set it from your Supabase project connection string.');
  }
  _client = postgres(url, databaseConnectionOptions(url));
  _db = drizzle(_client, { schema });
  return _db;
}

/** Privileged jobs choose their separately provisioned non-owner connection. */
export function getWorkerDb() {
  if (_workerDb) return _workerDb;
  const url = process.env.DATABASE_WORKER_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.VERCEL_ENV) throw new Error('DATABASE_WORKER_URL is required for deployed persistence jobs.');
    return getDb();
  }
  _workerClient = postgres(url, databaseConnectionOptions(url));
  _workerDb = drizzle(_workerClient, { schema });
  return _workerDb;
}

/** CLI workers close their pool; request handlers keep the bounded singleton. */
export async function closeDb(): Promise<void> {
  const client = _client;
  const workerClient = _workerClient;
  _client = null;
  _db = null;
  _workerClient = null;
  _workerDb = null;
  if (client) await client.end({ timeout: 5 });
  if (workerClient) await workerClient.end({ timeout: 5 });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
