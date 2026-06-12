// scripts/reconcile-honest-pipeline.js — READ-ONLY. Proves the Phase 4 UI's
// pipelineStats() math (run over stored lead_intelligence) reconciles to the
// v4-final-audit.js numbers. Mirrors jarvis.html leadFilters/pipelineStats exactly.
// Run: node scripts/reconcile-honest-pipeline.js

const os = require('os'), fs = require('fs'), path = require('path');
const PROJECT_ID = 'najah-chemist';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
function getToken(){ return JSON.parse(fs.readFileSync(TOKEN_PATH,'utf8')).tokens.access_token; }
function fromValue(v){
  if(!v||typeof v!=='object') return v;
  if('nullValue'in v) return null;
  if('booleanValue'in v) return v.booleanValue;
  if('integerValue'in v) return Number(v.integerValue);
  if('doubleValue'in v) return v.doubleValue;
  if('stringValue'in v) return v.stringValue;
  if('timestampValue'in v) return new Date(v.timestampValue);
  if('arrayValue'in v) return (v.arrayValue.values||[]).map(fromValue);
  if('mapValue'in v) return fromFields(v.mapValue.fields||{});
  return null;
}
function fromFields(f){ const o={}; for(const[k,val]of Object.entries(f)) o[k]=fromValue(val); return o; }
async function list(token,c){
  const docs=[]; let pt='';
  do{
    const url=`${BASE}/${c}?pageSize=300${pt?`&pageToken=${encodeURIComponent(pt)}`:''}`;
    const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
    if(!res.ok) throw new Error(`${c} ${res.status}`);
    const d=await res.json();
    for(const x of (d.documents||[])) docs.push(fromFields(x.fields||{}));
    pt=d.nextPageToken||'';
  }while(pt);
  return docs;
}
// ── EXACT mirror of jarvis.html leadFilters + pipelineStats ──
const isReal=i=>!!i&&i.isTest!==true, isPrimary=i=>!!i&&i.isPrimaryRecord!==false, notSusp=i=>!!i&&i.suspiciousLead!==true;
const exp=l=>l.reduce((s,i)=>s+(Number(i.expectedValue)||0),0);
const pot=l=>l.reduce((s,i)=>s+((i.potentialValue&&Number(i.potentialValue.value))||0),0);

(async()=>{
  const INTEL = await list(getToken(),'lead_intelligence');
  const honest = INTEL.filter(i=>isReal(i)&&isPrimary(i)&&notSusp(i));
  const rawExp=exp(INTEL), honestExp=exp(honest), rawPot=pot(INTEL), honestPot=pot(honest);
  const dupExtras=INTEL.filter(i=>i.isPrimaryRecord===false);
  const dupExtraExp=exp(dupExtras);
  const st={ count:INTEL.length, rawExp, honestExp, rawPot, honestPot,
    testCount:INTEL.filter(i=>i.isTest===true).length, dupExtraCount:dupExtras.length,
    suspCount:INTEL.filter(i=>i.suspiciousLead===true).length,
    inflationPct:rawExp>0?(rawExp-honestExp)/rawExp:0, dupInflationPct:rawExp>0?dupExtraExp/rawExp:0 };

  // Audit baseline (v4-final-audit.js, 2026-06-12 full backfill)
  const A={ rawExp:13968893, honestExp:10143353, dupInflationPct:0.268, testCount:33, dupExtraCount:130 };
  const J=n=>'J$'+Math.round(n).toLocaleString('en-US');
  const ok=(a,b,tol)=>Math.abs(a-b)<=(tol||0)?'✅':'❌ MISMATCH';
  console.log('════ HONEST PIPELINE RECONCILIATION (stored intel vs audit) ════');
  console.log(`  intel docs           : ${st.count}`);
  console.log(`  Raw expected         : ${J(st.rawExp)}   vs audit ${J(A.rawExp)}   ${ok(st.rawExp,A.rawExp,1)}`);
  console.log(`  Honest expected      : ${J(st.honestExp)}   vs audit ${J(A.honestExp)}   ${ok(st.honestExp,A.honestExp,1)}`);
  console.log(`  Honest % of raw      : ${(100*st.honestExp/st.rawExp).toFixed(1)}%`);
  console.log(`  Duplicate inflation  : ${(100*st.dupInflationPct).toFixed(1)}%   vs audit ${(100*A.dupInflationPct).toFixed(1)}%   ${ok(st.dupInflationPct,A.dupInflationPct,0.001)}`);
  console.log(`  Total inflation (banner): ${(100*st.inflationPct).toFixed(1)}%  (>10% → banner shows)`);
  console.log(`  Test leads           : ${st.testCount}   vs audit ${A.testCount}   ${ok(st.testCount,A.testCount)}`);
  console.log(`  Duplicate-extra recs : ${st.dupExtraCount}   vs audit ${A.dupExtraCount}   ${ok(st.dupExtraCount,A.dupExtraCount)}`);
  const allOk = st.rawExp===A.rawExp && st.honestExp===A.honestExp && st.testCount===A.testCount && st.dupExtraCount===A.dupExtraCount;
  console.log(`\n  ${allOk?'✅ RECONCILED — UI math equals the Phase 3 audit.':'❌ DOES NOT RECONCILE — investigate.'}`);
})().catch(e=>{ console.error('RECONCILE FAILED:',e.message); process.exit(1); });
