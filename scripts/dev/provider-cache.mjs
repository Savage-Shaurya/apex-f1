#!/usr/bin/env node
// Local development cache in front of Jolpica and OpenF1.
//
// Several local Next servers (one per worktree) share one IP and therefore one
// real upstream budget. This process forwards each request to the real
// provider once, keeps the real response on disk for a short TTL, and enforces
// the provider's published limits for all of them together. It never invents
// data: a miss that cannot be fetched returns the upstream status, unless an
// earlier real response for the same request is on disk, which is then served
// with `x-provider-cache: STALE` (counted in /health as `stale`).
//
//   node scripts/dev/provider-cache.mjs            # listens on 127.0.0.1:4777
//   JOLPICA_BASE_URL=http://127.0.0.1:4777/jolpica
//   OPENF1_BASE_URL=http://127.0.0.1:4777/openf1
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PROVIDER_CACHE_PORT || 4777);
const ROOT = process.env.PROVIDER_CACHE_DIR || join(dirname(fileURLToPath(import.meta.url)), "../../.cache/provider");
const CURRENT_YEAR = new Date().getUTCFullYear();

const UPSTREAMS = {
  // Jolpica: 4 req/s burst, 500 req/h sustained.
  jolpica: { base: "https://api.jolpi.ca/ergast/f1", gapMs: 300, hourLimit: 450 },
  // OpenF1 free tier: 3 req/s, 30 req/min.
  openf1: { base: "https://api.openf1.org/v1", gapMs: 2100, hourLimit: 1700 },
};

/** Live-season data changes during a weekend; history does not. */
function ttlMs(name, path) {
  if (name === "openf1") return 60_000;
  if (/\/(current|last|next)\b/.test(path) || path.includes(`/${CURRENT_YEAR}`)) return 5 * 60_000;
  if (/^\/?\d{4}\.json/.test(path) || /\/(drivers|constructors|circuits|seasons)(\.json|\/)/.test(path)) return 24 * 3_600_000;
  return 7 * 24 * 3_600_000;
}

const lanes = Object.fromEntries(
  Object.keys(UPSTREAMS).map((name) => [name, { last: 0, starts: [], queue: Promise.resolve() }]),
);
const inflight = new Map();
const stats = { hit: 0, miss: 0, error: 0, stale: 0 };

function admit(name) {
  const lane = lanes[name];
  const { gapMs, hourLimit } = UPSTREAMS[name];
  const turn = lane.queue.then(async () => {
    const now = Date.now();
    lane.starts = lane.starts.filter((t) => t > now - 3_600_000);
    if (lane.starts.length >= hourLimit) throw Object.assign(new Error("hourly budget"), { status: 429 });
    const wait = Math.max(0, lane.last + gapMs - now);
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lane.last = Date.now();
    lane.starts.push(lane.last);
  });
  lane.queue = turn.catch(() => {});
  return turn;
}

async function upstream(name, path, search) {
  await admit(name);
  const res = await fetch(`${UPSTREAMS[name].base}${path}${search}`, {
    headers: { accept: "application/json", "user-agent": "apex-local-dev-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type") || "application/json", body };
}

async function handle(name, path, search) {
  const key = createHash("sha256").update(`${name}${path}${search}`).digest("hex");
  const file = join(ROOT, name, `${key}.json`);
  let stale = null;
  try {
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (Date.now() - cached.at < ttlMs(name, path)) {
      stats.hit++;
      return { status: 200, type: cached.type, body: Buffer.from(cached.body, "base64"), cache: "HIT" };
    }
    stale = cached;
  } catch {}
  // A previously fetched real response beats an error when the shared budget
  // is spent or the provider is down; it is served marked STALE.
  const serveStale = () => {
    stats.stale = (stats.stale || 0) + 1;
    return { status: 200, type: stale.type, body: Buffer.from(stale.body, "base64"), cache: "STALE" };
  };
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      const r = await upstream(name, path, search);
      if (r.status === 200) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ at: Date.now(), type: r.type, body: r.body.toString("base64") }));
      }
      return r;
    })().finally(() => inflight.delete(key)));
  }
  stats.miss++;
  try {
    const r = await inflight.get(key);
    if (r.status !== 200 && stale) return serveStale();
    return { ...r, cache: "MISS" };
  } catch (error) {
    if (stale) return serveStale();
    throw error;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, stats, budget: Object.fromEntries(Object.entries(lanes).map(([n, l]) => [n, l.starts.length])) }));
  }
  const [, name, ...rest] = url.pathname.split("/");
  if (req.method !== "GET" || !UPSTREAMS[name]) {
    res.writeHead(404);
    return res.end();
  }
  try {
    const r = await handle(name, `/${rest.join("/")}`, url.search);
    res.writeHead(r.status, { "content-type": r.type, "x-provider-cache": r.cache });
    res.end(r.body);
  } catch (error) {
    stats.error++;
    res.writeHead(error.status || 502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(error.message || error) }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`provider cache on http://127.0.0.1:${PORT}`));
