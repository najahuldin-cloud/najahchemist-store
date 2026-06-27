// scripts/test-phase47-founder-focus.js — READ-ONLY logic harness for Phase 4.7.
// Stubs the DOM + Firebase, evaluates the REAL jarvis.html module body in a vm
// sandbox, then drives renderFounderFocus + the new recommendation/learning
// helpers with synthetic data across several scenarios. No network, no writes.
// Run: node scripts/test-phase47-founder-focus.js
const fs = require('fs'), path = require('path'), vm = require('vm');

const file = fs.readFileSync(path.join(__dirname, '..', 'jarvis.html'), 'utf8');
let body = file.slice(file.indexOf('<script type="module">') + '<script type="module">'.length,
                       file.lastIndexOf('</script>'));
// Strip the ES module imports (we inject stubs for those names instead).
body = body.replace(/import \{[^}]*\} from "https:\/\/www\.gstatic\.com\/firebasejs[^"]*";\s*/g, '');
// Append a test hook that CLOSES OVER the module's real lexical bindings (vm does
// not expose top-level const/let as context properties, so we reach them here).
body += `
;globalThis.__h = {
  set(o){ INTEL=o.intel; LEADS=o.leads; ORDERS=o.orders||[]; OUTCOMES=o.outcomes||[];
    for(const k in INTEL_BY_ID) delete INTEL_BY_ID[k]; INTEL.forEach(i=>INTEL_BY_ID[i.leadId]=i);
    for(const k in LEAD_BY_ID) delete LEAD_BY_ID[k]; LEADS.forEach(l=>LEAD_BY_ID[l._docId]=l); },
  ff(){ renderFounderFocus(); },
  html(){ return document.getElementById('sec-founder-focus').innerHTML; },
  now(){ return NOW; },
  outcomes(){ return OUTCOMES; },
  setModal(fn){ ocModal = fn; },
  setUser(u){ try{ auth.currentUser = u; }catch(e){} },
  noop(){ for(const n of arguments){ try{ eval(n+'=function(){};'); }catch(e){} } },
  jFFWon, jFFLost
};`;

// ── DOM stub ───────────────────────────────────────────────────────────────
const els = {};
function mkEl(id){
  return { id, _html:'', textContent:'', value:'', style:{}, classList:{add(){},remove(){}},
           set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; },
           addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
           appendChild(){}, remove(){}, scrollIntoView(){}, focus(){} };
}
const document = {
  getElementById(id){ return els[id] || (els[id] = mkEl(id)); },
  querySelectorAll(){ return []; }, querySelector(){ return null; },
  createElement(){ return mkEl('x'); }, body:{ appendChild(){} },
  addEventListener(){}
};
const localStore = {};
const sandbox = {
  console, document, window:{}, location:{ replace(){} },
  localStorage:{ getItem:k=>localStore[k]||null, setItem:(k,v)=>{localStore[k]=String(v);}, removeItem:k=>{delete localStore[k];} },
  setInterval(){}, clearInterval(){}, setTimeout(f){ /* don't run timers */ },
  fetch: async ()=>({ ok:false, json:async()=>({}) }),
  // Firebase stubs
  initializeApp:()=>({}), getFirestore:()=>({}), collection:()=>({}),
  getDocs:async()=>({ docs:[], forEach(){} }), query:()=>({}), orderBy:()=>({}),
  addDoc:async()=>({ id:'OUT'+Math.random().toString(36).slice(2,8) }), updateDoc:async()=>{},
  doc:()=>({}), getAuth:()=>({ currentUser:null }), onAuthStateChanged:()=>{},
  getFunctions:()=>({}), httpsCallable:()=>(async()=>({data:{}}))
};
sandbox.window = sandbox;       // window.* assignments land back on the sandbox
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(body, sandbox, { filename:'jarvis-module.js' });

// ── Helpers to drive the sandbox ────────────────────────────────────────────
const S = sandbox;
const H = sandbox.__h;
const NOW = H.now();
function setData(o){ H.set({ intel:o.intel, leads:o.leads, orders:o.orders||[], outcomes:o.outcomes||[] }); }
function html(){ return H.html(); }
let pass=0, fail=0;
function assert(name, cond, extra){ if(cond){ pass++; console.log('  ✓ '+name); } else { fail++; console.log('  ✗ '+name + (extra?(' — '+extra):'')); } }

const ISO = d => d.toISOString();
const daysAgoISO = n => ISO(new Date(NOW.getTime() - n*86400000));

