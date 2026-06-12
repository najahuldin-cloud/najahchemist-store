// scripts/build-phase4-harness.js — READ-ONLY. Builds a self-contained render harness
// from the REAL jarvis.html: stubs Firebase, embeds real lead_intelligence + lead names,
// and calls the real Phase 4 render functions. Output: scripts/.phase4-harness.html for a
// headless-Chrome screenshot. NO WRITES to Firestore / app. Run: node scripts/build-phase4-harness.js
const os=require('os'),fs=require('fs'),path=require('path');
const BASE=`https://firestore.googleapis.com/v1/projects/najah-chemist/databases/(default)/documents`;
const TOKEN=path.join(os.homedir(),'.config','configstore','firebase-tools.json');
function tok(){return JSON.parse(fs.readFileSync(TOKEN,'utf8')).tokens.access_token;}
function fv(v){if(!v||typeof v!=='object')return v;if('nullValue'in v)return null;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;if('stringValue'in v)return v.stringValue;if('timestampValue'in v)return v.timestampValue;if('arrayValue'in v)return(v.arrayValue.values||[]).map(fv);if('mapValue'in v)return ff(v.mapValue.fields||{});return null;}
function ff(f){const o={};for(const[k,v]of Object.entries(f))o[k]=fv(v);return o;}
async function list(c){const d=[];let pt='';do{const r=await fetch(`${BASE}/${c}?pageSize=300${pt?`&pageToken=${encodeURIComponent(pt)}`:''}`,{headers:{Authorization:`Bearer ${tok()}`}});if(!r.ok)throw new Error(c+' '+r.status);const j=await r.json();for(const x of(j.documents||[]))d.push({id:x.name.split('/').pop(),data:ff(x.fields||{})});pt=j.nextPageToken||'';}while(pt);return d;}

(async()=>{
  const [leads,intel]=await Promise.all([list('leads'),list('lead_intelligence')]);
  const NAME={};leads.forEach(l=>NAME[l.id]=(l.data.name||'').trim());
  // Trim intel to fields the Phase 4 renders actually read.
  const INTEL=intel.map(d=>{const i=d.data;return{leadId:d.id,score:i.score,scoreLabel:i.scoreLabel,closeProbability:i.closeProbability,recommendedOffer:i.recommendedOffer,expectedValue:i.expectedValue,potentialValue:{value:i.potentialValue&&i.potentialValue.value},isTest:i.isTest,isPrimaryRecord:i.isPrimaryRecord,suspiciousLead:i.suspiciousLead,duplicateCount:i.duplicateCount,opportunitySource:i.opportunitySource,preferredChannel:i.preferredChannel,intentSignals:(i.intentSignals||[]).slice(0,3),whyRecommended:(i.whyRecommended||[]).slice(0,3),lastMeaningfulActivity:i.lastMeaningfulActivity};});
  const LEADSMINI=leads.map(l=>({_docId:l.id,name:NAME[l.id],whatsapp:l.data.whatsapp||''}));

  let html=fs.readFileSync(path.join(__dirname,'..','jarvis.html'),'utf8');
  // 1) Replace the 4 firebase imports with stubs.
  html=html.replace(/import \{[^}]*\} from "https:\/\/www\.gstatic\.com\/firebasejs[^"]*";\s*/g,'');
  const stub=`const initializeApp=()=>({}),getFirestore=()=>({}),collection=()=>({}),getDocs=async()=>({docs:[],forEach(){}}),query=()=>({}),orderBy=()=>({}),addDoc=async()=>({id:'x'}),updateDoc=async()=>{},doc=()=>({}),getAuth=()=>({}),onAuthStateChanged=()=>{},getFunctions=()=>({}),httpsCallable=()=>(async()=>({data:{}}));\n`;
  html=html.replace('<script type="module">','<script>\n'+stub); // classic script so file:// runs it
  // 2) Append harness render call before the module closes (call ONLY Phase 4 renders).
  const inject=`
/* ===== HARNESS (not part of app) ===== */
INTEL = ${JSON.stringify(INTEL)};
${'LEADS'} = ${JSON.stringify(LEADSMINI)};
ORDERS = []; OPPS = []; CONTEXT = {};
LEADS.forEach(l=>{ LEAD_BY_ID[l._docId]=l; });
document.getElementById('loading').style.display='none';
document.getElementById('app').style.display='block';
renderFounderFocus();renderTodayMoney();renderTopActions();renderNext15();renderRevenueTarget();renderRevenueRisk();renderMoneyMissed();renderHonestPipeline();renderTopOpps();renderLeadCommand();renderRevenueByOffer();
`;
  // place before the final </script> of the module (last </script> in file is fine)
  const idx=html.lastIndexOf('</script>');
  html=html.slice(0,idx)+inject+html.slice(idx);

  const out=path.join(__dirname,'.phase4-harness.html');
  fs.writeFileSync(out,html);
  console.log('Harness written:',out,'(',Math.round(fs.statSync(out).size/1024),'KB )');
  console.log('Embedded:',INTEL.length,'intel docs ·',LEADSMINI.length,'lead names');
})().catch(e=>{console.error('HARNESS BUILD FAILED:',e.message);process.exit(1);});
