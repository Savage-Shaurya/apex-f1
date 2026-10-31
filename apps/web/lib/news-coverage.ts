/**
 * Whether a news refresh lost real coverage. One source failing (a feed that blocks
 * servers, a provider's bad hour) is reported per source in sourceHealth, but is not a
 * degraded run while at least half the sources answer. A source that answers with an
 * empty feed is healthy (nothing new), not a failure.
 */
export function newsCoverageDegraded(sourceHealth: ReadonlyArray<{ ok: boolean }>): boolean {
  if (sourceHealth.length === 0) return true;
  const healthy = sourceHealth.filter((source) => source.ok).length;
  return healthy < Math.ceil(sourceHealth.length / 2);
}
