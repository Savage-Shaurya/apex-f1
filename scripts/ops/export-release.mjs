import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRecognizableSecrets,ReleaseSecretError } from './secret-scan.mjs';

export const releaseRoots = ['apps/web', 'apps/workers', 'packages/api-client', 'packages/db', 'packages/types', 'packages/ui', 'patches', 'scripts', '.github', 'docs/operations'];
// The public repository is created from this allowlist (README "Publishing"): product source, its tests and
// operating docs. Root CLAUDE.md, design references, strategy/founder/audit material and reports stay private.
export const releaseFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', 'tsconfig.base.json', '.npmrc', '.nvmrc', '.gitignore', '.vercelignore', 'README.md', 'DEPLOY.md', 'docs/ADMIN-AUTHENTICATION.md', 'docs/NEWS-POLICY.md', 'docs/QUALITY-GATE.md'];
const excludedSegments = new Set(['node_modules','.next','.turbo','.git','_apex-f1-local-dot-git','.vercel','.private','.secrets','.cache','.reports','dist','build','out','coverage','dependency-security-reports']);
const excludedFiles = new Set(['next-env.d.ts','backend-acceptance.mjs','bootstrap-disposable.mjs','APEX_SECRETS_BACKUP.txt','codes.txt','Code.txt','secrets.txt','keys.txt','CLAUDE.local.md']);
export function includeReleasePath(relative) {
  const posix = relative.replaceAll('\\','/');
  const parts = posix.split('/');
  if (posix === 'audit' || posix.startsWith('audit/')) return false;
  // `.next-<name>` are APEX_NEXT_DIST_DIR build outputs.
  if (parts.some(part => excludedSegments.has(part) || part.startsWith('.next-')) || excludedFiles.has(parts.at(-1))) return false;
  if (relative.replaceAll('\\','/').startsWith('packages/db/migrations/fixtures/')) return false;
  // Every env file stays out except the blank, value-free template (scripts/repo-hygiene.test.mjs checks it holds no values).
  if (parts.at(-1) === '.env.example') return true;
  return !/^(?:\.env(?:\..*)?)$|\.(?:log|tsbuildinfo|secrets\.txt)$/i.test(parts.at(-1));
}
export function allowlistedReleaseFile(relative) {
  return typeof relative==='string' && !relative.includes('\\') && !path.isAbsolute(relative) && !relative.split('/').some(part=>part===''||part==='.'||part==='..') && includeReleasePath(relative) && (releaseFiles.includes(relative)||releaseRoots.some(root=>relative.startsWith(root+'/')));
}
export function canonicalManifest(files) {
  const sorted = [...files].sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const digest = createHash('sha256').update(sorted.map(item => `${item.path}\0${item.bytes}\0${item.sha256}\n`).join('')).digest('hex');
  return { format:1, algorithm:'sha256', digest, fileCount:sorted.length, files:sorted };
}
export async function exportRelease(sourceRoot, destination) {
  const source = await realpath(sourceRoot);
  const target = path.resolve(destination);
  const relation = path.relative(source,target);
  if (!relation || (!relation.startsWith('..'+path.sep) && relation !== '..' && !path.isAbsolute(relation))) throw new Error('Export must be outside the source checkout.');
  let ancestor=path.dirname(target);const pending=[];
  for(;;) {
    try {await lstat(ancestor);break;}catch(error){if(error.code!=='ENOENT')throw error;pending.unshift(path.basename(ancestor));ancestor=path.dirname(ancestor);}
  }
  const resolvedParent=path.join(await realpath(ancestor),...pending);
  const parentRelation=path.relative(source,resolvedParent);
  if(!parentRelation || (!parentRelation.startsWith('..'+path.sep) && parentRelation!=='..' && !path.isAbsolute(parentRelation)))throw new Error('Export parent resolves inside the checkout.');
  await mkdir(path.dirname(target),{recursive:true});
  await mkdir(target); // Never overwrite an old release or merge unreviewed files.
  const entries=[];
  async function copy(relative) {
    const posix=relative.replaceAll('\\','/');
    if (!includeReleasePath(posix)) return;
    const original=path.join(source,relative);
    const info=await lstat(original);
    if (info.isSymbolicLink()) throw new Error('Release input contains a link; resolve and review it first.');
    const resolved=await realpath(original);
    const inside=path.relative(source,resolved);
    if (inside.startsWith('..'+path.sep) || path.isAbsolute(inside)) throw new Error('Release input resolves outside source.');
    if (info.isDirectory()) {
      for (const child of (await readdir(original)).sort()) await copy(path.join(relative,child));
      return;
    }
    if (!info.isFile()) throw new Error('Release input is not a regular file.');
    const body=await readFile(original);
    const findings=scanRecognizableSecrets(body,posix);
    if(findings.length)throw new ReleaseSecretError(findings);
    if (!posix.startsWith('scripts/ops/') && !posix.startsWith('docs/operations/') && !/\.test\./.test(posix) && /\.(?:mjs|[cm]?[jt]sx?|json|ya?ml|css|sql|md|patch)$/.test(posix) && /(?:NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|--require[^\n]*(?:preload|fixture)|apex-disposable\.upstash\.io)/i.test(body.toString('utf8'))) throw new Error('Release source contains an acceptance or TLS-disable marker.');
    const output=path.join(target,relative);
    await mkdir(path.dirname(output),{recursive:true});
    await writeFile(output,body,{flag:'wx',mode:0o644});
    entries.push({path:posix,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});
  }
  try {
    for (const item of [...releaseRoots,...releaseFiles]) await copy(item);
    const manifest=canonicalManifest(entries);
    await writeFile(path.join(target,'RELEASE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    return manifest;
  } catch (error) {
    // Preserve an incomplete export for diagnosis, but never label it a release.
    await writeFile(path.join(target,'EXPORT-INCOMPLETE'), 'Export failed. Create a new destination after resolving the input.\n',{flag:'wx'});
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [destination,...extra]=process.argv.slice(2);
  if (!destination || extra.length) throw new Error('Usage: node scripts/ops/export-release.mjs <new-directory-outside-checkout>');
  try {
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    const manifest=await exportRelease(root,destination);
    console.log(JSON.stringify({exported:true,fileCount:manifest.fileCount,digest:manifest.digest,exclusionPolicy:'No .env files, named secret drop files, acceptance runtime or generated builds.',arbitrarySecretDiscovery:false}));
  } catch(error) { if(error instanceof ReleaseSecretError)console.error(JSON.stringify({recognizedSecretFindings:error.findings,valuesPrinted:false}));console.error('Release export failed safely; no release readiness is claimed.'); process.exitCode=1; }
}
