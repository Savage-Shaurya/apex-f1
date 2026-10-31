import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateDependencyAudits} from './dependency-audit-policy.mjs';
import {runDependencyAudit,runAuditCommand} from './dependency-audit.mjs';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const empty=()=>({advisories:{},metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0}}});
const report=()=>({advisories:{a:{module_name:'braces',url:'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',severity:'high',findings:[{version:'3.0.3',paths:['apps__web>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces']}]}},metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:1,critical:0}}});
const evidence={now:'2026-10-04T00:00:00Z',patchVerified:true,regressionPassed:true};
test('only the exact tested development dependency mitigation receives bounded acceptance',()=>{
  const accepted=evaluateDependencyAudits(report(),empty(),evidence);
  assert.equal(accepted.ready,true);assert.equal(accepted.mitigated.length,1);
  for(const altered of [{patchVerified:false},{regressionPassed:false},{now:'2026-10-18T00:00:00Z'},{now:'invalid'}]) assert.equal(evaluateDependencyAudits(report(),empty(),{...evidence,...altered}).ready,false);
  for(const alter of [a=>a.url+='-other',a=>a.module_name='other',a=>a.findings[0].version='3.0.2',a=>a.findings[0].paths.push('apps__web>runtime>braces')]){
    const candidate=report();alter(candidate.advisories.a);assert.equal(evaluateDependencyAudits(candidate,empty(),evidence).ready,false);
  }
});
test('production advisories, unknown advisories and invalid registry responses remain release failures',()=>{
  assert.equal(evaluateDependencyAudits(report(),report(),evidence).ready,false);
  const unknown=report();unknown.advisories.b={module_name:'other',severity:'moderate'};
  assert.equal(evaluateDependencyAudits(unknown,empty(),evidence).ready,false);
  assert.equal(evaluateDependencyAudits({},empty(),evidence).ready,false);
  const counts=empty();counts.metadata.vulnerabilities.high=1;
  assert.equal(evaluateDependencyAudits(empty(),counts,evidence).ready,false);
  const incomplete=empty();delete incomplete.metadata.vulnerabilities.high;
  assert.equal(evaluateDependencyAudits(incomplete,empty(),evidence).ready,false);
  const muted=empty();muted.muted=['unexpected suppression'];
  assert.equal(evaluateDependencyAudits(muted,empty(),evidence).ready,false);
  assert.equal(evaluateDependencyAudits(empty(),empty(),evidence).ready,true);
});

test('malformed registry objects and severity-swapped totals cannot create a passing verdict',()=>{
  for(const change of [
    value=>value.advisories=[],value=>value.advisories='none',
    value=>value.metadata=[],value=>value.metadata.vulnerabilities=[],
    value=>value.muted={},value=>value.muted='ignored',value=>value.muted=null,
    value=>value.metadata.vulnerabilities.total=0,
  ]){
    const malformed=empty();change(malformed);
    assert.equal(evaluateDependencyAudits(malformed,empty(),evidence).ready,false);
    assert.equal(evaluateDependencyAudits(empty(),malformed,evidence).ready,false);
  }
  const swapped=report();swapped.metadata.vulnerabilities.high=0;swapped.metadata.vulnerabilities.low=1;
  assert.equal(evaluateDependencyAudits(swapped,empty(),evidence).ready,false);
  const unknownSeverity=report();unknownSeverity.advisories.a.severity='unknown';
  assert.equal(evaluateDependencyAudits(unknownSeverity,empty(),evidence).ready,false);
  const malformedFinding=report();malformedFinding.advisories.a.findings=[null];
  assert.equal(evaluateDependencyAudits(malformedFinding,empty(),evidence).ready,false);
});

