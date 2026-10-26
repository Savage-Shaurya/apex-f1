const advisoryUrl='https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const reviewedPath='apps__web>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces';

/** A narrow, expiring development-only mitigation; registry results stay intact. */
export function evaluateDependencyAudits(full,production,{now,patchVerified,regressionPassed}) {
  const rejected=[],mitigated=[];
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
  const buckets=['info','low','moderate','high','critical'];
  const shaped=report=>record(report)&&record(report.advisories)&&record(report.metadata)&&record(report.metadata.vulnerabilities)&&
    (!Object.hasOwn(report,'muted')||(Array.isArray(report.muted)&&report.muted.length===0));
  if (!shaped(full)||!shaped(production)) {
    return {ready:false,rejected:['Registry audit response was incomplete.'],mitigated:[]};
  }
  const countsValid=report=>{
    const counts=report.metadata.vulnerabilities;
    if(Object.keys(counts).length!==buckets.length||!buckets.every(key=>Number.isInteger(counts[key])&&counts[key]>=0))return false;
    const expected=Object.fromEntries(buckets.map(key=>[key,0]));
    for(const advisory of Object.values(report.advisories)){
      if(!record(advisory)||!buckets.includes(advisory.severity))return false;
      expected[advisory.severity]++;
    }
    return buckets.every(key=>counts[key]===expected[key]);
  };
  if(!countsValid(full)||!countsValid(production))return {ready:false,rejected:['Registry advisory counts were incomplete or inconsistent.'],mitigated:[]};
  if((Array.isArray(full.muted)&&full.muted.length)||(Array.isArray(production.muted)&&production.muted.length))rejected.push('Registry findings were suppressed outside the reviewed mitigation.');
  if (Object.keys(production.advisories).length || Object.values(production.metadata.vulnerabilities).some(value=>typeof value!=='number'||value!==0)) rejected.push('Production dependencies have an advisory or invalid audit counts.');
  const expiresAt='2026-10-18T00:00:00.000Z';
  for (const advisory of Object.values(full.advisories)) {
    const findings=advisory.findings;
    const eligible=advisory.module_name==='braces' && advisory.url===advisoryUrl && advisory.severity==='high' &&
      Array.isArray(findings) && findings.length>0 && findings.every(item=>record(item)&&item.version==='3.0.3' && Array.isArray(item.paths) && item.paths.length>0 && item.paths.every(value=>value===reviewedPath)) &&
      patchVerified===true && regressionPassed===true && Number.isFinite(Date.parse(now)) && Date.parse(now)<Date.parse(expiresAt);
    if (!eligible) rejected.push(`Unmitigated dependency advisory: ${String(advisory.module_name).slice(0,100)}.`);
    else mitigated.push({module:'braces',version:'3.0.3',advisory:advisoryUrl,scope:'development lint dependency only',expiresAt,
      mitigation:'Checked-in parser nesting limit verified against the installed dependency chain.',
      residual:'No upstream patched release. Manually constructed ASTs bypass this string-parser limit.'});
  }
  return {ready:rejected.length===0,rejected,mitigated};
}