// ── Scenario 1: Manufacturing new lead, never actioned (presented state) ──────
console.log('\nScenario 1 — Manufacturing new lead (presented, no history)');
setData({
  intel:[{ leadId:'lead001abc', score:78, scoreLabel:'Hot', closeProbability:0.45,
    recommendedOffer:'Manufacturing', expectedValue:93600, potentialValue:{value:208000},
    isTest:false, isPrimaryRecord:true, suspiciousLead:false, duplicateCount:1,
    opportunitySource:'newlead', preferredChannel:'whatsapp',
    intentSignals:['requested pricing'], whyRecommended:['Manufacturing lead','High budget'],
    lastMeaningfulActivity: daysAgoISO(14) }],
  leads:[{ _docId:'lead001abc', name:'John Brown', whatsapp:'18761234567',
    email:'john@brownco.com', brandType:'Skincare brand', source:'Instagram',
    createdAt: daysAgoISO(20) }]
});
H.ff();
let h = html();
assert('renders the lead name', h.includes('John Brown'));
assert('shows a Recommendation ID (REC-LEAD00-…-MQ)', /REC-LEAD00-\d{8}-MQ/.test(h), h.match(/REC-[^<]*/)?.[0]);
assert('shows Lead ID', h.includes('lead001abc'));
assert('shows source Instagram', h.includes('Instagram'));
assert('shows interested product Manufacturing', h.includes('Manufacturing'));
assert('shows potential J$208,000', h.includes('J$208,000'));
assert('shows expected value J$93,600', h.includes('J$93,600'));
assert('status = Presented — not yet actioned', h.includes('Presented'));
assert('days since contact 14d', h.includes('14d'));
assert('communication timeline present', h.includes('COMMUNICATION TIMELINE') && h.includes('Lead created'));
assert('automation = none yet', h.includes('No automation performed yet'));
assert('AI recommendation panel present', h.includes('AI RECOMMENDATION'));
assert('no-history learning copy (explicitly none)', h.includes('No historical evidence yet') && h.includes('explicitly none'));
assert('one-click WhatsApp action', h.includes('Open WhatsApp') && h.includes('jActIntel'));
assert('Mark Won / Mark Lost wired to lead', h.includes("jFFWon('lead001abc')") && h.includes("jFFLost('lead001abc')"));
assert('Snooze action present', h.includes("jFFSnooze('lead001abc')"));
// Phase 4.7 validation additions
assert('Executive Briefing present', h.includes('EXECUTIVE BRIEFING'));
assert('briefing has all 4 sections', h.includes('SITUATION') && h.includes('ASSESSMENT') && h.includes('RISKS') && h.includes('RECOMMENDATION'));
assert('risks: clear to act (14d not >14, none)', h.includes('No risks detected'));
assert('explicit "After you act, Jarvis"', h.includes('After you act, Jarvis'));
assert('Customer Record expands inline (details)', h.includes('CUSTOMER RECORD') && h.includes('lead · email'));
assert('NO /admin.html redirect anywhere', !h.includes('/admin.html'));
assert('automation = none yet (no emails)', h.includes('No automation performed yet'));
// ── Phase 4.8 ──
assert('4.8 temperature badge (Hot)', h.includes('🔥 Hot'));
assert('4.8 opportunity health shown', h.includes('Health: Healthy'));
assert('4.8 EV labelled rule-based estimate', h.includes('rule-based offer-level estimates'));
assert('4.8 confidence breakdown drawer', h.includes('Confidence breakdown') && h.includes('Opportunity type (newlead)'));
assert('4.8 confidence inline factors', /Confidence <b>\d+%<\/b> —/.test(h));
assert('4.8 recommended message editable', h.includes('RECOMMENDED MESSAGE') && h.includes('id="ff-msg-wa"') && h.includes("jFFSendWA('lead001abc')"));
assert('4.8 intent stars', h.includes('Intent:') && h.includes('★'));
assert('4.8 business memory drawer', h.includes('Business memory'));
assert('4.8 why-this-recommendation drawer', h.includes('Why this recommendation (full reasoning)'));
assert('4.8 lifetime view (first-time prospect)', h.includes('First-time prospect'));
assert('4.8 relationship = new prospect', h.includes('new prospect'));
assert('4.8 jarvis executive take', h.includes('JARVIS’S TAKE'));

