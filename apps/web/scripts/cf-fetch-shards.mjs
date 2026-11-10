// After `opennextjs-cloudflare build`: pack the build-time fetch (data) cache into 16 shard files in
// the Workers static assets. On the Free plan a request may make only 50 subrequests; reading one
// shard (one subrequest) gives an isolate up to ~1/16 of every build-time data entry, instead of one
// subrequest per entry. Read by open-next.config.ts. Run from apps/web.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.open-next/cache/__fetch');
if (!fs.existsSync(root)) {
  console.log('cf-fetch-shards: no fetch cache, nothing to pack');
  process.exit(0);
}
for (const buildId of fs.readdirSync(root)) {
  const dir = path.join(root, buildId);
  const shards = {};
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const key = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, key);
      else (shards[key[0]?.toLowerCase() ?? '_'] ??= {})[key] = JSON.parse(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(dir, '');
  const out = path.resolve('.open-next/assets/cdn-cgi/_apex_fetch', buildId);
  fs.mkdirSync(out, { recursive: true });
  for (const [shard, entries] of Object.entries(shards)) {
    fs.writeFileSync(path.join(out, `${encodeURIComponent(shard)}.json`), JSON.stringify(entries));
  }
  console.log(`cf-fetch-shards: ${Object.keys(shards).length} shards for build ${buildId}`);
}
