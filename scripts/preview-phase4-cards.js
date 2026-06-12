// scripts/preview-phase4-cards.js — READ-ONLY preview of the Phase 4 decision cards.
// Mirrors jarvis.html honestRanked()/actionForLead() exactly, against live data, so the
// mockup uses real values. NO WRITES. Run: node scripts/preview-phase4-cards.js
const os=require('os'),fs=require('fs'),path=require('path');
const BASE=`https://firestore.googleapis.com/v1/projects/najah-chemist/databases/(default)/documents`;
const TOKEN=path.join(os.homedir(),'.config','configstore','firebase-tools.json');
function tok(){return JSON.parse(fs.readFileSync(TOKEN,'utf8')).tokens.access_token;}
function fv(v){if(!v||typeof v!=='object')return v;if('nullValue'in v)return null;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;if('stringValue'in v)return v.stringValue;if('timestampValue'in v)return new Date(v.timestampValue);if('arrayValue'in v)return(v.arrayValue.values||[]).map(fv);if('mapValue'in v)return ff(v.mapValue.fields||{});return null;}
function ff(f){const o={};for(const[k,v]of Object.entries(f))o[k]=fv(v);return o;}
async function list(c){const d=[];let pt='';do{const r=await fetch(`${BASE}/${c}?pageSize=300${pt?`&pageToken=${encodeURIComponent(pt)}`:''}`,{headers:{Authorization:`Bearer ${tok()}`}});if(!r.ok)throw new Error(c+' '+r.status);const j=await r.json();for(const x of(j.documents||[]))d.push({id:x.name.split('/').pop(),data:ff(x.fields||{})});pt=j.nextPageToken||'';}while(pt);return d;}
const NOW=new Date(), fmt=n=>'J$'+Math.round(n||0).toLocaleString('en-US'), pct=p=>Math.round((Number(p)||0)*100)+'%';
const GOAL=300000, infl=ev=>(100*(ev||0)/GOAL).toFixed(1)+'%';
function causeFor(r){ if(r.src==='overdue')return 'No follow-up after contact'; if(r.src==='newlead'&&r.offer==='Manufacturing')return 'No quote sent'; if(r.replied)return 'No response after pricing'; if(r.src==='dormant'||r.src==='lost')return 'Gone quiet — needs reactivation'; return 'Stalled — needs outreach'; }
const ACTION_MIN={whatsapp:5,moqQuote:10,email:7,checkin:5};
const daysSince=iso=>{if(!iso)return null;const d=new Date(iso);return isNaN(d)?null:Math.max(0,Math.floor((NOW-d)/86400000));};
function actionFor(i,name){if(i.recommendedOffer==='Manufacturing'&&i.opportunitySource==='newlead')return{label:`Send MOQ quote to ${name}`,minutes:ACTION_MIN.moqQuote};if(i.preferredChannel==='whatsapp')return{label:`WhatsApp ${name}`,minutes:ACTION_MIN.whatsapp};return{label:`Email ${name}`,minutes:ACTION_MIN.email};}
function whyFor(i){const w=[];if(i.recommendedOffer==='Manufacturing')w.push('Manufacturing lead');if(i.opportunitySource==='hot')w.push('Hot / engaged');if(Array.isArray(i.intentSignals)&&i.intentSignals.length)w.push(String(i.intentSignals[0]));if(i.duplicateCount>1)w.push(`Appears ${i.duplicateCount}×`);return w.length?w:['Scored opportunity'];}

