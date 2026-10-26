import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function validateDrillConfiguration(config,window) {
  if(config.environment!=='disposable-local' || config.protectedDatabaseConnected!==false || !/^(?:apex-backend-20261004|apex-backend-continuation-20261004-[a-f0-9]{10})$/.test(config.runId) || window!==config.runId)throw new Error('An explicitly issued disposable database window is required.');
  const url=new URL(config.database.ownerUrl);
  if(!['postgres:','postgresql:'].includes(url.protocol) || url.hostname!=='127.0.0.1' || url.port!=='55432' || url.pathname!=='/apex_disposable' || url.username!=='apex_owner' || !url.password || url.hash || url.search)throw new Error('Only the approved disposable source may be read.');
  if(!path.isAbsolute(config.database.caPath))throw new Error('An absolute trusted CA path is required.');
  return url;
}
export function validateRestoreName(name) {return /^apex_restore_20261004_[a-f0-9]{16}$/.test(name) && name!=='apex_disposable';}
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function canonicalAcl(entries) {
  if(!Array.isArray(entries))throw new Error('Native ACL expansion is required.');
  return entries.map(item=>({grantor:item.grantor,grantee:item.grantee,privilege:item.privilege,grantable:item.grantable})).sort((a,b)=>{const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;});
}

async function catalog(sql,observer) {
  const tables=await sql.unsafe(`SELECT n.nspname AS schema,c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,'privilege',x.privilege_type,'grantable',x.is_grantable)),'[]'::jsonb)
     FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x) AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','S','v','m') ORDER BY 1,2`);
  for(const table of tables)table.acl=canonicalAcl(table.acl);
  const columns=await sql.unsafe("SELECT n.nspname AS schema,c.relname AS name,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,a.attcollation::regcollation::text AS collation,pg_get_expr(d.adbin,d.adrelid) AS default,a.attacl::text AS acl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3");
  const constraints=await sql.unsafe("SELECT n.nspname AS schema,c.relname AS name,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') ORDER BY 1,2,3");
  const indexes=await sql.unsafe("SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('public','drizzle') ORDER BY 1,2,3");
  const policies=await sql.unsafe("SELECT schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('public','drizzle') ORDER BY 1,2,3");
  const schemas=await sql.unsafe("SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl::text AS acl FROM pg_namespace WHERE nspname IN ('public','drizzle') ORDER BY 1");
  const defaults=await sql.unsafe("SELECT pg_get_userbyid(d.defaclrole) AS role,coalesce(n.nspname,'') AS schema,d.defaclobjtype,d.defaclacl::text AS acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY 1,2,3");
  const functions=await sql.unsafe("SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS args,p.prosecdef,pg_get_userbyid(p.proowner) AS owner,p.proacl::text AS acl,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','drizzle') AND p.prokind IN ('f','p') ORDER BY 1,2,3");
  const types=await sql.unsafe("SELECT n.nspname,t.typname,e.enumsortorder,e.enumlabel FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname IN ('public','drizzle') ORDER BY 1,2,3");
  const triggers=await sql.unsafe("SELECT n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('public','drizzle') ORDER BY 1,2,3");
  const roles=await sql.unsafe("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN ('apex_owner','apex_runtime','apex_worker','apex_public') ORDER BY 1");
  const memberships=await sql.unsafe("SELECT pg_get_userbyid(roleid) AS role,pg_get_userbyid(member) AS member,pg_get_userbyid(grantor) AS grantor,admin_option,inherit_option,set_option FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('apex_owner','apex_runtime','apex_worker','apex_public')) ORDER BY 1,2,3");
  const database=await sql.unsafe("SELECT pg_get_userbyid(datdba) AS owner,encoding,datlocprovider,datcollate,datctype,coalesce(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale') AS locale,datacl::text AS acl FROM pg_database d WHERE datname=current_database()");
  const version=Number((await sql.unsafe("SELECT current_setting('server_version_num') AS version"))[0].version);
  const tablePrivileges=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER',...(version>=170000?['MAINTAIN']:[])];
  const privileges=[];
  for(const role of ['apex_runtime','apex_worker','apex_public']) {
    privileges.push(...await sql.unsafe("SELECT $1::text AS role,n.nspname AS schema,c.relname AS name,p.privilege,has_table_privilege($1::name,c.oid,p.privilege) AS allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY["+tablePrivileges.map(value=>"'"+value+"'").join(',')+"]) p(privilege) WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m') ORDER BY 2,3,4",[role]));
    privileges.push(...await sql.unsafe("SELECT $1::text AS role,n.nspname AS schema,c.relname AS name,a.attname AS column,p.privilege,has_column_privilege($1::name,c.oid,a.attnum,p.privilege) AS allowed FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege) WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 2,3,4,5",[role]));
    privileges.push(...await sql.unsafe("SELECT $1::text AS role,n.nspname AS schema,c.relname AS name,p.privilege,has_sequence_privilege($1::name,c.oid,p.privilege) AS allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']) p(privilege) WHERE n.nspname IN ('public','drizzle') AND c.relkind='S' ORDER BY 2,3,4",[role]));
    privileges.push(...await sql.unsafe("SELECT $1::text AS role,n.nspname AS schema,has_schema_privilege($1::name,n.oid,'USAGE') AS usage,has_schema_privilege($1::name,n.oid,'CREATE') AS create FROM pg_namespace n WHERE n.nspname IN ('public','drizzle') ORDER BY 2",[role]));
    privileges.push(...await sql.unsafe("SELECT $1::text AS role,has_database_privilege($1::name,current_database(),'CONNECT') AS connect,has_database_privilege($1::name,current_database(),'CREATE') AS create,has_database_privilege($1::name,current_database(),'TEMPORARY') AS temporary",[role]));
    privileges.push(...await sql.unsafe("SELECT $1::text AS role,n.nspname AS schema,p.proname,pg_get_function_identity_arguments(p.oid) AS args,has_function_privilege($1::name,p.oid,'EXECUTE') AS execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','drizzle') AND p.prokind IN ('f','p') ORDER BY 2,3,4",[role]));
  }
  const data=[];
  for(const table of tables.filter(item=>['r','p'].includes(item.relkind))) {
    const digest=createHash('sha256');let rows=0;
    for await(const batch of sql.unsafe(`SELECT to_jsonb(t)::text AS payload FROM ${quote(table.schema)}.${quote(table.name)} t ORDER BY to_jsonb(t)::text`).cursor(256))for(const row of batch){const body=Buffer.from(row.payload);digest.update(String(body.length)+':');digest.update(body);rows++;}
    data.push({schema:table.schema,name:table.name,rows,sha256:digest.digest('hex')});
  }
  const sequences=[];
  for(const sequence of tables.filter(item=>item.relkind==='S'))sequences.push({schema:sequence.schema,name:sequence.name,...(await sql.unsafe(`SELECT last_value::text,is_called FROM ${quote(sequence.schema)}.${quote(sequence.name)}`))[0]});
  const value={tables,columns,constraints,indexes,policies,schemas,defaults,functions,types,triggers,roles,memberships,database,privileges,data,sequences};
  if(observer)await observer(value);
  return {digest:hash(value),catalogDigest:hash({...value,data:undefined,sequences:undefined}),componentDigests:Object.fromEntries(Object.entries(value).map(([key,items])=>[key,hash(items)])),dataDigest:hash(data),sequenceDigest:hash(sequences),publicTables:tables.filter(item=>item.schema==='public'&&['r','p'].includes(item.relkind)).length,policyCount:policies.length,effectivePrivilegeChecks:privileges.length,rows:data.reduce((sum,item)=>sum+item.rows,0),data};
}
function pgCommand(tool,args,env,distribution) {
  return new Promise((resolve,reject)=>{
    const child=spawn(distribution?'wsl.exe':tool,distribution?['-d',distribution,'--exec','/usr/bin/'+tool,...args]:args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let bytes=0,deadlineReached=false,outputExceeded=false;
    const deadline=setTimeout(()=>{deadlineReached=true;child.kill();},180000);
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024){outputExceeded=true;child.kill();}});
    child.on('error',()=>{clearTimeout(deadline);reject(new Error('PostgreSQL client could not be started.'));});
    child.on('close',code=>{clearTimeout(deadline);code===0&&!deadlineReached&&!outputExceeded?resolve():reject(new Error('PostgreSQL client failed; private output withheld.'));});
  });
}
async function restrictPrivateDirectory(directory) {
  if(process.platform!=='win32')return;
  const run=(tool,args)=>new Promise((resolve,reject)=>{
    const child=spawn(tool,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let content='';
    const deadline=setTimeout(()=>child.kill(),10000);
    child.stdout.on('data',chunk=>{content+=chunk;if(content.length>65536)child.kill();});child.stderr.resume();
    child.on('error',()=>{clearTimeout(deadline);reject(new Error('Private archive access could not be restricted.'));});
    child.on('close',code=>{clearTimeout(deadline);code===0?resolve(content):reject(new Error('Private archive access could not be restricted.'));});
  });
  const sid=(await run('whoami.exe',['/user','/fo','csv','/nh'])).match(/S-1-5-[0-9-]+/)?.[0];
  if(!sid)throw new Error('Current Windows identity could not be verified.');
  await run('icacls.exe',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
}
export async function runDrill({config,window,output,distribution}) {
  const sourceUrl=validateDrillConfiguration(config,window);
  if(distribution!==undefined && distribution!=='apex-backend-disposable-20261004')throw new Error('Unknown disposable PostgreSQL distribution.');
  const directory=path.resolve(output);
  await mkdir(path.dirname(directory),{recursive:true});await mkdir(directory,{mode:0o700});await mkdir(path.join(directory,'.private'),{mode:0o700});
  await restrictPrivateDirectory(path.join(directory,'.private'));
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const require=createRequire(path.join(root,'packages/db/package.json'));const postgres=require('postgres');
  const options={ssl:{rejectUnauthorized:true,ca:await readFile(config.database.caPath,'utf8')},prepare:false,max:1,connect_timeout:10,connection:{statement_timeout:120000,lock_timeout:5000}};
  const maintenanceUrl=new URL(sourceUrl);maintenanceUrl.pathname='/postgres';
  const maintenance=postgres(maintenanceUrl.toString(),options);const source=postgres(sourceUrl.toString(),options);
  const name='apex_restore_20261004_'+randomBytes(8).toString('hex');if(!validateRestoreName(name))throw new Error('Invalid restore ownership name.');
  const dump=path.join(directory,'.private','database.dump');let created=false,restored,report,failure;
  await writeFile(path.join(directory,'owned-restore-target.json'),JSON.stringify({database:name,sourceDatabase:'apex_disposable',host:'127.0.0.1',port:55432,created:false,dropPermittedOnlyAfterOwnedCreate:true})+'\n',{flag:'wx'});
  try {
    const tls=(await source.unsafe('SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()'))[0];if(tls?.ssl!==true)throw new Error('Source TLS required.');
    const existing=await maintenance.unsafe('SELECT 1 FROM pg_database WHERE datname=$1',[name]);if(existing.length)throw new Error('Restore target already exists.');
    const clientEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
    Object.assign(clientEnv,{PGHOST:'127.0.0.1',PGPORT:'55432',PGUSER:decodeURIComponent(sourceUrl.username),PGPASSWORD:decodeURIComponent(sourceUrl.password),PGDATABASE:'apex_disposable',PGSSLMODE:'verify-full',PGSSLROOTCERT:config.database.caPath,PGCONNECT_TIMEOUT:'10'});
    delete clientEnv.NODE_OPTIONS;delete clientEnv.NODE_TLS_REJECT_UNAUTHORIZED;
    if(distribution)clientEnv.WSLENV='PGHOST:PGPORT:PGUSER:PGPASSWORD:PGDATABASE:PGSSLMODE:PGSSLROOTCERT/p:PGCONNECT_TIMEOUT';
    const clientPath=value=>distribution?'/mnt/'+value[0].toLowerCase()+value.slice(2).replaceAll('\\','/'):value;
    let baseline;
    await source.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY',async tx=>{
      const snapshot=(await tx.unsafe('SELECT pg_export_snapshot() AS snapshot'))[0].snapshot;
      baseline=await catalog(tx,value=>writeFile(path.join(directory,'.private','catalog-baseline.json'),JSON.stringify(value,null,2),{flag:'wx'}));
      if(baseline.publicTables!==35)throw new Error('The source is not the expected disposable application schema.');
      await pgCommand('pg_dump',['--format=custom','--snapshot='+snapshot,'--file='+clientPath(dump),'--no-password'],clientEnv,distribution);
    });
    await maintenance.unsafe(`CREATE DATABASE ${quote(name)} OWNER apex_owner TEMPLATE template0`);created=true;
    await writeFile(path.join(directory,'owned-restore-target.json'),JSON.stringify({database:name,sourceDatabase:'apex_disposable',host:'127.0.0.1',port:55432,created:true,dropPermittedOnlyAfterOwnedCreate:true})+'\n');
    await pgCommand('pg_restore',['--exit-on-error','--single-transaction','--dbname='+name,'--no-password',clientPath(dump)],{...clientEnv,PGDATABASE:name},distribution);
    const restoreUrl=new URL(sourceUrl);restoreUrl.pathname='/'+name;restored=postgres(restoreUrl.toString(),options);
    const restoreTls=(await restored.unsafe('SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()'))[0];if(restoreTls?.ssl!==true)throw new Error('Restore TLS required.');
    const restoredState=await restored.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY',tx=>catalog(tx,value=>writeFile(path.join(directory,'.private','catalog-restored.json'),JSON.stringify(value,null,2),{flag:'wx'})));
    const sourceAfter=await source.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY',tx=>catalog(tx,value=>writeFile(path.join(directory,'.private','catalog-source-after.json'),JSON.stringify(value,null,2),{flag:'wx'})));
    report={passed:baseline.digest===restoredState.digest&&baseline.digest===sourceAfter.digest,source:'authorized-loopback-disposable',restoreDatabase:name,sourcePreserved:baseline.digest===sourceAfter.digest,restorationExact:baseline.digest===restoredState.digest,sourceTls:tls,restoreTls,dumpSha256:createHash('sha256').update(await readFile(dump)).digest('hex'),dumpBytes:(await stat(dump)).size,baseline,restored:restoredState,crossClusterRolesRestored:false,protectedDatabaseConnected:false,providerWork:0};
    if(!report.passed)throw new Error('Restore or preservation fingerprint did not match.');
  } catch(error) {failure=error;} finally {
    report??={passed:false,source:'authorized-loopback-disposable',restoreDatabase:name,protectedDatabaseConnected:false,failure:'Dump, restore or verification failed; private diagnostics withheld.'};
    try {if(restored)await restored.end({timeout:5});}catch{failure??=new Error('Restore pool closure failed.');}
    try {
      if(created) {
        const sessions=await maintenance.unsafe('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=$1',[name]);
        if(sessions[0].count!==0)throw new Error('Owned restore target has active sessions; refusing forced termination or deletion.');
        await maintenance.unsafe(`DROP DATABASE ${quote(name)}`);
        report.ownedRestoreDatabaseRemoved=(await maintenance.unsafe('SELECT 1 FROM pg_database WHERE datname=$1',[name])).length===0;
      }
    }catch{failure??=new Error('Owned restore cleanup requires inspection.');report.ownedRestoreDatabaseRemoved=false;}
    try {await source.end({timeout:5});}catch{failure??=new Error('Source pool closure failed.');}
    try {await maintenance.end({timeout:5});}catch{failure??=new Error('Maintenance pool closure failed.');}
    if(failure)report.passed=false;
    await writeFile(path.join(directory,'restore-results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  }
  if(failure)throw failure;
  return report;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);if(args.length!==6&&args.length!==8)throw new Error('Use --config private.json --window issued-run-id --output new-directory [--wsl-distribution approved-name].');
    const options=new Map();for(let i=0;i<args.length;i+=2){if(!['--config','--window','--output','--wsl-distribution'].includes(args[i])||options.has(args[i])||!args[i+1])throw new Error('Invalid drill arguments.');options.set(args[i],args[i+1]);}
    const config=JSON.parse((await readFile(options.get('--config'),'utf8')).replace(/^\uFEFF/,''));
    const report=await runDrill({config,window:options.get('--window'),output:options.get('--output'),distribution:options.get('--wsl-distribution')});
    console.log(JSON.stringify({passed:report.passed,sourcePreserved:report.sourcePreserved,restorationExact:report.restorationExact,ownedRestoreDatabaseRemoved:report.ownedRestoreDatabaseRemoved,publicTables:report.baseline.publicTables,effectivePrivilegeChecks:report.baseline.effectivePrivilegeChecks}));
  }catch{console.error('Disposable restoration drill failed safely; private command and connection details were withheld.');process.exitCode=1;}
}
