import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const expectedVercel = new Map([['jolpica-nightly','0 3 * * *'],['youtube-sync','0 4 * * *'],['newsletter-blast','0 6 * * 5']]);
// [route, workflow]: jolpica-nightly also has GitHub catch-up runs that continue deferred rounds
// (--until-complete, hence a longer job timeout); weekend-watch makes race-weekend results appear on
// their own; youtube-sync adds two-hourly video refreshes to the daily hosting run. Weather, weekend
// news, video and season jobs retry a provider outage in-run (scripts/invoke-cron.mjs, up to 8 minutes), hence
// their 10-minute (season: 15) timeouts (cron resilience, 2026-10-31).
const expectedGithub = [
  ['rss-sync',{file:'refresh-news.yml',schedules:['2,32 * * * *'],timeout:10}],
  ['weather-sync',{file:'refresh-weather.yml',schedules:['17 * * * *'],timeout:10}],
  ['jolpica-nightly',{file:'refresh-season.yml',schedules:['35 3-5 * * *'],timeout:15}],
  ['weekend-watch',{file:'refresh-weekend.yml',schedules:['4-54/10 * * * 5,6,0','4-54/10 0-6 * * 1'],timeout:10}],
  ['youtube-sync',{file:'refresh-videos.yml',schedules:['41 */2 * * *'],timeout:10}],
];
// Reviewed full workflow bytes: extra schedules, steps or permissions require review.
const workflowHashes=new Map([['refresh-news.yml','6a934444a2da6da3ee117c9eb99e88774b1eee36a5fec7035cbce314ce5002b9'],['refresh-weather.yml','843f1c96af2f0b4b9fc748de8ab9647dc4a1d1a47f4ae14c2f6867d90a0f3cda'],['refresh-season.yml','a61e6d85d5e37628c78c827a82ba3e753e3a0e09bdd530edb08e24ef50f7744a'],['refresh-weekend.yml','c35824921866cd633ee7e537c465b6d649357774455976bab61a912dcaf0c307'],['refresh-videos.yml','c4acd495aa6040960a1ccf5393c03a34fa8877ed86045e5a97441f2def1967c9']]);
export async function inspectSchedulers(root) {
  const issues=[];
  const vercel=JSON.parse(await readFile(path.join(root,'apps/web/vercel.json'),'utf8'));
  if (!Array.isArray(vercel.crons) || vercel.crons.length!==3) issues.push('Exactly three hosting cron declarations are required.');
  const seen=new Set();
  for (const item of vercel.crons ?? []) {
    const route=item.path?.match(/^\/api\/cron\/([a-z-]+)$/)?.[1];
    if (!route || seen.has(route) || expectedVercel.get(route)!==item.schedule) issues.push('Hosting schedule identity or cadence drifted.');
    seen.add(route);
  }
  for (const [route,item] of expectedGithub) {
    const content=await readFile(path.join(root,'.github/workflows',item.file),'utf8');
    if(createHash('sha256').update(content.replaceAll('\r\n','\n')).digest('hex')!==workflowHashes.get(item.file))issues.push('A scheduler workflow differs from its reviewed content (LF-normalized); review all steps and refresh its digest.');
    const declared=[...content.matchAll(/cron: "([^"]+)"/g)].map(match=>match[1]);
    if (declared.length!==item.schedules.length || item.schedules.some(schedule=>!declared.includes(schedule)) || !content.includes(`node scripts/invoke-cron.mjs ${route}`)) issues.push('Repository schedule identity or cadence drifted.');
    for (const fragment of ['contents: read','persist-credentials: false','cancel-in-progress: false',`timeout-minutes: ${item.timeout}`,'CRON_SECRET: ${{ secrets.CRON_SECRET }}','APEX_SITE_URL: ${{ vars.APEX_SITE_URL }}']) if (!content.includes(fragment)) issues.push('Repository scheduler safety configuration drifted.');
    if (/uses:\s*[^\s]+@(?![0-9a-f]{40}\b)/.test(content)) issues.push('Scheduler action is not pinned to an immutable commit.');
  }
  for (const route of new Set([...expectedVercel.keys(),...expectedGithub.map(([route])=>route)])) {
    const source=(await readFile(path.join(root,'apps/web/app/api/cron',route,'route.ts'),'utf8')).replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    if (!/export\s+async\s+function\s+GET\b/.test(source) || !/runLeasedCron\(|isAuthorizedCronRequest\(/.test(source)) issues.push('A scheduler endpoint no longer exposes the checked authenticated GET contract.');
  }
  const lease=await readFile(path.join(root,'apps/web/lib/leased-cron.ts'),'utf8');
  if(!/isAuthorizedCronRequest\(request\)/.test(lease))issues.push('Shared lease wrapper no longer checks the authenticated request.');
  return {ready:issues.length===0,issues,schedulerCount:expectedVercel.size+expectedGithub.length,checks:'Exact reviewed scheduler configuration; heuristic endpoint authentication wiring. Runtime behavior requires separate HTTP acceptance.',remoteRunsVerified:false,providerCallsPerformed:0};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const result=await inspectSchedulers(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'));console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=1;}
  catch {console.error('Scheduler source inspection failed.');process.exitCode=1;}
}
