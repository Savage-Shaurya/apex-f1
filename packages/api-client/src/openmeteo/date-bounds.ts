/** Use the same UTC weekend window for the displayed forecast and cache priming. */
export function raceWeatherDateBounds(
  sessions: ReadonlyArray<{ iso: string }>,
  fallbackIso: string,
): { start: string; end: string } {
  const dates = sessions
    .map(({ iso }) => iso.slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return dates.length
    ? { start: dates[0]!, end: dates[dates.length - 1]! }
    : { start: fallbackIso.slice(0, 10), end: fallbackIso.slice(0, 10) };
}