// ── Scenario 2: pending outcome + timeline (orders, emails) + awaiting state ──
console.log('\nScenario 2 — Hot lead, actioned & awaiting, with order history + learning data');
setData({
  intel:[{ leadId:'lead777xyz', score:70, scoreLabel:'Hot', closeProbability:0.5,
    recommendedOffer:'Skincare', expectedValue:60000, potentialValue:{value:120000},
    isTest:false, isPrimaryRecord:true, suspiciousLead:false, duplicateCount:1,
    opportunitySource:'hot', preferredChannel:'whatsapp',
    intentSignals:['replied'], whyRecommended:['Hot / engaged'],
    lastMeaningfulActivity: daysAgoISO(2) }],
  leads:[{ _docId:'lead777xyz', name:'Mary Lee', whatsapp:'18769998888',
    email:'mary@lee.com', brandType:'Skincare brand', emailCount:2, followUpSent:true,
    lastReplyAt: daysAgoISO(3) }],
  orders:[{ dbId:'o1', email:'mary@lee.com', total:'30000', paymentStatus:'Paid',
    createdAt:{ seconds: Math.floor((NOW.getTime()-5*86400000)/1000) }, id:'5001',
    items:['Turmeric Soap'] }],
  outcomes:[
    // a pending outcome for THIS lead (actioned 1 day ago, via the dashboard = manual)
    { id:'oc-cur', leadId:'lead777xyz', status:'pending', executionStatus:'actioned',
      recommendationType:'hot-followup', recommendedChannel:'whatsapp', source:'jarvis-dashboard',
      expectedRevenue:60000, actionedAt: daysAgoISO(1), recommendedAt: daysAgoISO(1).slice(0,10) },
    // historical resolved hot-followup outcomes → learning rate
    { id:'h1', leadId:'x1', status:'converted', recommendationType:'hot-followup',
      actualRevenue:50000, actionedAt: daysAgoISO(20), resolvedAt: daysAgoISO(12).slice(0,10) },
    { id:'h2', leadId:'x2', status:'converted', recommendationType:'hot-followup',
      actualRevenue:70000, actionedAt: daysAgoISO(30), resolvedAt: daysAgoISO(20).slice(0,10) },
    { id:'h3', leadId:'x3', status:'lost', recommendationType:'hot-followup',
      actualRevenue:0, actionedAt: daysAgoISO(30), resolvedAt: daysAgoISO(25).slice(0,10) }
  ]
});
H.ff();
h = html();
assert('renders Mary Lee (top by ROI)', h.includes('Mary Lee'));
assert('status = Awaiting outcome', h.includes('Awaiting outcome'));
assert('automation shows recommendation actioned', h.includes('Recommendation actioned'));
assert('timeline has Payment received', h.includes('Payment received'));
assert('timeline has Order created', h.includes('Order') && h.includes('created'));
assert('learning rate = 67% (2 won / 1 lost)', h.includes('67%'), h.match(/\d+%[^<]*success|success[^<]*\d+%/)?.[0]);
assert('learning n=3 resolved', h.includes('over <b>3</b>') || h.includes('3</b> resolved'));
assert('avg days to close shown', /d to close/.test(h));
assert('avg follow-ups shown', /follow-ups/.test(h));
assert('automation = Completed manually (you)', h.includes('Completed manually (you)'));
assert('automation = Waiting on customer', h.includes('Waiting on customer'));
assert('briefing assessment cites 67% evidence', h.includes('Historical evidence'));
// ── Phase 4.8 on the awaiting + buyer scenario ──
assert('4.8 awaiting-customer continuity block', h.includes('AWAITING CUSTOMER') && h.includes('Open WhatsApp Again') && h.includes('Next review'));
assert('4.8 health = Excellent (proven buyer)', h.includes('Health: Excellent'));
assert('4.8 lifetime view populated', h.includes('Lifetime customer view') && h.includes('Lifetime orders'));
assert('4.8 relationship has stars (buyer)', h.includes('Relationship: <span style="color:var(--gold);">★'));
assert('4.8 everyone-awaiting drawer', h.includes('Everyone awaiting a reply (1)'));
assert('4.8 temperature reason cites paid orders', h.includes('Has paid orders'));

// ── Scenario 5: full risk surface (cold + unsubscribed + other staff + reply conflict) ──
console.log('\nScenario 5 — risk scan surfaces every data-supported risk');
H.setUser({ uid:'founder1' });
setData({
  intel:[{ leadId:'leadR1', score:60, closeProbability:0.4, recommendedOffer:'Manufacturing',
    expectedValue:40000, potentialValue:{value:90000}, isTest:false, isPrimaryRecord:true,
    suspiciousLead:false, duplicateCount:1, opportunitySource:'overdue', preferredChannel:'whatsapp',
    requiresNajah:true, lastMeaningfulActivity: daysAgoISO(30) }],
  leads:[{ _docId:'leadR1', name:'Cold Carl', whatsapp:'18765550000', email:'carl@x.com',
    createdAt: daysAgoISO(60), unsubscribed:true, lastReplyAt: daysAgoISO(0) }],
  outcomes:[{ id:'r-prev', leadId:'leadR1', status:'pending', recommendationType:'followup-overdue',
    actionedBy:'staff2', source:'jarvis-dashboard', actionedAt: daysAgoISO(2),
    recommendedAt: daysAgoISO(2).slice(0,10), expectedRevenue:40000 }]
});
H.ff(); h=html();
assert('risk: gone cold (30d)', h.includes('gone cold'));
assert('risk: unsubscribed', h.includes('UNSUBSCRIBED'));
assert('risk: another team member', h.includes('another team member'));
assert('risk: replied after outreach (conflict)', h.includes('replied AFTER'));
assert('risk: founder attention required', h.includes('Founder attention required'));

