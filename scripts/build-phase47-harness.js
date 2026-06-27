// scripts/build-phase47-harness.js — READ-ONLY. Faithful render harness for the
// Phase 4.7 Founder Focus card. Pulls REAL production data (leads, lead_intelligence,
// jarvis_outcomes, orders) via Firestore REST, embeds it into the REAL jarvis.html
// with Firebase stubbed, and calls the REAL renderFounderFocus(). Output:
// scripts/.phase47-harness.html (gitignored — contains lead PII). NO WRITES.
// This is NOT the authenticated live session — it is the production card code run
// over production data as a local file so the card can be screenshotted.
// Run: node scripts/build-phase47-harness.js
const os=require('os'),fs=require('fs'),path=require('path');
const BASE=`https://firestore.googleapis.com/v1/projects/najah-chemist/databases/(default)/documents`;
const TOKEN=path.join(os.homedir(),'.config','configstore','firebase-tools.json');
function tok(){return JSON.parse(fs.readFileSync(TOKEN,'utf8')).tokens.access_token;}
function fv(v){if(!v||typeof v!=='object')return v;if('nullValue'in v)return null;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;if('stringValue'in v)return v.stringValue;if('timestampValue'in v)return v.timestampValue;if('arrayValue'in v)return(v.arrayValue.values||[]).map(fv);if('mapValue'in v)return ff(v.mapValue.fields||{});return null;}
function ff(f){const o={};for(const[k,v]of Object.entries(f))o[k]=fv(v);return o;}
async function list(c){const d=[];let pt='';do{const r=await fetch(`${BASE}/${c}?pageSize=300${pt?`&pageToken=${encodeURIComponent(pt)}`:''}`,{headers:{Authorization:`Bearer ${tok()}`}});if(!r.ok)throw new Error(c+' '+r.status+' '+await r.text());const j=await r.json();for(const x of(j.documents||[]))d.push({id:x.name.split('/').pop(),data:ff(x.fields||{})});pt=j.nextPageToken||'';}while(pt);return d;}

(async()=>{
  const [leads,intel,outcomes,orders]=await Promise.all([
    list('leads'), list('lead_intelligence'), list('jarvis_outcomes'), list('orders')
  ]);
  // Lead docs: keep full fields (the inline Customer Record shows them) but collapse
  // emailConversation to a length-preserving stub so size + PII stay bounded.
  const LEADS=leads.map(l=>{ const d={...l.data, _docId:l.id};
    if(Array.isArray(d.emailConversation)) d.emailConversation=new Array(d.emailConversation.length).fill(0);
    return d; });
  const INTEL=intel.map(d=>({ ...d.data, leadId:d.id }));
  const OUTCOMES=outcomes.map(d=>({ ...d.data, id:d.id }));
  const ORDERS=orders.map(d=>({ ...d.data, dbId:d.id }));

  let html=fs.readFileSync(path.join(__dirname,'..','jarvis.html'),'utf8');
  html=html.replace(/import \{[^}]*\} from "https:\/\/www\.gstatic\.com\/firebasejs[^"]*";\s*/g,'');
  const stub=`const initializeApp=()=>({}),getFirestore=()=>({}),collection=()=>({}),getDocs=async()=>({docs:[],forEach(){}}),query=()=>({}),orderBy=()=>({}),addDoc=async()=>({id:'x'}),updateDoc=async()=>{},doc=()=>({}),getAuth=()=>({}),onAuthStateChanged=()=>{},getFunctions=()=>({}),httpsCallable=()=>(async()=>({data:{}}));\n`;
  html=html.replace('<script type="module">','<script>\n'+stub);

  const inject=`
/* ===== PHASE 4.7 HARNESS (not part of app) — real production data, auth bypassed ===== */
ORDERS = (${JSON.stringify(ORDERS)}).filter(o=>!isOwnerOrder(o));
LEADS  = (${JSON.stringify(LEADS)}).filter(l=>!isOwnerLead(l));
INTEL  = ${JSON.stringify(INTEL)};
OUTCOMES = ${JSON.stringify(OUTCOMES)};
INTEL.forEach(i=>{ INTEL_BY_ID[i.leadId]=i; });
LEADS.forEach(l=>{ LEAD_BY_ID[l._docId]=l; });
document.getElementById('loading').style.display='none';
document.getElementById('app').style.display='block';
try{ renderFounderFocus(); }catch(e){ document.getElementById('sec-founder-focus').innerHTML='<pre style="color:red">'+(e&&e.stack||e)+'</pre>'; }
`;
  const idx=html.lastIndexOf('</script>');
  html=html.slice(0,idx)+inject+html.slice(idx);

  const out=path.join(__dirname,'.phase47-harness.html');
  fs.writeFileSync(out,html);
  console.log('Harness written:',out,'(',Math.round(fs.statSync(out).size/1024),'KB )');
  console.log('Embedded:',INTEL.length,'intel ·',LEADS.length,'leads ·',OUTCOMES.length,'outcomes ·',ORDERS.length,'orders');
})().catch(e=>{console.error('HARNESS BUILD FAILED:',e.message);process.exit(1);});
