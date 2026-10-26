import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProviderBase, resetProviderBaseWarnings } from "./provider-base";
import { APEX_USER_AGENT, apexUserAgent } from "./user-agent";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT = "https://api.jolpi.ca/ergast/f1";

test("SEC-3: provider base overrides are loopback-only and never on a deployment or in production", () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  resetProviderBaseWarnings();
  assert.deepEqual(resolveProviderBase("JOLPICA_BASE_URL", DEFAULT, { NODE_ENV: "development", JOLPICA_BASE_URL: "http://127.0.0.1:4777/jolpica/" }, warn), { base: "http://127.0.0.1:4777/jolpica", overridden: true });
  assert.deepEqual(resolveProviderBase("JOLPICA_BASE_URL", DEFAULT, { NODE_ENV: "development", VERCEL: "1", JOLPICA_BASE_URL: "http://127.0.0.1:4777/jolpica" }, warn), { base: DEFAULT, overridden: false });
  resetProviderBaseWarnings();
  assert.deepEqual(resolveProviderBase("JOLPICA_BASE_URL", DEFAULT, { NODE_ENV: "production", JOLPICA_BASE_URL: "http://127.0.0.1:4777/jolpica" }, warn).overridden, false);
  assert.equal(resolveProviderBase("JOLPICA_BASE_URL", DEFAULT, { NODE_ENV: "production", APEX_ALLOW_LOCAL_PROVIDER_CACHE: "1", JOLPICA_BASE_URL: "http://127.0.0.1:4777/jolpica" }, warn).overridden, true);
  for (const url of ["https://evil.example/f1", "http://10.0.0.5:4777/jolpica", "http://user:pw@127.0.0.1:4777/j", "ftp://127.0.0.1/j", "http://127.0.0.1:4777/j?x=1", "not a url"]) {
    resetProviderBaseWarnings();
    assert.deepEqual(resolveProviderBase("JOLPICA_BASE_URL", DEFAULT, { NODE_ENV: "development", JOLPICA_BASE_URL: url }, warn), { base: DEFAULT, overridden: false }, url);
  }
  assert.ok(warnings.length >= 6);
  assert.ok(warnings.every((message) => !message.includes("evil.example")), "warnings never echo the configured URL");
});

test("D2-REGRESSION-4: one shared User-Agent naming the site from NEXT_PUBLIC_SITE_URL, no apex.gg address anywhere", () => {
  assert.match(APEX_USER_AGENT, /^Apex\/0\.1 \(unofficial Formula 1 fan project/);
  assert.equal(apexUserAgent({ NEXT_PUBLIC_SITE_URL: "https://apex.example/x" }), "Apex/0.1 (unofficial Formula 1 fan project; +https://apex.example)");
  for (const value of [undefined, "", "http://localhost:3000", "https://127.0.0.1", "http://apex.example"]) {
    assert.equal(apexUserAgent({ NEXT_PUBLIC_SITE_URL: value }), "Apex/0.1 (unofficial Formula 1 fan project)", String(value));
  }
  assert.doesNotMatch(apexUserAgent({ NEXT_PUBLIC_SITE_URL: "https://apex.example" }), /github/i, "no repository link");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name) && !name.endsWith(".test.ts") && readFileSync(path, "utf8").includes("apex.gg")) offenders.push(path);
    }
  };
  walk(dirname(fileURLToPath(import.meta.url)));
  assert.deepEqual(offenders, []);
});

test("season cache invalidation matches keys relative to the configured base, real or local cache", async () => {
  const { jolpicaSeasonKeyMatches } = await import("./jolpica/index");
  const real = "https://api.jolpi.ca/ergast/f1";
  const local = "http://127.0.0.1:4777/jolpica";
  assert.equal(jolpicaSeasonKeyMatches(`${real}/2026/results.json?limit=100&offset=0`, 2026, false, real), true);
  assert.equal(jolpicaSeasonKeyMatches(`${real}/2026.json?limit=100&offset=0`, 2026, false, real), true);
  assert.equal(jolpicaSeasonKeyMatches(`${real}/current/driverStandings.json?limit=100&offset=0`, 2026, true, real), true);
  assert.equal(jolpicaSeasonKeyMatches(`${real}/current/driverStandings.json?limit=100&offset=0`, 2026, false, real), false);
  assert.equal(jolpicaSeasonKeyMatches(`${local}/2026/results.json?limit=100&offset=0`, 2026, false, local), true);
  assert.equal(jolpicaSeasonKeyMatches(`${local}/2025/results.json?limit=100&offset=0`, 2026, false, local), false);
  assert.equal(jolpicaSeasonKeyMatches(`${real}/2026/results.json`, 2026, false, local), false);
  assert.equal(jolpicaSeasonKeyMatches(`${local}/drivers/2026x.json`, 2026, false, local), false);
});

test("a VERCEL_ENV deployment ignores any override", () => {
  resetProviderBaseWarnings();
  assert.deepEqual(resolveProviderBase("JOLPICA_BASE_URL", DEFAULT, { NODE_ENV: "development", VERCEL_ENV: "production", JOLPICA_BASE_URL: "http://127.0.0.1:4777/jolpica" }, () => {}), { base: DEFAULT, overridden: false });
});
