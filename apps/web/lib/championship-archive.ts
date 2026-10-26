import { ProviderError, withProviderDeadline } from '../../../packages/api-client/src/transport';
import { isSportUnavailable } from './public-sport';

export const ARCHIVE_BUDGET_MS = 30_000;
export const ARCHIVE_READ_MS = 6_000;
export const ARCHIVE_CONCURRENCY = 3;
export type ChampionshipKind = 'driver' | 'constructor';
export interface ChampionshipArchive<T> {
  state: 'complete' | 'partial' | 'empty' | 'unavailable';
  records: Array<{ year: number; winner: T }>;
  missing: number[];
  unavailable: number[];
  through: number;
}

/** Every supported season is visited, but only confirmed winners enter totals.
 * A failed or timed-out lookup remains unknown, never a synthetic zero title. */
export async function readChampionshipArchive<T>(
  kind: ChampionshipKind,
  through: number,
  readWinner: (year: number, signal: AbortSignal, deadline: number) => Promise<T | null>,
  options: { budgetMs?: number; signal?: AbortSignal; from?: number } = {},
): Promise<ChampionshipArchive<T>> {
  const first = kind === 'driver' ? 1950 : 1958;
  const from = options.from ?? first;
  // Callers pass lastCompletedSeason() (lib/season.ts). The current calendar year is
  // allowed once its final round is classified; a future season never is.
  if (!Number.isSafeInteger(through) || !Number.isSafeInteger(from) || from < first || through < from || through > new Date().getUTCFullYear()) throw new ProviderError('jolpica', 'invalid-input');
  const years = Array.from({ length: through - from + 1 }, (_, index) => through - index);
  const budgetMs = Number.isFinite(options.budgetMs) ? Math.max(1, Math.min(options.budgetMs!, ARCHIVE_BUDGET_MS)) : ARCHIVE_BUDGET_MS;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const expires = Date.now() + budgetMs;
  const timer = setTimeout(abort, budgetMs);
  const winners = new Map<number, T>();
  const confirmedEmpty = new Set<number>();
  let index = 0;
  try {
    await Promise.all(Array.from({ length: ARCHIVE_CONCURRENCY }, async () => {
      while (!controller.signal.aborted && Date.now() < expires && index < years.length) {
        const year = years[index++]!;
        try {
          const winner = await withProviderDeadline('jolpica', signal => readWinner(year, signal, expires), {
            signal: controller.signal, timeoutMs: Math.min(ARCHIVE_READ_MS, Math.max(1, expires - Date.now())),
          });
          if (controller.signal.aborted) break;
          if (winner === null) confirmedEmpty.add(year);
          else winners.set(year, winner);
        } catch (error) {
          if (!isSportUnavailable(error)) throw error;
        }
      }
    }));
  } finally {
    clearTimeout(timer);
    controller.abort();
    options.signal?.removeEventListener('abort', abort);
  }
  const records = years.flatMap(year => winners.has(year) ? [{ year, winner: winners.get(year)! }] : []);
  const missing = years.filter(year => !winners.has(year));
  const unavailable = missing.filter(year => !confirmedEmpty.has(year));
  return { state: !missing.length ? 'complete' : records.length ? 'partial' : unavailable.length ? 'unavailable' : 'empty', records, missing, unavailable, through };
}

/** Throw inside a persistent cache callback: a confirmed unpublished result
 * must not create a permanent empty cache entry. */
export class ChampionNotPublished extends ProviderError {
  constructor() { super('jolpica', 'incomplete'); }
}

/** Bound actual cache misses and automatic stale-entry refreshes together.
 * Waiting callbacks are removable on timeout, and cannot start after the
 * originating archive's absolute deadline. */
export class ChampionshipReadGate {
  private active = 0;
  private waiting: Array<() => void> = [];
  async run<T>(operation: () => Promise<T>, signal: AbortSignal, deadline: number): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        this.waiting = this.waiting.filter(item => item !== start);
        signal.removeEventListener('abort', abort);
        reject(new ProviderError('jolpica', 'timeout'));
      };
      const start = () => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted || Date.now() >= deadline) { reject(new ProviderError('jolpica', 'timeout')); this.drain(); return; }
        this.active++;
        resolve();
      };
      if (signal.aborted || Date.now() >= deadline) { abort(); return; }
      if (this.active < ARCHIVE_CONCURRENCY) start();
      else if (this.waiting.length >= 256) reject(new ProviderError('jolpica', 'rate-limit'));
      else { this.waiting.push(start); signal.addEventListener('abort', abort, { once: true }); }
    });
    try {
      if (signal.aborted || Date.now() >= deadline) throw new ProviderError('jolpica', 'timeout');
      return await withProviderDeadline('jolpica', () => operation(), { signal, timeoutMs: Math.min(ARCHIVE_READ_MS, Math.max(1, deadline - Date.now())) });
    } finally { this.active--; this.drain(); }
  }
  private drain() { while (this.active < ARCHIVE_CONCURRENCY && this.waiting.length) this.waiting.shift()!(); }
}
