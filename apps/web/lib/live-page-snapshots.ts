/** Provider response order is not proof of recency. Ignore malformed dates, preserve source rows. */
export function latestDatedSample<T extends { date: string }>(rows: readonly T[]): T | undefined {
  return rows.reduce<T | undefined>((latest, row) => {
    const timestamp = Date.parse(row.date);
    return Number.isFinite(timestamp) && (!latest || timestamp > Date.parse(latest.date)) ? row : latest;
  }, undefined);
}

export function latestDatedByDriver<T extends { driver_number: number; date: string }>(rows: readonly T[]): Map<number, T> {
  const latest = new Map<number, T>();
  for (const row of rows) {
    const timestamp = Date.parse(row.date);
    const previous = latest.get(row.driver_number);
    if (Number.isFinite(timestamp) && (!previous || timestamp > Date.parse(previous.date))) latest.set(row.driver_number, row);
  }
  return latest;
}

/** A newer stint supersedes an earlier one even when the array has been shuffled. */
export function latestStintByDriver<T extends { driver_number: number; stint_number: number; lap_end?: number | null }>(rows: readonly T[]): Map<number, T> {
  const latest = new Map<number, T>();
  for (const row of rows) {
    const previous = latest.get(row.driver_number);
    if (!previous || row.stint_number > previous.stint_number || (row.stint_number === previous.stint_number && (row.lap_end ?? -Infinity) > (previous.lap_end ?? -Infinity))) latest.set(row.driver_number, row);
  }
  return latest;
}