(async()=>{
  const [leads,intel]=await Promise.all([list('leads'),list('lead_intelligence')]);
  const NAME={};leads.forEach(l=>NAME[l.id]=(l.data.name||'').trim());
  const nm=id=>NAME[id]||('Lead '+id.slice(0,6));
  const honest=intel.map(d=>d.data).filter(i=>i.isTest!==true&&i.isPrimaryRecord!==false&&i.suspiciousLead!==true);
  const ranked=honest.map(i=>{const name=nm(i.leadId||'');const a=actionFor(i,name);const ev=Number(i.expectedValue)||0;return{name,ev,conf:Number(i.closeProbability)||0,minutes:a.minutes,action:a.label,roi:a.minutes>0?ev/a.minutes:ev,label:i.scoreLabel,offer:i.recommendedOffer,src:i.opportunitySource,replied:(Array.isArray(i.intentSignals)&&i.intentSignals.some(s=>/repl/i.test(String(s)))),why:(Array.isArray(i.whyRecommended)&&i.whyRecommended.length)?i.whyRecommended:whyFor(i),ageDays:daysSince(i.lastMeaningfulActivity)};});
  const byEV=ranked.slice().sort((a,b)=>b.ev-a.ev), byROI=ranked.slice().sort((a,b)=>b.roi-a.roi);

  const ff=byROI[0];
  console.log('\n=== 🔥 FOUNDER FOCUS ===');
  console.log(`  ${ff.action} — EV ${fmt(ff.ev)} · ${pct(ff.conf)} · ${ff.minutes}min · influence ${infl(ff.ev)} of goal`);
  console.log(`  Reason: Highest revenue-per-minute opportunity — ${ff.why[0]}`);
  const rt3=byROI.slice(0,3), todayRev=0, forecast=todayRev+rt3.reduce((s,r)=>s+r.ev,0), gap=Math.max(0,GOAL-forecast);
  console.log('\n=== 🎯 REVENUE TARGET ===');
  console.log(`  Goal ${fmt(GOAL)} · Forecast ${fmt(forecast)} · Gap ${fmt(gap)} · Progress ${(100*forecast/GOAL).toFixed(1)}% · Conf ${pct(rt3.reduce((s,r)=>s+r.conf,0)/rt3.length)}`);

  console.log('\n=== 💰 TODAY\'S MONEY (real values) ===');
  const bl=byEV[0], f=byROI[0];
  console.log(`Best Lead        : ${bl.name} — ${fmt(bl.ev)} · ${pct(bl.conf)} · ${bl.minutes}min · ${bl.offer}`);
  console.log(`Fastest Revenue  : ${f.name} — ${fmt(f.ev)} · ${pct(f.conf)} · ${f.minutes}min`);
  console.log(`Recommended Next : ${byROI[0].action} — ${fmt(byROI[0].ev)} · ${pct(byROI[0].conf)} · ${byROI[0].minutes}min`);

  console.log('\n=== ⚡ TODAY\'S TOP ACTIONS (top 8 by EV÷time) ===');
  byROI.slice(0,8).forEach((r,i)=>console.log(`  ${i+1}. ${r.action.padEnd(34)} ${fmt(r.ev).padStart(10)} · ${pct(r.conf)} · ${r.minutes}m  [${r.why.slice(0,2).join(' · ')}]`));

  console.log('\n=== ⏱ NEXT 15 MINUTES (top 3) ===');
  const t3=byROI.slice(0,3);
  t3.forEach((r,i)=>console.log(`  ${i+1}. ${r.action}`));
  console.log(`  Expected revenue influence: ${fmt(t3.reduce((s,r)=>s+r.ev,0))} · Confidence ${pct(t3.reduce((s,r)=>s+r.conf,0)/t3.length)} · ~${t3.reduce((s,r)=>s+r.minutes,0)} min`);

  console.log('\n=== ⚠ REVENUE AT RISK (aging >14d) ===');
  const ah=ranked.filter(r=>(r.label==='Hot'||r.label==='Ready')&&r.ageDays!=null&&r.ageDays>14);
  const aa=ranked.filter(r=>r.ageDays!=null&&r.ageDays>14);
  console.log(`  Estimated revenue at risk: ${fmt(ah.reduce((s,r)=>s+r.ev,0))}`);
  console.log(`  ${ah.length} hot/ready inactive >14d · ${aa.length} aging opportunities total`);
  const worst=ah.slice().sort((a,b)=>b.ev-a.ev)[0];
  if(worst) console.log(`  Worst Offender: ${worst.name} — ${fmt(worst.ev)} · ${worst.ageDays} days inactive`);

  console.log('\n=== 💸 MONEY MISSED THIS WEEK ===');
  const tally={}; aa.forEach(r=>{const c=causeFor(r);tally[c]=(tally[c]||0)+1;});
  const causes=Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,3);
  console.log(`  ${fmt(ah.reduce((s,r)=>s+r.ev,0))} at risk · ${aa.length} aging opportunities`);
  console.log('  Top 3 causes: '+causes.map(([c,n])=>`${c} (${n})`).join(' · '));

  console.log('\n=== 🎯 TOP OPPORTUNITIES (top 5 by EV, with WHY) ===');
  byEV.slice(0,5).forEach((r,i)=>console.log(`  ${i+1}. ${r.name.padEnd(18)} ${fmt(r.ev).padStart(10)} ${r.label} · WHY: ${r.why.slice(0,3).join(' · ')}`));

  console.log('\n=== CEO SIM EXTRAS ===');
  console.log(`  1st to contact: ${byROI[0].name} (${fmt(byROI[0].ev)})`);
  console.log(`  2nd to contact: ${byROI[1].name} (${fmt(byROI[1].ev)})`);
  let cum=0, n=0; const path=[];
  for(const r of byROI){ cum+=r.ev; n++; path.push(r.name); if(cum>=GOAL) break; }
  console.log(`  Fastest path to ${fmt(GOAL)}: ${n} actions (${path.join(', ')}) = ${fmt(cum)} expected influence, ~${byROI.slice(0,n).reduce((s,r)=>s+r.minutes,0)} min`);
  const ignore=ranked.slice().sort((a,b)=>a.ev-b.ev).filter(r=>r.label==='Cold')[0]||ranked.slice().sort((a,b)=>a.ev-b.ev)[0];
  console.log(`  Lowest-priority (ignore today): ${ignore.name} — ${fmt(ignore.ev)} · ${ignore.label}${ignore.ageDays!=null?` · ${ignore.ageDays}d`:''}`);
  console.log(`  (Cold real leads de-prioritised: ${ranked.filter(r=>r.label==='Cold').length}; test leads already excluded)`);

  // ── RANKING FORMULA COMPARISON: A = EV÷Time   vs   B = (EV×Confidence)÷Time ──
  const A=ranked.map(r=>({name:r.name,ev:r.ev,conf:r.conf,m:r.minutes,score:r.minutes>0?r.ev/r.minutes:r.ev}));
  const B=ranked.map(r=>({name:r.name,ev:r.ev,conf:r.conf,m:r.minutes,score:r.minutes>0?(r.ev*r.conf)/r.minutes:r.ev*r.conf}));
  const topA=A.slice().sort((a,b)=>b.score-a.score).slice(0,10).map(r=>r.name);
  const topB=B.slice().sort((a,b)=>b.score-a.score).slice(0,10).map(r=>r.name);
  const overlap=topA.filter(n=>topB.includes(n)).length;
  console.log('\n=== RANKING FORMULA COMPARISON (top 10) ===');
  console.log('  rank  A: EV÷Time              B: (EV×Conf)÷Time');
  for(let i=0;i<10;i++) console.log(`  ${String(i+1).padStart(2)}    ${(topA[i]||'').padEnd(22)} ${topB[i]||''}`);
  console.log(`  Top-10 overlap: ${overlap}/10`);
  // EV captured by each top-10 (decision quality proxy: more expected revenue surfaced = better)
  const evA=A.slice().sort((a,b)=>b.score-a.score).slice(0,10).reduce((s,r)=>s+r.ev,0);
  const evB=B.slice().sort((a,b)=>b.score-a.score).slice(0,10).reduce((s,r)=>s+r.ev,0);
  console.log(`  Expected revenue in top-10 → A: ${fmt(evA)}  |  B: ${fmt(evB)}  (A surfaces ${fmt(evA-evB)} more)`);
  console.log(`  Note: EV already = potential×closeProb, so B = potential×closeProb²÷time (probability applied twice).`);

  console.log(`\n(honest leads: ${honest.length} · total honest expected: ${fmt(ranked.reduce((s,r)=>s+r.ev,0))})`);
})().catch(e=>{console.error('PREVIEW FAILED:',e.message);process.exit(1);});
