import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateDependencyAudits } from './dependency-audit-policy.mjs';

/** Bound every owned subprocess, including its descendants on timeout. */
export function runAuditCommand(args,{root,timeoutMs=60_000,maxStdout=8*1024*1024,maxStderr=1024*1024}={}) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1)throw new Error('A finite positive command deadline is required.');
  return new Promise(resolveResult=>{
    const child=spawn(process.execPath,args,{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
    let stdout='',stderr='',stdoutBytes=0,stderrBytes=0,closed=false,timedOut=false,outputLimitExceeded=false,spawnError=false,termination;
    const terminate=()=>{
      if(closed||termination)return;
      if(process.platform==='win32'){
        // PID is the process created above; no discovered or external process is targeted.
        termination=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
        const timer=setTimeout(()=>{termination.kill();if(!closed)child.kill();},4000);
        termination.on('error',()=>{clearTimeout(timer);if(!closed)child.kill();});
        termination.on('close',code=>{clearTimeout(timer);if(code!==0&&!closed)child.kill();});
      }else{
        try{process.kill(-child.pid,'SIGKILL');}catch{if(!closed)child.kill('SIGKILL');}
        termination=true;
      }
    };
    const timer=setTimeout(()=>{timedOut=true;terminate();},timeoutMs);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{stdoutBytes+=Buffer.byteLength(chunk);if(stdoutBytes>maxStdout){outputLimitExceeded=true;terminate();}else stdout+=chunk;});
    child.stderr.on('data',chunk=>{stderrBytes+=Buffer.byteLength(chunk);if(stderrBytes>maxStderr){outputLimitExceeded=true;terminate();}else stderr+=chunk;});
    child.on('error',()=>{spawnError=true;});
    child.on('close',(code,signal)=>{closed=true;clearTimeout(timer);resolveResult({code,signal,stdout,stderr,timedOut,outputLimitExceeded,spawnError});});
  });
}

/** Persist a fresh fail-closed verdict before touching registry or installed code. */
export async function runDependencyAudit({root,cli,command=runAuditCommand,now=()=>new Date().toISOString()}={}) {
  const directory=resolve(root,'dependency-security-reports');mkdirSync(directory,{recursive:true});
  const status={schemaVersion:1,runId:randomUUID(),startedAt:now(),finishedAt:null,status:'running',ready:false,phase:'initializing',commands:[],reports:{}};
  const save=(name,value)=>writeFileSync(resolve(directory,name+'.json'),JSON.stringify(value,null,2));
  let policy={ready:false,rejected:['Dependency audit run has not completed.'],mitigated:[]};
  const saveVerdict=()=>save('mitigations',{...policy,runId:status.runId,startedAt:status.startedAt,finishedAt:status.finishedAt});
  saveVerdict();save('run-status',status);
  for(const name of ['full','production']){
    save(name,{status:'not-run',runId:status.runId,startedAt:status.startedAt});
    writeFileSync(resolve(directory,name+'.stdout.log'),'');
  }
  async function invoke(phase,args,allowedCodes,timeoutMs){
    status.phase=phase;save('run-status',status);
    const result=await command(args,{root,timeoutMs});
    const record={phase,exitCode:result.code,signal:result.signal??null,timedOut:result.timedOut===true,
      outputLimitExceeded:result.outputLimitExceeded===true,spawnError:result.spawnError===true,
      stdoutBytes:Buffer.byteLength(result.stdout??''),stderrBytes:Buffer.byteLength(result.stderr??'')};
    status.commands.push(record);save('run-status',status);
    if(phase==='full'||phase==='production')writeFileSync(resolve(directory,phase+'.stdout.log'),result.stdout??'');
    if(!allowedCodes.includes(result.code)||record.timedOut||record.outputLimitExceeded||record.spawnError)throw new Error('Dependency '+phase+' command did not complete safely.');
    return result;
  }
  try{
    if(!cli||!/pnpm\.(?:cjs|js)$/.test(cli))throw new Error('Run through the pinned pnpm script or provide its CLI path.');
    const version=await invoke('package-manager',[cli,'--version'],[0],10_000);
    if(version.stdout.trim()!=='10.33.0')throw new Error('Use pinned pnpm 10.33.0 for the exact dependency audit.');
    const reports={};
    for(const [name,args]of [['full',['audit','--json']],['production',['audit','--prod','--json']]]){
      const result=await invoke(name,[cli,...args,'--registry=https://registry.npmjs.org/'],[0,1],60_000);
      // Current bounded stdout is retained even when it is not valid registry JSON.
      try{reports[name]=JSON.parse(result.stdout);}catch{throw new Error('Registry '+name+' audit returned invalid JSON.');}
      save(name,reports[name]);
      status.reports[name]={sha256:createHash('sha256').update(readFileSync(resolve(directory,name+'.json'))).digest('hex')};
      save('run-status',status);
    }
    const expectedPatchHash='436b18f76998cf25164f0555dbc52c117c7192203c9f08d851a6fff86f8701ff';
    const packageManifest=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
    const patchVerified=packageManifest.pnpm?.patchedDependencies?.['braces@3.0.3']==='patches/braces@3.0.3.patch'&&
      createHash('sha256').update(readFileSync(resolve(root,'patches/braces@3.0.3.patch'))).digest('hex')===expectedPatchHash;
    const regression=await invoke('installed-regression',['--test',resolve(root,'scripts/braces-security.test.mjs')],[0,1],20_000);
    policy=evaluateDependencyAudits(reports.full,reports.production,{now:now(),patchVerified,regressionPassed:regression.code===0});
    status.ready=policy.ready;status.status=policy.ready?'passed':'failed';
  }catch(error){
    policy={ready:false,rejected:[error instanceof Error?error.message:'Dependency audit failed.'],mitigated:[]};
    status.status='failed';status.ready=false;
  }
  status.finishedAt=now();saveVerdict();save('run-status',status);
  return {...policy,runId:status.runId,startedAt:status.startedAt,finishedAt:status.finishedAt};
}

const script=fileURLToPath(import.meta.url);
if(process.argv[1]&&resolve(process.argv[1])===script){
  const root=resolve(dirname(script),'..');
  const cli=process.argv[2]==='--pnpm-cli'&&process.argv.length===4?process.argv[3]:process.argv.length===2?process.env.npm_execpath:null;
  const result=await runDependencyAudit({root,cli});console.log(JSON.stringify(result,null,2));
  if(!result.ready)process.exitCode=1;
}