test('registry transport and invalid JSON replace stale success before any command runs',async()=>{
  for(const failure of ['transport','invalid-json','timeout']){
    const directory=await mkdtemp(path.join(tmpdir(),'apex-audit-failure-'));
    try{
      const reports=path.join(directory,'dependency-security-reports');await mkdir(reports);
      for(const name of ['mitigations','run-status','full','production'])await writeFile(path.join(reports,name+'.json'),JSON.stringify({ready:true,oldRun:true}));
      for(const name of ['full','production'])await writeFile(path.join(reports,name+'.stdout.log'),'old successful stdout');
      let calls=0;
      const command=async()=>{
        const initial=JSON.parse(await readFile(path.join(reports,'mitigations.json'),'utf8'));
        assert.equal(initial.ready,false);assert.equal(initial.oldRun,undefined);
        calls++;
        if(calls===1)return {code:0,stdout:'10.33.0\n',stderr:''};
        if(failure==='transport')return {code:2,stdout:'',stderr:'network unavailable'};
        if(failure==='timeout')return {code:0,stdout:'',stderr:'',timedOut:true};
        return {code:0,stdout:'not registry JSON',stderr:''};
      };
      const result=await runDependencyAudit({root:directory,cli:path.join(directory,'pnpm.cjs'),command});
      assert.equal(result.ready,false);assert.equal(calls,2);
      const verdict=JSON.parse(await readFile(path.join(reports,'mitigations.json'),'utf8'));
      const status=JSON.parse(await readFile(path.join(reports,'run-status.json'),'utf8'));
      const production=JSON.parse(await readFile(path.join(reports,'production.json'),'utf8'));
      assert.equal(verdict.ready,false);assert.equal(verdict.oldRun,undefined);
      assert.equal(status.status,'failed');assert.equal(status.ready,false);
      assert.equal(verdict.runId,status.runId);assert.ok(status.startedAt);assert.ok(status.finishedAt);
      assert.equal(production.status,'not-run');assert.equal(production.oldRun,undefined);
      if(failure==='invalid-json')assert.equal(await readFile(path.join(reports,'full.stdout.log'),'utf8'),'not registry JSON');
      else assert.equal(await readFile(path.join(reports,'full.stdout.log'),'utf8'),'');
      assert.equal(await readFile(path.join(reports,'production.stdout.log'),'utf8'),'');
    }finally{await rm(directory,{recursive:true,force:true});}
  }
});

test('command deadlines stop the owned process tree rather than leaving a running descendant',async()=>{
  const code="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});child.on('spawn',()=>process.stdout.write(JSON.stringify({parent:process.pid,descendant:child.pid})+'\\n'));setInterval(()=>{},1000);";
  const started=Date.now();
  const result=await runAuditCommand(['-e',code],{timeoutMs:1000});
  assert.equal(result.timedOut,true);assert.equal(result.outputLimitExceeded,false);
  assert.ok(Date.now()-started<8000,'Owned process tree should terminate within the deadline plus cleanup allowance.');
  const ids=JSON.parse(result.stdout.trim());
  const running=async pid=>{
    try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')return false;throw error;}
    if(process.platform!=='win32'){
      try{if(/\) Z /.test(await readFile('/proc/'+pid+'/stat','utf8')))return false;}catch(error){if(error.code==='ENOENT')return false;}
    }
    return true;
  };
  for(const pid of [ids.parent,ids.descendant]){
    let alive=await running(pid);
    for(let attempts=0;alive&&attempts<40;attempts++){await new Promise(resolve=>setTimeout(resolve,25));alive=await running(pid);}
    assert.equal(alive,false,'Owned timed-out process remains running: '+pid);
  }
});

// 2026-10-31: GHSA-g3hv-75wg-m249 (minimatch) hit two installed versions, so npm counted moderate:2 for one
// advisory and the gate failed with a misleading "counts inconsistent" instead of naming the package.
test('registry counts are per finding, so a multi-version advisory is named, not reported as an inconsistent response',()=>{
  const full={advisories:{m:{module_name:'minimatch',url:'https://github.com/advisories/GHSA-g3hv-75wg-m249',severity:'moderate',
    findings:[{version:'3.1.5',paths:['apps__web>eslint>minimatch']},{version:'10.2.6',paths:['apps__web>x>minimatch']}]}},
    metadata:{vulnerabilities:{info:0,low:0,moderate:2,high:0,critical:0}}};
  const verdict=evaluateDependencyAudits(full,empty(),evidence);
  assert.equal(verdict.ready,false);
  assert.deepEqual(verdict.rejected,['Unmitigated dependency advisory: minimatch.']);
  // A total that matches neither advisories nor findings is still an inconsistent registry response.
  full.metadata.vulnerabilities.moderate=3;
  assert.deepEqual(evaluateDependencyAudits(full,empty(),evidence).rejected,['Registry advisory counts were incomplete or inconsistent.']);
});
