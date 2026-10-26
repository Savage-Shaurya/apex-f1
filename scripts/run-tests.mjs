import {readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excluded = new Set(['node_modules', '.next', '.turbo', '.git', 'audit']);
async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    // Alternate Next dist dirs (APEX_NEXT_DIST_DIR, e.g. .next-integrate) are build output.
    if (excluded.has(entry.name) || entry.name.startsWith('.next-')) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(absolute));
    else if (/\.test\.(?:ts|tsx|mjs|js)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}
const files = (await Promise.all(['apps', 'packages', 'scripts'].map(name => collect(path.join(root, name))))).flat().sort();
if (!files.length) throw new Error('No regression tests were found.');
const require = createRequire(path.join(root, 'apps/workers/package.json'));
// CSS imports load as empty modules in tests (scripts/test-css-stub.mjs); a file URL keeps NODE_OPTIONS free of spaces.
const cssStub = pathToFileURL(path.join(root, 'scripts/test-css-stub.mjs')).href;
const env = {...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${cssStub}`].filter(Boolean).join(' ')};
const child = spawn(process.execPath, [require.resolve('tsx/cli'), '--tsconfig', path.join(root, 'apps/web/tsconfig.json'), '--test', ...files], {cwd: root, stdio: 'inherit', env});
child.on('error', error => {console.error(error.message); process.exitCode = 1;});
child.on('exit', (code, signal) => {process.exitCode = signal ? 1 : (code ?? 1);});
