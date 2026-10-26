/** Walk apps/web/{app,components,lib} and apply the forbidden-pattern rules. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanSource } from './forbidden.mjs';

export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SKIP_DIRS = new Set(['node_modules', '.next', 'tests', 'design', 'brand-preview']);

async function walk(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs, out);
    else if (/\.(tsx|ts|css|mdx?)$/.test(entry.name) && !/\.(test|spec)\.|\.d\.ts$/.test(entry.name)) out.push(abs);
  }
  return out;
}

export async function scanRepo(root = WEB_ROOT) {
  const files = [];
  for (const sub of ['app', 'components', 'lib']) await walk(path.join(root, sub), files);
  const hits = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    hits.push(...scanSource(await readFile(file, 'utf8'), rel));
  }
  return { files: files.length, hits };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { files, hits } = await scanRepo();
  for (const h of hits) console.log(`${h.rule}\t${h.file}:${h.line}\t${h.match}`);
  console.log(`${files} files, ${hits.length} violations`);
  process.exitCode = hits.length ? 1 : 0;
}
