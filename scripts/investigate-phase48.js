// scripts/investigate-phase48.js — READ-ONLY. Phase 4.8 pre-build investigation.
// Quantifies the Expected-Value clustering (Item 17), confirms the valuation is
// rule/offer-level (not a per-lead calc), tests whether closeProbability can be
// faithfully reconstructed in the browser (Item 10 confidence breakdown), and
// reports field availability for the new sections. NO WRITES.
const os=require('os'),fs=require('fs'),path=require('path');
const BASE=`https://firestore.googleapis.com/v1/projects/najah-chemist/databases/(default)/documents`;
const TOKEN=path.join(os.homedir(),'.config','configstore','firebase-tools.json');
function tok(){return JSON.parse(fs.readFileSync(TOKEN,'utf8')).tokens.access_token;}
function fv(v){if(!v||typeof v!=='object')return v;if('nullValue'in v)return null;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;if('stringValue'in v)return v.stringValue;if('timestampValue'in v)return v.timestampValue;if('arrayValue'in v)return(v.arrayValue.values||[]).map(fv);if('mapValue'in v)return ff(v.mapValue.fields||{});return null;}
function ff(f){const o={};for(const[k,v]of Object.entries(f))o[k]=fv(v);return o;}
async function list(c){const d=[];let pt='';do{const r=await fetch(`${BASE}/${c}?pageSize=300${pt?`&pageToken=${encodeURIComponent(pt)}`:''}`,{headers:{Authorization:`Bearer ${tok()}`}});if(!r.ok)throw new Error(c+' '+r.status);const j=await r.json();for(const x of(j.documents||[]))d.push({id:x.name.split('/').pop(),data:ff(x.fields||{})});pt=j.nextPageToken||'';}while(pt);return d;}

// ── reconstruct closeProbability exactly as functions/agents/lead-agent/score.js ──
const CLOSE_PROB={reorder:0.80,hot:0.45,overdue:0.35,newlead:0.25,dormant:0.10,lost:0.02};
function decayPoints(d){ if(d==null)return 0; if(d>=90)return 30; if(d>=60)return 20; if(d>=30)return 10; return 0; }
function daysSince(iso,now){ if(!iso)return null; const d=new Date(iso); if(isNaN(d))return null; return Math.floor((now-d.getTime())/86400000); }
function reconCP(lead,intel,now){
  const base=CLOSE_PROB[intel.opportunitySource]!=null?CLOSE_PROB[intel.opportunitySource]:CLOSE_PROB.newlead;
  let p=base; const j=(lead.journey||'').toLowerCase();
  if(j.includes('ready'))p+=0.15; else if(j.includes('exploring'))p-=0.10;
  if((lead.budget||'').includes('1,000'))p+=0.05;
  const decay=decayPoints(daysSince(intel.lastMeaningfulActivity,now));
  p-=decay/200;
  return Math.max(0.01,Math.min(0.95,Math.round(p*100)/100));
}

