import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BUILD_READ_STORE_ENV } from '../../../packages/api-client/src/build-phase';

const ROOT = path.join(tmpdir(), 'apex-build-reads');
const KEEP_MS = 6 * 3_600_000;

/**
 * Names one fresh directory for this build's shared Jolpica read store
 * (packages/api-client/src/jolpica/build-store.ts). Called from next.config.ts:
 * the main `next build` process sets it first and every build worker inherits
 * it; a worker that loads the config again keeps the inherited value. Stores
 * of earlier builds are removed after six hours. Never used outside a build.
 */
export function prepareBuildReadStore(phase: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (phase !== 'phase-production-build') return null;
  if (env[BUILD_READ_STORE_ENV]) return env[BUILD_READ_STORE_ENV]!;
  try {
    for (const name of readdirSync(ROOT)) {
      const entry = path.join(ROOT, name);
      try { if (Date.now() - statSync(entry).mtimeMs > KEEP_MS) rmSync(entry, { recursive: true, force: true }); } catch { /* another build owns it */ }
    }
  } catch { /* first build on this machine */ }
  const directory = path.join(ROOT, `${Date.now()}-${process.pid}`);
  try { mkdirSync(directory, { recursive: true }); } catch { return null; }
  env[BUILD_READ_STORE_ENV] = directory;
  return directory;
}
