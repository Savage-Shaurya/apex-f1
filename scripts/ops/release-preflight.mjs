import { readFile, lstat, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { scanRecognizableSecrets } from './secret-scan.mjs';

export async function inspectReleaseManifest(root) {
  const { canonicalManifest,allowlistedReleaseFile }=await import('./export-release.mjs');
  const resolvedRoot=await realpath(root);
  if((await lstat(root)).isSymbolicLink() || !(await lstat(path.join(root,'RELEASE-MANIFEST.json'))).isFile() || (await lstat(path.join(root,'RELEASE-MANIFEST.json'))).isSymbolicLink())throw new Error('Manifest root must be an ordinary release directory.');
  const manifest=JSON.parse(await readFile(path.join(root,'RELEASE-MANIFEST.json'),'utf8'));
  const issues=[];
  const recognizedSecretFindings=[];
  if(manifest.format!==1 || manifest.algorithm!=='sha256' || !Array.isArray(manifest.files) || manifest.files.length!==manifest.fileCount) throw new Error('Invalid release manifest.');
  const seen=new Set();
  for(const item of manifest.files) {
    if(!allowlistedReleaseFile(item.path) || seen.has(item.path) || !Number.isSafeInteger(item.bytes) || item.bytes<0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Unsafe release manifest entry.');
    seen.add(item.path);
    const location=path.join(root,item.path);
    const info=await lstat(location);
    if(!info.isFile() || info.isSymbolicLink()) throw new Error('Release entry is not a regular file.');
    const resolved=await realpath(location);const relation=path.relative(resolvedRoot,resolved);
    if(relation.startsWith('..'+path.sep)||path.isAbsolute(relation))throw new Error('Release entry escapes its root.');
    let ancestor=path.dirname(location);
    while(ancestor!==path.resolve(root)){if((await lstat(ancestor)).isSymbolicLink())throw new Error('Release entry has a linked ancestor.');ancestor=path.dirname(ancestor);}
    const body=await readFile(location);
    recognizedSecretFindings.push(...scanRecognizableSecrets(body,item.path));
    if(body.length!==item.bytes || createHash('sha256').update(body).digest('hex')!==item.sha256) issues.push('A release source file changed after export.');
  }
  async function inventory(directory,relative='') {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const item=relative?relative+'/'+entry.name:entry.name;
      const absolute=path.join(directory,entry.name);
      if(entry.isSymbolicLink())throw new Error('Release tree contains a link.');
      const resolved=await realpath(absolute);const relation=path.relative(resolvedRoot,resolved);
      if(relation.startsWith('..'+path.sep)||path.isAbsolute(relation))throw new Error('Release tree escapes its root.');
      if(entry.isDirectory())await inventory(absolute,item);
      else if(!entry.isFile() || (!['RELEASE-MANIFEST.json','EXPORT-INCOMPLETE'].includes(item)&&!seen.has(item)))issues.push('Release contains an unmanifested file.');
    }
  }
  await inventory(root);
  if(recognizedSecretFindings.length)issues.push('Recognizable credential/private-key material is present in release source.');
  if(canonicalManifest(manifest.files).digest!==manifest.digest) issues.push('The release manifest digest is invalid.');
  try {await lstat(path.join(root,'EXPORT-INCOMPLETE'));issues.push('The export is marked incomplete.');} catch(error) {if(error.code!=='ENOENT')throw error;}
  return {ready:issues.length===0,issues,fileCount:manifest.fileCount,digest:manifest.digest,recognizedSecretFindings,arbitrarySecretDiscovery:false};
}
export function inspectRuntimeIsolation(environment) {
  const issues=[];
  if(environment.NODE_TLS_REJECT_UNAUTHORIZED==='0')issues.push('TLS verification must remain enabled.');
  if(environment.NODE_OPTIONS?.trim())issues.push('Release runtime must not inherit arbitrary Node preloads or options.');
  if(Object.entries(environment).some(([field,value])=>/^APEX_(?:FIXTURE|ACCEPTANCE)/.test(field)&&value))issues.push('Acceptance fixture variables cannot enter release configuration.');
  if(environment.APEX_NEXT_DIST_DIR && environment.APEX_NEXT_DIST_DIR!=='.next')issues.push('Release must use a fresh standard production output directory.');
  for(const field of ['DATABASE_URL','DATABASE_WORKER_URL','UPSTASH_REDIS_REST_URL']) {
    try {const value=new URL(environment[field]??'');if(/^(?:127\.|localhost$|\[::1\]$)/.test(value.hostname) || value.hostname.endsWith('.localhost') || /apex.disposable|\.invalid$/.test(value.hostname) || /apex_disposable/.test(value.pathname))issues.push('Loopback or disposable services are excluded by this external deployment release policy.');}catch{}
  }
  if(environment.NEXT_PUBLIC_SITE_URL?.includes('.invalid'))issues.push('A test site origin cannot be released.');
  return {ready:issues.length===0,issues,serviceConnectionsVerified:false};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    const args=process.argv.slice(2);
    if(args.some(value=>!['--source-only','--manifest'].includes(value)))throw new Error('Unsupported preflight option.');
    const report={sourceOnly:args.includes('--source-only'),serviceConnectionsVerified:false};
    if(args.includes('--manifest'))report.source=await inspectReleaseManifest(root);
    const { inspectSchedulers }=await import('./verify-scheduler.mjs');report.schedulers=await inspectSchedulers(root);
    if(!report.sourceOnly) {
      const require=createRequire(path.join(root,'apps/workers/package.json'));
      const { tsImport }=await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
      const { inspectProductionSecurityConfiguration }=await tsImport(pathToFileURL(path.join(root,'apps/web/lib/security-configuration.ts')).href,{parentURL:import.meta.url,tsconfig:path.join(root,'apps/web/tsconfig.json')});
      report.configuration=inspectProductionSecurityConfiguration(process.env);
      report.runtimeIsolation=inspectRuntimeIsolation(process.env);
    }
    console.log(JSON.stringify(report,null,2));
    if([report.source,report.schedulers,report.configuration,report.runtimeIsolation].filter(Boolean).some(item=>!item.ready))process.exitCode=1;
  } catch {console.error('Release preflight failed safely. No supplied configuration values were printed.');process.exitCode=1;}
}
