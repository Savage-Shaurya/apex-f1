/**
 * Data truth: what the rendered site shows against Jolpica (source of truth).
 *
 * Reads go to APEX_QA_JOLPICA_URL (default: the public API). Locally point it
 * at the shared cache (http://127.0.0.1:4777/jolpica) so the gate never
 * spends the 500 requests/hour budget. Requests are sequential with a gap.
 *
 * The comparison functions are pure and unit-tested (data-truth.test.mjs).
 */

export const JOLPICA = (process.env.APEX_QA_JOLPICA_URL ?? 'https://api.jolpi.ca/ergast/f1').replace(/\/$/, '');
const GAP_MS = Number(process.env.APEX_QA_JOLPICA_GAP_MS ?? (JOLPICA.includes('127.0.0.1') ? 50 : 1_000));
let last = 0;

export async function jolpica(path) {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${JOLPICA}${path}`, { headers: { accept: 'application/json' } });
    // The local shared cache answers 429 for keys it does not hold while the upstream budget is spent: fail fast, let the caller try another key shape.
    if (res.status === 429 && JOLPICA.includes('127.0.0.1')) throw new Error(`Jolpica ${path}: HTTP 429 (not in the shared cache)`);
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 4_000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`Jolpica ${path}: HTTP ${res.status}`);
    return (await res.json()).MRData;
  }
  throw new Error(`Jolpica ${path}: rate limited three times`);
}

/** First of several equivalent request shapes that answers (same data, different cache keys). */
export async function jolpicaAny(paths) {
  const errors = [];
  for (const p of paths) {
    try { return await jolpica(p); } catch (e) { errors.push(e.message); }
  }
  throw new Error(errors.join('; '));
}
export const standingsPaths = (season, kind) => [`/${season}/${kind}Standings.json`, `/${season}/${kind}Standings.json?limit=100`, `/${season}/${kind}Standings.json?limit=40`];

export const normalise = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Compare an expected ordered list ({ key, mustContain[] }) with rendered
 * table rows (text). Each expected entry must appear in a row, rows must be
 * in the expected order, and the row must contain every `mustContain` value.
 * Returns human-readable mismatches (empty = match).
 */
export function compareOrderedRows(expected, rowTexts, { label = 'row', limit = expected.length } = {}) {
  const rows = rowTexts.map(normalise);
  const has = (row, value) => new RegExp(`(^|[^0-9.])${String(value).replace('.', '\\.')}([^0-9.]|$)`).test(row);
  const wanted = expected.slice(0, limit);
  if (!wanted.some((e) => rows.some((r) => r.includes(normalise(e.key))))) {
    return [`none of the expected entries is shown (page in an unavailable or loading state?): "${rowTexts.slice(0, 3).join(' | ').replace(/\s+/g, ' ').slice(0, 140)}"`];
  }
  const problems = [];
  let previous = -1;
  for (const [i, entry] of wanted.entries()) {
    const key = normalise(entry.key);
    const values = entry.mustContain ?? [];
    // A row that names the entry and carries its values wins over e.g. a chart's data-table header that lists every name.
    const candidates = rows.map((r, idx) => idx).filter((idx) => idx > previous && rows[idx].includes(key));
    const at = candidates.find((idx) => values.every((v) => has(rows[idx], v))) ?? candidates[0] ?? -1;
    if (at === -1) {
      const anywhere = rows.findIndex((r) => r.includes(key));
      problems.push(anywhere === -1 ? `${label} ${i + 1}: "${entry.key}" not shown` : `${label} ${i + 1}: "${entry.key}" shown out of order`);
      continue;
    }
    for (const value of values) {
      if (!has(rows[at], value)) problems.push(`${label} ${i + 1} "${entry.key}": expected ${value} in "${rowTexts[at].replace(/\s+/g, ' ').slice(0, 120)}"`);
    }
    previous = at;
  }
  return problems;
}

/** The team a driver raced for most recently in a season's results (Lawson-style mid-season moves). */
export function latestTeams(races) {
  const latest = new Map();
  const teams = new Map();
  for (const race of [...races].sort((a, b) => Number(a.round) - Number(b.round))) {
    for (const r of race.Results ?? []) {
      latest.set(r.Driver.driverId, { constructorId: r.Constructor.constructorId, name: r.Constructor.name, round: Number(race.round) });
      const set = teams.get(r.Driver.driverId) ?? new Set();
      set.add(r.Constructor.constructorId);
      teams.set(r.Driver.driverId, set);
    }
  }
  return { latest, moved: [...teams].filter(([, set]) => set.size > 1).map(([id]) => id) };
}

/** Expected row lists from Jolpica payloads. */
export const expectDriverStandings = (list) => list.DriverStandings.map((d) => ({ key: d.Driver.familyName, mustContain: [d.points] }));
export const expectConstructorStandings = (list) => list.ConstructorStandings.map((c) => ({ key: c.Constructor.name, mustContain: [c.points] }));
export const expectClassification = (race) => race.Results.map((r) => ({ key: r.Driver.familyName }));

/** Visible table rows of a page, as text (all tables, plus role=row lists). */
export function tableRows() {
  return [...document.querySelectorAll('main tr, main [role="row"], main li')].map((r) => r.innerText || r.textContent || '').filter((t) => t.trim());
}