// ── Scenario 6: waiting-on-founder + scheduled automation states ──
console.log('\nScenario 6 — waiting-on-founder + scheduled (no prior action)');
setData({
  intel:[{ leadId:'leadF1', score:50, closeProbability:0.3, recommendedOffer:'Skincare',
    expectedValue:20000, potentialValue:{value:40000}, isTest:false, isPrimaryRecord:true,
    suspiciousLead:false, duplicateCount:1, opportunitySource:'newlead', preferredChannel:'email',
    requiresNajah:true, nextActionAt: daysAgoISO(-3), lastMeaningfulActivity: daysAgoISO(5) }],
  leads:[{ _docId:'leadF1', name:'Pending Pam', email:'pam@x.com', createdAt: daysAgoISO(10) }]
});
H.ff(); h=html();
assert('automation = Waiting on founder', h.includes('Waiting on founder'));
assert('automation = Scheduled next step', h.includes('Scheduled — next automated step'));
H.setUser(null);

// ── Scenario 3: jFFWon ensures an outcome record then resolves ────────────────
console.log('\nScenario 3 — Mark Won with no prior action creates + resolves an outcome');
setData({
  intel:[{ leadId:'leadW1', score:65, closeProbability:0.4, recommendedOffer:'Manufacturing',
    expectedValue:40000, potentialValue:{value:90000}, isTest:false, isPrimaryRecord:true,
    suspiciousLead:false, duplicateCount:1, opportunitySource:'newlead', preferredChannel:'whatsapp',
    lastMeaningfulActivity: daysAgoISO(5) }],
  leads:[{ _docId:'leadW1', name:'Sam Gold', whatsapp:'18761112222', email:'sam@g.com' }]
});
const before = H.outcomes().length;
// stub the modal so jConverted resolves without UI
H.setModal(async () => ({ reason:'Manufacturing Order', revenue:45000 }));
// Isolate the Founder Focus resolution path — silence unrelated render surfaces
// that need the app's CONTEXT (built by rebuild(), absent in this logic harness).
H.noop('renderInsights','renderLeaderboard','renderMarketing','renderPending','renderPendingAlert',
  'renderTopOpps','renderLeadCommand','renderTodayMoney','renderTopActions','renderNext15',
  'renderRevenueTarget','renderRevenueRisk','renderMoneyMissed');
(async () => {
  await H.jFFWon('leadW1');
  await new Promise(r=>setImmediate(r));
  const created = H.outcomes().length > before;
  const rec = H.outcomes().find(o=>o.leadId==='leadW1');
  assert('an outcome was created for the lead', created);
  assert('outcome carries a recommendationId', !!(rec && rec.recommendationId), rec && rec.recommendationId);
  assert('outcome carries recommendationType', !!(rec && rec.recommendationType), rec && rec.recommendationType);
  assert('outcome customerId = email', rec && rec.customerId==='sam@g.com');
  assert('outcome opportunityId = leadId', rec && rec.opportunityId==='leadW1');
  assert('outcome has product attached', rec && rec.product==='Manufacturing');
  assert('outcome has leadSource attached', rec && !!rec.leadSource);
  assert('outcome has expectedRevenue', rec && Number(rec.expectedRevenue)===40000);
  assert('outcome has actionedAt timestamp', rec && !!rec.actionedAt);
  assert('outcome marked converted/won', rec && (rec.status==='converted'));
  assert('actualRevenue recorded 45000', rec && Number(rec.actualRevenue)===45000);
  // duplicate prevention — clicking Mark Won again must NOT create a second record
  const afterFirst = H.outcomes().length;
  await H.jFFWon('leadW1');
  await new Promise(r=>setImmediate(r));
  assert('repeated Mark Won creates NO duplicate', H.outcomes().length===afterFirst,
    'before='+afterFirst+' after='+H.outcomes().length);
  assert('still exactly one record for the lead', H.outcomes().filter(o=>o.leadId==='leadW1').length===1);

  // ── Scenario 4: empty state ──
  console.log('\nScenario 4 — no honest opportunities → graceful empty state');
  setData({ intel:[], leads:[] });
  H.ff();
  const he = html();
  assert('empty-state message shown', he.includes('No open recommendations'));
  assert('no crash / still has header', he.includes('Founder Focus'));

  console.log(`\n──────────\nPASS ${pass} · FAIL ${fail}`);
  process.exit(fail?1:0);
})();
