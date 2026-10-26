import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Per-build store of validated Jolpica responses shared by every `next build`
 * worker (audit F-01). Without it each of the 14 prerender workers fetched the
 * same calendar and standings itself (one build log: the current standings
 * nine times), so the shared admission queue grew until reads timed out.
 *
 * Only responses that already passed the client's schema checks are stored,
 * only for the life of one build (a fresh directory per build, see
 * next.config.ts), and never at runtime. A worker that finds another worker
 * fetching the same URL waits for its result instead of spending a second
 * request; if that worker gives up, the waiter fetches it itself.
 */
export interface JolpicaBuildStore {
  /** The stored value, or null; when null the caller holds the claim and must write() or release(). */
  claimOrWait(key: string, deadline: number, signal?: AbortSignal): Promise<{ value: unknown } | null>;
  write(key: string, value: unknown): Promise<void>;
  release(key: string): Promise<void>;
}

/** A claim older than this belongs to a worker that died; it is taken over. */
const STALE_CLAIM_MS = 120_000;
const POLL_MS = 200;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function digest(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function createDiskBuildStore(directory: string): JolpicaBuildStore {
  let ready: Promise<unknown> | undefined;
  const ensure = () => (ready ??= mkdir(directory, { recursive: true }).catch(() => undefined));
  const files = (key: string) => {
    const name = digest(key);
    return { data: join(directory, `${name}.json`), claim: join(directory, `${name}.claim`) };
  };
  const readValue = async (key: string): Promise<{ value: unknown } | null> => {
    try {
      const entry = JSON.parse(await readFile(files(key).data, 'utf8')) as { key?: unknown; value?: unknown };
      return entry && entry.key === key && 'value' in entry ? { value: entry.value } : null;
    } catch { return null; }
  };
  return {
    async claimOrWait(key, deadline, signal) {
      await ensure();
      const { claim } = files(key);
      for (;;) {
        const stored = await readValue(key);
        if (stored) return stored;
        try {
          const handle = await open(claim, 'wx');
          await handle.close();
          // Another worker may have finished between the read and the claim.
          const late = await readValue(key);
          if (late) { await rm(claim, { force: true }); return late; }
          return null;
        } catch {
          // Someone else holds the claim: wait for its result, take over a dead claim.
          try {
            const info = await stat(claim);
            if (Date.now() - info.mtimeMs > STALE_CLAIM_MS) { await rm(claim, { force: true }); continue; }
          } catch { continue; }
        }
        if (signal?.aborted || Date.now() + POLL_MS >= deadline) return null;
        await pause(POLL_MS);
      }
    },
    async write(key, value) {
      await ensure();
      const { data, claim } = files(key);
      const temporary = `${data}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ key, value }));
        await rename(temporary, data);
      } catch {
        await rm(temporary, { force: true }).catch(() => undefined);
      } finally {
        await rm(claim, { force: true }).catch(() => undefined);
      }
    },
    async release(key) {
      await rm(files(key).claim, { force: true }).catch(() => undefined);
    },
  };
}

/** In-memory equivalent with the same claim semantics (tests, or several build stores in one process). */
export function createMemoryBuildStore(): JolpicaBuildStore & { readonly values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  const claims = new Set<string>();
  return {
    values,
    async claimOrWait(key, deadline, signal) {
      for (;;) {
        if (values.has(key)) return { value: structuredClone(values.get(key)) };
        if (!claims.has(key)) { claims.add(key); return null; }
        if (signal?.aborted || Date.now() + 5 >= deadline) return null;
        await pause(5);
      }
    },
    async write(key, value) { values.set(key, structuredClone(value)); claims.delete(key); },
    async release(key) { claims.delete(key); },
  };
}
