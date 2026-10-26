import type { FetchOpts, OpenF1Driver, OpenF1Session } from '@apex/api-client/openf1';

export interface GridTimingReader {
  readonly observedAt: number;
  getLatestSession(options?: FetchOpts): Promise<OpenF1Session | null>;
  getDrivers(sessionKey: number, options?: FetchOpts): Promise<OpenF1Driver[]>;
  getDriversByAcronym(acronym: string, options?: FetchOpts): Promise<OpenF1Driver[]>;
}

export interface GridTimingSnapshot {
  /** A session from the selected standings season that has already started. */
  sessionKey: number | null;
  drivers: OpenF1Driver[];
}

const unavailable = (): GridTimingSnapshot => ({ sessionKey: null, drivers: [] });

/** Never mix a previous standings season with the latest timing roster. */
export async function loadGridTiming(reader: GridTimingReader, season: number | null): Promise<GridTimingSnapshot> {
  if (season === null || !Number.isSafeInteger(season) || season < 1950 || season > 9999) return unavailable();
  try {
    const session = await reader.getLatestSession({ strict: true, revalidate: 3600 });
    const instant = reader.observedAt;
    const start = session ? Date.parse(session.date_start) : NaN;
    if (!session || session.year !== season || session.is_cancelled === true ||
        !Number.isSafeInteger(session.session_key) || session.session_key <= 0 ||
        !Number.isFinite(instant) || !Number.isFinite(start) || start > instant) return unavailable();
    let drivers: OpenF1Driver[] = [];
    try {
      drivers = (await reader.getDrivers(session.session_key, { strict: true, revalidate: 3600 }))
        .filter(driver => driver.session_key === session.session_key);
    } catch { /* An unavailable roster may still have an entry for this verified session. */ }
    return { sessionKey: session.session_key, drivers };
  } catch { return unavailable(); }
}

/** Historical acronym rows must not invent a current roster or season. */
export async function lookupGridTimingEntry(timing: GridTimingSnapshot, acronym: string, reader: GridTimingReader): Promise<OpenF1Driver | null> {
  if (timing.sessionKey === null) return null;
  try {
    const rows = (await reader.getDriversByAcronym(acronym, { strict: true, revalidate: 86400 }))
      .filter(driver => driver.session_key === timing.sessionKey && driver.name_acronym === acronym);
    return [...rows].reverse().find(driver => driver.headshot_url) ?? rows.at(-1) ?? null;
  } catch { return null; }
}