(async()=>{
  const now=Date.now();
  const [intel,leads,orders,outcomes]=await Promise.all([list('lead_intelligence'),list('leads'),list('orders'),list('jarvis_outcomes')]);
  const LB={}; leads.forEach(l=>LB[l.id]=l.data);
  const honest=intel.map(d=>({leadId:d.id,...d.data}))
    .filter(i=>i.isTest!==true && i.isPrimaryRecord!==false && i.suspiciousLead!==true);
  console.log(`\nHonest intel docs: ${honest.length} (of ${intel.length} total) · leads ${leads.length} · orders ${orders.length} · outcomes ${outcomes.length}`);

  // ── Item 17: Expected Value distribution ──
  const evCount={}, pvSrc={}, pvConf={}, cpCount={};
  honest.forEach(i=>{ const ev=Math.round(Number(i.expectedValue)||0); evCount[ev]=(evCount[ev]||0)+1;
    const pv=i.potentialValue||{}; pvSrc[pv.source||'?']=(pvSrc[pv.source||'?']||0)+1; pvConf[pv.confidence==null?'?':pv.confidence]=(pvConf[pv.confidence==null?'?':pv.confidence]||0)+1;
    const cp=Number(i.closeProbability)||0; cpCount[cp]=(cpCount[cp]||0)+1; });
  const evSorted=Object.entries(evCount).sort((a,b)=>b[1]-a[1]);
  console.log(`\n── ITEM 17: Expected Value ── distinct EVs: ${evSorted.length}`);
  console.log('Top repeated EVs (value × count):');
  evSorted.slice(0,12).forEach(([v,c])=>console.log(`  J$${Number(v).toLocaleString()} × ${c}`));
  console.log('potentialValue.source:', JSON.stringify(pvSrc));
  console.log('potentialValue.confidence:', JSON.stringify(pvConf));
  console.log('distinct closeProbability values:', JSON.stringify(Object.fromEntries(Object.entries(cpCount).sort((a,b)=>b[0]-a[0]))));

  // ── Item 10: can we faithfully reconstruct closeProbability in the browser? ──
  let match=0, mism=0; const ex=[];
  honest.forEach(i=>{ const l=LB[i.leadId]||{}; const r=reconCP(l,i,now); const stored=Math.round((Number(i.closeProbability)||0)*100)/100;
    if(r===stored) match++; else { mism++; if(ex.length<6) ex.push({lead:i.leadId.slice(0,6),stored,recon:r,src:i.opportunitySource,age:daysSince(i.lastMeaningfulActivity,now)}); } });
  console.log(`\n── ITEM 10: closeProbability reconstruction ── match ${match}/${match+mism} (${Math.round(100*match/(match+mism))}%)`);
  if(ex.length) console.log('  sample mismatches (expected — decay drift since last rescore):', JSON.stringify(ex));

  // ── Field availability for the new sections ──
  const ordByEmail={}; orders.forEach(o=>{ const e=((o.data.email||o.data.customerEmail||'')+'').trim().toLowerCase(); if(e){(ordByEmail[e]=ordByEmail[e]||[]).push(o.data);} });
  const pct=n=>`${n} (${Math.round(100*n/honest.length)}%)`;
  let hasJourney=0,hasBudget=0,hasReply=0,hasUserTurn=0,hasOrders=0,hasObj=0,hasIntent=0,hasProducts=0,hasLTV=0;
  honest.forEach(i=>{ const l=LB[i.leadId]||{};
    if(l.journey) hasJourney++; if(l.budget) hasBudget++; if(l.lastReplyAt) hasReply++;
    if(Array.isArray(l.emailConversation)&&l.emailConversation.some(t=>t&&t.role==='user')) hasUserTurn++;
    const e=(l.email||'').trim().toLowerCase(); if(e&&ordByEmail[e]) hasOrders++;
    if(Array.isArray(i.objections)&&i.objections.length) hasObj++;
    if(Array.isArray(i.intentSignals)&&i.intentSignals.length) hasIntent++;
    if(Array.isArray(i.productsInterestedIn)&&i.productsInterestedIn.length) hasProducts++;
    if(i.predictedLifetimeValue&&i.predictedLifetimeValue.value) hasLTV++; });
  console.log('\n── FIELD AVAILABILITY (honest leads) ──');
  console.log('journey:',pct(hasJourney),'| budget:',pct(hasBudget),'| lastReplyAt:',pct(hasReply),'| user reply turn:',pct(hasUserTurn));
  console.log('matched orders (LTV view):',pct(hasOrders),'| objections:',pct(hasObj),'| intentSignals:',pct(hasIntent),'| productsInterestedIn:',pct(hasProducts),'| pLTV:',pct(hasLTV));

  // outcomes resolved (close-date learning sufficiency, Item 9)
  const resolved=outcomes.filter(o=>{const s=o.data.status;return s==='converted'||s==='lost';});
  console.log('\n── ITEM 9: resolved outcomes (close-date history):', resolved.length, '→', resolved.length>=10?'maybe enough':'INSUFFICIENT — state so');

  // sample one honest lead's full intel keys (so we know exactly what is loadable)
  const sample=honest.sort((a,b)=>(Number(b.expectedValue)||0)-(Number(a.expectedValue)||0))[0];
  console.log('\n── sample top-EV honest intel keys ──\n', Object.keys(sample).sort().join(', '));
})().catch(e=>{console.error('INVESTIGATION FAILED:',e.message);process.exit(1);});
