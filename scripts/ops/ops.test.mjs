import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportRelease,includeReleasePath,allowlistedReleaseFile,canonicalManifest,releaseRoots,releaseFiles } from './export-release.mjs';
import { inspectReleaseManifest,inspectRuntimeIsolation } from './release-preflight.mjs';
import { validateDrillConfiguration,validateRestoreName,canonicalAcl } from './backup-restore-drill.mjs';
import { inspectSchedulers } from './verify-scheduler.mjs';
import { scanRecognizableSecrets } from './secret-scan.mjs';
async function workspace(fn) {
  const root=await mkdtemp(path.join(os.tmpdir(),'apex-ops-test-'));
  try{return await fn(root);}finally{const resolved=path.resolve(root);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('apex-ops-test-'))throw new Error('Unsafe test cleanup.');await rm(resolved,{recursive:true,force:false});}
}
async function sourceAt(root) {
  const source=path.join(root,'source');await mkdir(source);
  for(const item of releaseRoots)await mkdir(path.join(source,item),{recursive:true});
  for(const item of releaseFiles)await writeFile(path.join(source,item),'{}\n');
  await writeFile(path.join(source,'apps/web/runtime.ts'),'export const useful=true;\n');
  return source;
}
test('clean export excludes env, generated data, acceptance scripts and secret drop files',()=>{
  for(const item of ['apps/web/.env','apps/web/.env.local','apps/web/.env.production','apps/web/.env.example.local','apps/web/.next-audit/server/page.js','apps/web/tests/quality-gate/.reports/run.json','.secrets/production.env','apps/web/.private/config.json','apps/web/.next/preload.cjs','apps/web/next-env.d.ts','scripts/backend-acceptance.mjs','packages/db/scripts/bootstrap-disposable.mjs','packages/db/migrations/fixtures/data.sql','apps/web/codes.txt','apps/web/keys.txt','apps/web/debug.log'])assert.equal(includeReleasePath(item),false,item);
  assert.equal(allowlistedReleaseFile('apps/web/public/fonts/local.woff2'),true);
  // The blank configuration template ships with the public source.
  assert.equal(allowlistedReleaseFile('apps/web/.env.example'),true);
  assert.equal(includeReleasePath('apps/web/app/api/articles/audit/route.ts'),true);
  assert.equal(allowlistedReleaseFile('apps/web/app/api/articles/audit/route.ts'),true);
  assert.equal(includeReleasePath('audit/report.json'),false);
  assert.equal(allowlistedReleaseFile('audit/report.json'),false);
  assert.equal(allowlistedReleaseFile('arbitrary-root.json'),false);
  assert.equal(allowlistedReleaseFile('scripts/.private/config.json'),false);
  assert.equal(allowlistedReleaseFile('apps/web/../secrets.json'),false);
});
test('export manifests are deterministic despite listing order',()=>{const a={path:'z',bytes:1,sha256:'a'.repeat(64)},b={path:'a',bytes:2,sha256:'b'.repeat(64)};assert.deepEqual(canonicalManifest([a,b]),canonicalManifest([b,a]));});
test('two independent exports have identical bytes and pass manifest verification',()=>workspace(async root=>{
  const source=await sourceAt(root);await writeFile(path.join(source,'apps/web/.env.local'),'PRIVATE=should-never-copy');
  const generatedTypes='import "./.next/old-acceptance-build/types/routes.d.ts";\n';await writeFile(path.join(source,'apps/web/next-env.d.ts'),generatedTypes);
  const routePath='apps/web/app/api/articles/audit/route.ts',routeBody='export async function GET() { return Response.json({audit:true}); }\n';await mkdir(path.dirname(path.join(source,routePath)),{recursive:true});await writeFile(path.join(source,routePath),routeBody);
  await mkdir(path.join(source,'audit'));await writeFile(path.join(source,'audit/report.json'),'generated evidence\n');
  const a=await exportRelease(source,path.join(root,'a'));const b=await exportRelease(source,path.join(root,'b'));assert.equal(a.digest,b.digest);
  for(const target of ['a','b'])await assert.rejects(readFile(path.join(root,target,'apps/web/next-env.d.ts')),error=>error.code==='ENOENT');
  for(const target of ['a','b']){assert.equal(await readFile(path.join(root,target,routePath),'utf8'),routeBody);await assert.rejects(readFile(path.join(root,target,'audit/report.json')),error=>error.code==='ENOENT');}
  assert.equal(a.files.some(file=>file.path===routePath),true);
  assert.equal(await readFile(path.join(source,'apps/web/next-env.d.ts'),'utf8'),generatedTypes);
  assert.equal(a.files.some(file=>file.path==='apps/web/next-env.d.ts'),false);
  assert.equal((await inspectReleaseManifest(path.join(root,'a'))).ready,true);
  await assert.rejects(exportRelease(source,path.join(root,'a')));
}));
test('manifest rejects an extra private env and altered runtime source',()=>workspace(async root=>{
  const source=await sourceAt(root);await exportRelease(source,path.join(root,'a'));
  await writeFile(path.join(root,'a/.env.local'),'PRIVATE=not-a-release');assert.equal((await inspectReleaseManifest(path.join(root,'a'))).ready,false);
  await rm(path.join(root,'a/.env.local'));
  await writeFile(path.join(root,'a/apps/web/runtime.ts'),'altered');assert.equal((await inspectReleaseManifest(path.join(root,'a'))).ready,false);
}));
test('a self-consistent forged manifest cannot include private paths',()=>workspace(async root=>{
  const source=await sourceAt(root);await exportRelease(source,path.join(root,'a'));const file=path.join(root,'a/RELEASE-MANIFEST.json');const manifest=JSON.parse(await readFile(file));
  manifest.files.push({path:'scripts/.private/key.json',bytes:0,sha256:'a'.repeat(64)});const forged=canonicalManifest(manifest.files);await writeFile(file,JSON.stringify(forged));await assert.rejects(inspectReleaseManifest(path.join(root,'a')),/Unsafe/);
}));
test('export refuses linked source inputs and linked destination inside source',()=>workspace(async root=>{
  const source=await sourceAt(root);const external=path.join(root,'external');await mkdir(external);
  await symlink(external,path.join(source,'apps/web/linked'),'junction');await assert.rejects(exportRelease(source,path.join(root,'a')),/link/);
  await symlink(source,path.join(root,'redirect'),'junction');await assert.rejects(exportRelease(source,path.join(root,'redirect/new-release')),/inside/);
}));
test('release runtime rejects TLS bypass, preloads and disposable service config',()=>{
  for(const env of [{NODE_TLS_REJECT_UNAUTHORIZED:'0'},{NODE_OPTIONS:'--require fixture.cjs'},{APEX_FIXTURE_RESUME_PATH:'private-state.json'},{APEX_NEXT_DIST_DIR:'.next/acceptance'},{DATABASE_URL:'postgresql://user:pass@[::1]:55432/apex_disposable'},{DATABASE_WORKER_URL:'postgresql://user:pass@127.3.1.4/db'},{UPSTASH_REDIS_REST_URL:'https://apex-disposable.upstash.io/'}])assert.equal(inspectRuntimeIsolation(env).ready,false);
  assert.equal(inspectRuntimeIsolation({}).serviceConnectionsVerified,false);
});
test('restore source validation refuses external, wrong database, bypass and unexpected startup options',()=>{
  const config={environment:'disposable-local',protectedDatabaseConnected:false,runId:'apex-backend-continuation-20261004-e4baacb415',database:{ownerUrl:'postgres://apex_owner:private@127.0.0.1:55432/apex_disposable',caPath:path.resolve('ca.pem')}};
  assert.equal(validateDrillConfiguration(config,config.runId).pathname,'/apex_disposable');
  assert.throws(()=>validateDrillConfiguration(config,'wrong-window'));
  for(const suffix of ['?statement_timeout=0','?sslmode=disable'])assert.throws(()=>validateDrillConfiguration({...config,database:{...config.database,ownerUrl:config.database.ownerUrl+suffix}},config.runId));
  for(const url of ['postgres://apex_owner:private@external.invalid:55432/apex_disposable','postgres://apex_owner:private@127.0.0.1:55432/protected','postgres://runtime:private@127.0.0.1:55432/apex_disposable'])assert.throws(()=>validateDrillConfiguration({...config,database:{...config.database,ownerUrl:url}},config.runId));
  assert.throws(()=>validateDrillConfiguration({...config,protectedDatabaseConnected:true},config.runId));
});
test('restore target identity permits only a newly owned exact prefix',()=>{assert.equal(validateRestoreName('apex_restore_20261004_abcdef0123456789'),true);for(const name of ['apex_disposable','postgres','apex_restore_20261004_x;drop database apex_disposable','apex_restore_20261004_123'])assert.equal(validateRestoreName(name),false);});
test('semantic ACL ordering never hides a distinct grantee, grant option or PUBLIC grant',()=>{
  const owner={grantor:'apex_owner',grantee:'apex_owner',privilege:'SELECT',grantable:false},worker={grantor:'apex_owner',grantee:'apex_worker',privilege:'SELECT',grantable:false};
  assert.deepEqual(canonicalAcl([owner,worker]),canonicalAcl([worker,owner]));
  assert.notDeepEqual(canonicalAcl([owner,worker]),canonicalAcl([owner,{...worker,grantee:'PUBLIC'}]));
  assert.notDeepEqual(canonicalAcl([owner,worker]),canonicalAcl([owner,{...worker,grantable:true}]));
  assert.notDeepEqual(canonicalAcl([owner,worker]),canonicalAcl([owner]));
});
test('recognizable-secret findings expose only category/path, including in test source',()=>{
  const tokens=['ghp_'+'A'.repeat(36),'hf_'+'B'.repeat(30),'gsk_'+'C'.repeat(40),'re_'+'D'.repeat(32),'sk-proj-'+'E'.repeat(40),'AIza'+'F'.repeat(35),'-----BEGIN '+'PRIVATE KEY-----'];
  for(const token of tokens){const findings=scanRecognizableSecrets(Buffer.from(token),'apps/web/token.test.ts');assert.equal(findings.length,1);assert.deepEqual(Object.keys(findings[0]),['path','category']);assert.equal(JSON.stringify(findings).includes(token),false);}
  for(const harmless of ['public-key identifier','hf_placeholder','-----BEGIN '+'CERTIFICATE-----','process.env.RESEND_API_KEY'])assert.deepEqual(scanRecognizableSecrets(harmless,'source.ts'),[]);
});
test('export fails before copying recognizable secrets and retains incomplete marker',()=>workspace(async root=>{
  const source=await sourceAt(root);const token='gsk_'+'G'.repeat(40);await writeFile(path.join(source,'apps/web/runtime.ts'),token);
  await assert.rejects(exportRelease(source,path.join(root,'a')),error=>error.findings?.[0].category==='groq-token'&&!error.message.includes(token));
  assert.equal((await readFile(path.join(root,'a/EXPORT-INCOMPLETE'),'utf8')).includes(token),false);await assert.rejects(readFile(path.join(root,'a/apps/web/runtime.ts')));
}));
test('a recomputed manifest does not bless injected recognizable credentials',()=>workspace(async root=>{
  const source=await sourceAt(root);await exportRelease(source,path.join(root,'a'));const token='ghp_'+'H'.repeat(36);const file=path.join(root,'a/apps/web/runtime.ts');await writeFile(file,token);
  const manifest=JSON.parse(await readFile(path.join(root,'a/RELEASE-MANIFEST.json')));const crypto=await import('node:crypto');const entry=manifest.files.find(item=>item.path==='apps/web/runtime.ts');entry.bytes=Buffer.byteLength(token);entry.sha256=crypto.createHash('sha256').update(token).digest('hex');await writeFile(path.join(root,'a/RELEASE-MANIFEST.json'),JSON.stringify(canonicalManifest(manifest.files)));
  const result=await inspectReleaseManifest(path.join(root,'a'));assert.equal(result.ready,false);assert.equal(result.recognizedSecretFindings[0].category,'github-token');assert.equal(JSON.stringify(result).includes(token),false);
}));
test('all eight reviewed scheduler sources pass without any invocation',async()=>{const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');const result=await inspectSchedulers(root);assert.equal(result.ready,true);assert.equal(result.schedulerCount,8);assert.equal(result.providerCallsPerformed,0);assert.equal(result.remoteRunsVerified,false);});
test('scheduler changes cannot hide an extra command, duplicate cadence or comment-only authentication',()=>workspace(async folder=>{
  const original=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');const root=await sourceAt(folder);
  const files=['apps/web/vercel.json','apps/web/lib/leased-cron.ts','.github/workflows/refresh-news.yml','.github/workflows/refresh-weather.yml','.github/workflows/refresh-season.yml','.github/workflows/refresh-weekend.yml','.github/workflows/refresh-videos.yml',...['jolpica-nightly','youtube-sync','newsletter-blast','rss-sync','weather-sync','weekend-watch'].map(route=>`apps/web/app/api/cron/${route}/route.ts`)];
  for(const file of files){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),await readFile(path.join(original,file)));}
  assert.equal((await inspectSchedulers(root)).ready,true);
  const workflow=path.join(root,'.github/workflows/refresh-news.yml');const old=await readFile(workflow);await writeFile(workflow,Buffer.concat([old,Buffer.from('\n      - run: curl https://unexpected.invalid/mutation\n')]));assert.equal((await inspectSchedulers(root)).ready,false);await writeFile(workflow,old);
  const configFile=path.join(root,'apps/web/vercel.json');const config=JSON.parse(await readFile(configFile));config.crons.push(config.crons[0]);await writeFile(configFile,JSON.stringify(config));assert.equal((await inspectSchedulers(root)).ready,false);config.crons.pop();await writeFile(configFile,JSON.stringify(config));
  await writeFile(path.join(root,'apps/web/app/api/cron/weather-sync/route.ts'),'// isAuthorizedCronRequest(req)\nexport async function GET(req: Request) { return Response.json({ok:true}); }');assert.equal((await inspectSchedulers(root)).ready,false);
}));
