const FIFTEEN_MINUTES = 15 * 60_000;
const TWELVE_HOURS = 12 * 60 * 60_000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60_000;

/** CLI ownership always expires, including a stalled operator backfill. */
export function workerBudgetMs(source: string, override?: number): number {
  const budget = override ?? (source === 'jolpica-historical' ? TWELVE_HOURS : FIFTEEN_MINUTES);
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > TWENTY_FOUR_HOURS)
    throw new TypeError('Worker budget must be finite and at most 24 hours.');
  return budget;
}
