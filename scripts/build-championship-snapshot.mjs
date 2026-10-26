#!/usr/bin/env node
// Regenerates apps/web/lib/data/championship-snapshot.json: the verbatim P1 row
// of every completed season's final Jolpica driver (1950+) and constructor
// (1958+) standings. Completed seasons never change except for rare source
// corrections, so the champions archive, title counts and team badges read
// this file instead of making 145 paced provider calls per cold render.
// Seasons after `--through` are still read live by the app.
//
//   node scripts/build-championship-snapshot.mjs --through 2025
//   JOLPICA_BASE_URL=http://127.0.0.1:4777/jolpica node scripts/build-championship-snapshot.mjs --through 2025
//
// The script only reads Jolpica. It refuses to write a partial file.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "apps/web/lib/data/championship-snapshot.json");
const BASE = (process.env.JOLPICA_BASE_URL || "https://api.jolpi.ca/ergast/f1").replace(/\/$/, "");
const PUBLIC = "https://api.jolpi.ca/ergast/f1";
const GAP_MS = Number(process.env.SNAPSHOT_GAP_MS ?? 400);

const args = process.argv.slice(2);
const throughArg = args[args.indexOf("--through") + 1];
const through = Number(throughArg);
if (!args.includes("--through") || !Number.isSafeInteger(through) || through < 1958 || through >= new Date().getUTCFullYear() + 1) {
  console.error("Usage: node scripts/build-championship-snapshot.mjs --through <last completed season>");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "Apex-F1 snapshot builder" } });
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500) throw new Error(`HTTP ${response.status} for ${url.replace(BASE, PUBLIC)}`);
    await sleep(5_000 * (attempt + 1));
  }
  throw new Error(`Gave up after retries: ${url.replace(BASE, PUBLIC)}`);
}

/** Final standings table (all pages), then its single position-1 row. */
async function champion(kind, year) {
  const resource = kind === "driver" ? "driverStandings" : "constructorStandings";
  const field = kind === "driver" ? "DriverStandings" : "ConstructorStandings";
  const rows = [];
  let offset = 0, total = 0, round = null;
  do {
    await sleep(GAP_MS);
    const data = await json(`${BASE}/${year}/${resource}.json?limit=100&offset=${offset}`);
    const table = data?.MRData?.StandingsTable;
    total = Number(data?.MRData?.total);
    const lists = table?.StandingsLists ?? [];
    if (lists.length > 1 || lists.some((list) => list.season !== String(year))) throw new Error(`${year} ${kind}: unexpected standings lists`);
    const page = lists[0]?.[field] ?? [];
    if (lists[0]) {
      if (round !== null && round !== lists[0].round) throw new Error(`${year} ${kind}: round changed between pages`);
      round = lists[0].round;
    }
    rows.push(...page);
    offset += page.length;
    if (!page.length) break;
  } while (offset < total);
  if (rows.length !== total) throw new Error(`${year} ${kind}: ${rows.length} of ${total} rows`);
  const winners = rows.filter((row) => row.position === "1");
  if (winners.length !== 1 || winners[0].positionText !== "1" || !(Number(round) >= 1)) throw new Error(`${year} ${kind}: expected exactly one champion`);
  return { year, round: Number(round), source: `${PUBLIC}/${year}/${resource}/1.json`, entry: winners[0] };
}

const drivers = [];
const constructors = [];
for (let year = 1950; year <= through; year++) {
  drivers.push(await champion("driver", year));
  if (year >= 1958) constructors.push(await champion("constructor", year));
  process.stdout.write(`${year} `);
}
const snapshot = {
  description: "Verbatim position-1 rows of each completed season's final Jolpica standings. Regenerate with scripts/build-championship-snapshot.mjs.",
  provider: "Jolpica F1 (Ergast-compatible API)",
  generatedAt: new Date().toISOString().slice(0, 10),
  through,
  drivers,
  constructors,
};
await writeFile(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);
console.log(`\nWrote ${drivers.length} driver and ${constructors.length} constructor champions through ${through} to ${path.relative(ROOT, OUT)}`);
