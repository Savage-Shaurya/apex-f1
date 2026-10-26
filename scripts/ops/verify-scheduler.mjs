import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const expectedVercel = new Map([['jolpica-nightly','0 3 * * *'],['youtube-sync','0 4 * * *'],['newsletter-blast','0 6 * * 5']]);
// [route, workflow]: jolpica-nightly also has GitHub catch-up runs that continue deferred rounds
// (--until-complete, hence a longer job timeout); weekend-watch makes race-weekend results appear on
// their own; youtube-sync adds two-hourly video refreshes to the daily hosting run.
const expectedGithub = [
  ['rss-sync',{file:'refresh-news.yml',schedules:['2,32 * * * *'],timeout:3}],
  ['weather-sync',{file:'refresh-weather.yml',schedules:['17 * * * *'],timeout:3}],
  ['jolpica-nightly',{file:'refresh-season.yml',schedules:['35 3-5 * * *'],timeout:10}],
  ['weekend-watch',{file:'refresh-weekend.yml',schedules:['4-54/10 * * * 5,6,0','4-54/10 0-6 * * 1'],timeout:3}],
  ['youtube-sync',{file:'refresh-videos.yml',schedules:['41 */2 * * *'],timeout:3}],
];
// Reviewed full workflow bytes: extra schedules, steps or permissions require review.
const workflowHashes=new Map([['refresh-news.yml','6dfdfc8537c500c24185f9f6f0edd8086ad6967ef537e79d2b28ecec3853fb92'],['refresh-weather.yml','4b8e9b5f47dfa7cdd99c8c627a9aed0d21712d244a1009aa0a6b48a55b8abbde'],['refresh-season.yml','715251151884c4205bcee5c91b517f3a7121925dfa6ce010174c42e82d782cd1'],['refresh-weekend.yml','3a1a06bcd6b6a8456469c32d16ee780e924393563d9ea48f156bf288f867dc7c'],['refresh-videos.yml','5e6cc289acd69e88f95b41b848fff4569d4c929b4251f639e0c520e7c907dbc9']]);
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
