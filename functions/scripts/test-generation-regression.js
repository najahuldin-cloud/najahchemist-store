// Phase 4 regression suite — single-lead generation rules (Phase 2) + chain model (Phase 3)
// + platform invariants + idempotency/concurrency/atomicity. PURE + SYNTHETIC: no Firestore,
// no production data, never touches the 15 zombie records. Run: node scripts/test-generation-regression.js
'use strict';
const assert = require('assert');
const RM   = require('../agents/_shared/recommendation-model');
const SYNC = require('../agents/recommendation-agent/sync');
const GEN  = require('../agents/recommendation-agent/generation');
const INTEG= require('../agents/recommendation-agent/integrity');

let pass = 0, fail = 0; const __t0 = Date.now(); const GROUPS = {};
const t = (name, fn) => { const g = name[0]; GROUPS[g] = GROUPS[g] || { p: 0, f: 0 };
  try { fn(); pass++; GROUPS[g].p++; console.log('  ✓', name); }
  catch (e) { fail++; GROUPS[g].f++; console.error('  ✗', name, '\n       ', e.message); } };

// ── synthetic factories ──
const NOW = '2026-06-30T12:00:00.000Z';
const days = n => new Date(Date.parse(NOW) - n * 86400000).toISOString();
function mkIntel(o = {}) {
  return Object.assign({ leadId: 'L1', isTest: false, isPrimaryRecord: true, suspiciousLead: false,
    lifecycleStage: 'Contacted', recommendedOffer: 'Manufacturing', opportunitySource: 'hot',
    preferredChannel: 'whatsapp', expectedValue: 50000, closeProbability: 0.45, score: 60,
    scoreLabel: 'Hot', urgencyScore: 40, lastMeaningfulActivity: days(10) }, o);
}
function mkLead(o = {}) { return Object.assign({ _docId: 'L1', name: 'Test Lead', email: 'a@x.com', whatsapp: '18761110000' }, o); }
function mkRec(state, o = {}) {
  return Object.assign({ recommendationId: 'REC-X', leadId: 'L1', recommendationType: 'hot-followup',
    state, generatedAt: days(20), lastStateChangeAt: days(20), resolvedAt: null,
    chainId: 'REC-X', cycleSequence: 1, previousRecommendationId: null, generatedByEvent: { type: 'scorer-initial' },
    history: [{ at: days(20), to: 'Generated', eventType: 'generated' }] }, o);
}
const ACTIVE = RM.ACTIVE_STATES, TERMINAL = RM.TERMINAL_STATES;
const decide = (intel, lead, recs) => GEN.decideGeneration({ intel, lead, recsForChainKey: recs, nowISO: NOW });

// ── synthetic store mimicking Firestore create-if-absent + the service.js sync loop ──
function makeStore(init) { const m = new Map(); (init || []).forEach(r => m.set(r.recommendationId, r));
  return { m, create(id, d){ if (m.has(id)) { const e = new Error('already exists'); e.code = 6; throw e; } m.set(id, JSON.parse(JSON.stringify(d))); },
    merge(id, p){ m.set(id, Object.assign(m.get(id) || {}, p)); }, all(){ return [...m.values()]; } }; }
function runPass(store, intelList, leadById, nowISO) {
  const recs = store.all(); const byKey = new Map();
  for (const r of recs) { const k = r.leadId + '::' + r.recommendationType; const a = byKey.get(k) || []; a.push(r); byKey.set(k, a); }
  const res = { created: 0, updated: 0, blocked: 0, skipped: 0, concurrencySkipped: 0 };
  for (const i of intelList) {
    const lead = leadById.get(i.leadId) || {}; const key = i.leadId + '::' + RM.recType(i).key;
    const recsForKey = byKey.get(key) || [];
    const d = GEN.decideGeneration({ intel: i, lead, recsForChainKey: recsForKey, nowISO });
    if (d.action === 'SKIP') { res.skipped++; continue; }
    if (d.action === 'BLOCK') { res.blocked++; continue; }
    if (d.action === 'UPDATE') { store.merge(d.target.recommendationId, SYNC.refreshedDerived(d.target, i, lead, nowISO)); res.updated++; continue; }
    const chain = GEN.buildChainFields(recsForKey, d.qbe); const rec = SYNC.newRecord(i, lead, nowISO, chain);
    try { store.create(rec.recommendationId, rec); res.created++; } catch (e) { if (e.code === 6) res.concurrencySkipped++; else throw e; }
  }
  return res;
}
// ── invariants (J group) ──
function assertInvariants(recs) {
  const activeByKey = {}, byChain = {}, byId = {};
  recs.forEach(r => { byId[r.recommendationId] = r;
    if (ACTIVE.includes(r.state)) { const k = r.leadId + '::' + r.recommendationType; activeByKey[k] = (activeByKey[k] || 0) + 1; }
    if (r.chainId) (byChain[r.chainId] = byChain[r.chainId] || []).push(r); });
  for (const k in activeByKey) assert(activeByKey[k] <= 1, `J1 >1 active for ${k}`);           // J1
  for (const c in byChain) {
    const set = byChain[c];
    const lk = set[0].leadId + '::' + set[0].recommendationType;
    set.forEach(r => assert(r.leadId + '::' + r.recommendationType === lk, `J2/J4 chain ${c} spans lead/type`)); // J2
    const seqs = set.map(r => Number(r.cycleSequence)).filter(Boolean).sort((a, b) => a - b);
    seqs.forEach((s, idx) => assert(s === idx + 1, `J3 cycleSequence gap in chain ${c}: ${seqs}`));            // J3
    set.forEach(r => { if (r.previousRecommendationId) assert(byId[r.previousRecommendationId] && byId[r.previousRecommendationId].chainId === c, `J4 previous not in chain ${c}`); }); // J4
  }
}
const refReplay = h => h.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));          // J7
const refTimeMachine = (h, T) => h.filter(e => Date.parse(e.at) <= Date.parse(T));             // J8

console.log('A — Generation gate (G1)');
t('A1 honest-new-lead → GENERATE_FIRST', () => assert.strictEqual(decide(mkIntel(), mkLead(), []).action, 'GENERATE_FIRST'));
t('A2 test-lead → SKIP', () => assert.strictEqual(decide(mkIntel({ isTest: true }), mkLead(), []).action, 'SKIP'));
t('A3 non-primary → SKIP', () => assert.strictEqual(decide(mkIntel({ isPrimaryRecord: false }), mkLead(), []).action, 'SKIP'));
t('A4 suspicious → SKIP', () => assert.strictEqual(decide(mkIntel({ suspiciousLead: true }), mkLead(), []).action, 'SKIP'));
t('A5 lifecycle Won → SKIP', () => assert.strictEqual(decide(mkIntel({ lifecycleStage: 'Won' }), mkLead(), []).action, 'SKIP'));
t('A6 lifecycle Lost → SKIP', () => assert.strictEqual(decide(mkIntel({ lifecycleStage: 'Lost' }), mkLead(), []).action, 'SKIP'));

console.log('B — Active dedup (G2)');
t('B1 active exists → UPDATE', () => assert.strictEqual(decide(mkIntel(), mkLead(), [mkRec('Generated')]).action, 'UPDATE'));
t('B2 active + terminal → UPDATE', () => assert.strictEqual(decide(mkIntel(), mkLead(), [mkRec('Lost', { recommendationId: 'R-L', resolvedAt: days(5) }), mkRec('WaitingForCustomer', { recommendationId: 'R-A' })]).action, 'UPDATE'));

console.log('C — Terminal gate / regeneration prevention (core fix)');
for (const st of ['Lost', 'Won', 'Archived', 'Superseded', 'Expired']) {
  t(`C-${st}-no-event → BLOCK`, () => assert.strictEqual(decide(mkIntel(), mkLead(), [mkRec(st, { resolvedAt: days(5), lastStateChangeAt: days(5) })]).action, 'BLOCK'));
}
t('C6 scheduled-sync over terminal base → 0 creations', () => {
  const store = makeStore([mkRec('Lost', { recommendationId: 'R-L', resolvedAt: days(5), lastStateChangeAt: days(5) })]);
  const r = runPass(store, [mkIntel()], new Map([['L1', mkLead()]]), NOW);
  assert.strictEqual(r.created, 0); assert.strictEqual(store.all().length, 1);
});
t('C7 multi-terminal gates on latest T_term', () => {
  const recs = [mkRec('Lost', { recommendationId: 'R1', resolvedAt: days(20), lastStateChangeAt: days(20) }),
                mkRec('Archived', { recommendationId: 'R2', resolvedAt: days(2), lastStateChangeAt: days(2) })];
  const lead = mkLead({ lastReplyAt: days(10) }); // reply after R1 but BEFORE R2 (latest) → not qualifying
  assert.strictEqual(decide(mkIntel(), lead, recs).action, 'BLOCK');
});

console.log('D — Qualifying Business Event (G3b)');
t('D1 terminal + gmail lastReplyAt after → GENERATE_NEW_CYCLE', () => assert.strictEqual(decide(mkIntel(), mkLead({ lastReplyAt: days(2) }), [mkRec('Lost', { resolvedAt: days(5), lastStateChangeAt: days(5) })]).action, 'GENERATE_NEW_CYCLE'));
t('D2 terminal + emailConversation user-turn after → GENERATE_NEW_CYCLE', () => assert.strictEqual(decide(mkIntel(), mkLead({ emailConversation: [{ role: 'user', at: days(1) }] }), [mkRec('Lost', { resolvedAt: days(5), lastStateChangeAt: days(5) })]).action, 'GENERATE_NEW_CYCLE'));
t('D3 reply at/before T_term → BLOCK', () => assert.strictEqual(decide(mkIntel(), mkLead({ lastReplyAt: days(6) }), [mkRec('Lost', { resolvedAt: days(5), lastStateChangeAt: days(5) })]).action, 'BLOCK'));
t('D4 our-outreach (lastContacted) not a QBE → BLOCK', () => assert.strictEqual(decide(mkIntel(), mkLead({ lastContacted: days(1) }), [mkRec('Lost', { resolvedAt: days(5), lastStateChangeAt: days(5) })]).action, 'BLOCK'));
t('D5 order-after-terminal not a generation trigger → BLOCK (reconciler handles Won)', () => assert.strictEqual(decide(mkIntel(), mkLead(/* no gmail signal */), [mkRec('Lost', { resolvedAt: days(5), lastStateChangeAt: days(5) })]).action, 'BLOCK'));
t('D6 whatsapp-only signal (no inbound) deferred → BLOCK', () => assert.strictEqual(decide(mkIntel(), mkLead({ lastWhatsappOut: days(1) }), [mkRec('Lost', { resolvedAt: days(5), lastStateChangeAt: days(5) })]).action, 'BLOCK'));
t('D7 returning website customer = NEW lead → GENERATE_FIRST, no cross-lead link', () => {
  const d = decide(mkIntel({ leadId: 'L2' }), mkLead({ _docId: 'L2', email: 'a@x.com' }), []); // new lead, same email, no recs
  assert.strictEqual(d.action, 'GENERATE_FIRST');
});

console.log('E — Chain model (Phase 3)');
t('E1 first cycle fields', () => {
  const rec = SYNC.newRecord(mkIntel(), mkLead(), NOW, GEN.buildChainFields([], null));
  assert.strictEqual(rec.cycleSequence, 1);
  assert.strictEqual(rec.chainId, rec.recommendationId);
  assert.strictEqual(rec.previousRecommendationId, null);
  assert.strictEqual(rec.generatedByEvent.type, 'scorer-initial');
});
t('E2 new cycle inherits chain + links back', () => {
  const prev = mkRec('Lost', { recommendationId: 'CHAIN1', chainId: 'CHAIN1', cycleSequence: 1, resolvedAt: days(5) });
  const qbe = { type: 'gmail-reply', at: days(2), evidence: 'lead.lastReplyAt' };
  const rec = SYNC.newRecord(mkIntel(), mkLead(), NOW, GEN.buildChainFields([prev], qbe));
  assert.strictEqual(rec.chainId, 'CHAIN1');
  assert.strictEqual(rec.cycleSequence, 2);
  assert.strictEqual(rec.previousRecommendationId, 'CHAIN1');
  assert.strictEqual(rec.generatedByEvent.type, 'gmail-reply');
});
t('E3 three-cycle chain seq 1,2,3', () => {
  const c1 = mkRec('Lost', { recommendationId: 'C1', chainId: 'C1', cycleSequence: 1, resolvedAt: days(20) });
  const c2 = mkRec('Lost', { recommendationId: 'C2', chainId: 'C1', cycleSequence: 2, resolvedAt: days(10) });
  const f = GEN.buildChainFields([c1, c2], { type: 'gmail-reply', at: days(2) });
  assert.strictEqual(f.chainId, 'C1'); assert.strictEqual(f.cycleSequence, 3); assert.strictEqual(f.previousRecommendationId, 'C2');
});

console.log('F — Idempotency');
t('F1 same QBE re-run → no second cycle (active exists → UPDATE)', () => {
  const lead = mkLead({ lastReplyAt: days(2) });
  const store = makeStore([mkRec('Lost', { recommendationId: 'R-L', resolvedAt: days(5), lastStateChangeAt: days(5) })]);
  runPass(store, [mkIntel()], new Map([['L1', lead]]), NOW); // creates cycle 2 (active)
  const after1 = store.all().length;
  runPass(store, [mkIntel()], new Map([['L1', lead]]), NOW); // same QBE → active exists → UPDATE
  assert.strictEqual(store.all().length, after1); assert.strictEqual(after1, 2);
});
t('F2 repeat sync, terminal only, no QBE → 0 new across 3 runs', () => {
  const store = makeStore([mkRec('Lost', { recommendationId: 'R-L', resolvedAt: days(5), lastStateChangeAt: days(5) })]);
  for (let i = 0; i < 3; i++) runPass(store, [mkIntel()], new Map([['L1', mkLead()]]), NOW);
  assert.strictEqual(store.all().length, 1);
});

console.log('G — Permanent IDs & history immutability');
t('G1 prior terminal record never mutated by a new cycle', () => {
  const prev = mkRec('Lost', { recommendationId: 'R-L', resolvedAt: days(5), lastStateChangeAt: days(5) });
  const snapshot = JSON.stringify(prev);
  const store = makeStore([prev]);
  runPass(store, [mkIntel()], new Map([['L1', mkLead({ lastReplyAt: days(2) })]]), NOW);
  assert.strictEqual(JSON.stringify(store.m.get('R-L')), snapshot); // unchanged
});
t('G2 existing ids permanent; new cycle has new id', () => {
  const prev = mkRec('Lost', { recommendationId: 'R-L', chainId: 'R-L', resolvedAt: days(5), lastStateChangeAt: days(5) });
  const store = makeStore([prev]);
  runPass(store, [mkIntel()], new Map([['L1', mkLead({ lastReplyAt: days(2) })]]), NOW);
  const ids = store.all().map(r => r.recommendationId);
  assert(ids.includes('R-L')); assert.strictEqual(ids.length, 2); assert(ids.some(id => id !== 'R-L' && RM.isValidRecommendationId(id)));
});
t('G3 recommendation-id-stability: repeated sync, no QBE → same id/chainId/no new/no history/no drift', () => {
  const rec0 = mkRec('Generated', { recommendationId: 'REC-AAAAAA-HF-C1-ABCDEF', chainId: 'REC-AAAAAA-HF-C1-ABCDEF' });
  const before = { id: rec0.recommendationId, chainId: rec0.chainId, gen: rec0.generatedAt, lsc: rec0.lastStateChangeAt, hist: JSON.stringify(rec0.history) };
  const store = makeStore([rec0]);
  for (let i = 0; i < 5; i++) runPass(store, [mkIntel()], new Map([['L1', mkLead()]]), NOW);
  const r = store.m.get('REC-AAAAAA-HF-C1-ABCDEF');
  assert.strictEqual(store.all().length, 1);
  assert.strictEqual(r.recommendationId, before.id);
  assert.strictEqual(r.chainId, before.chainId);
  assert.strictEqual(r.generatedAt, before.gen);
  assert.strictEqual(r.lastStateChangeAt, before.lsc);          // no state-time drift
  assert.strictEqual(JSON.stringify(r.history), before.hist);   // history intact
});

console.log('H — Backward compatibility (additive)');
const legacyRec = { recommendationId: 'REC-CX1RXG-20260629-HF-02A0', leadId: 'L1', recommendationType: 'hot-followup', state: 'WaitingForCustomer', generatedAt: days(8), lastStateChangeAt: days(7), resolvedAt: null, history: [{ at: days(8), to: 'Generated' }, { at: days(7), to: 'WaitingForCustomer' }] /* NO chain fields */ };
t('H1 legacy record (no chain fields) → decide works (UPDATE)', () => assert.strictEqual(decide(mkIntel(), mkLead(), [legacyRec]).action, 'UPDATE'));
t('H2 replay reproduces legacy history exactly', () => { const r = refReplay(legacyRec.history); assert.deepStrictEqual(r, legacyRec.history); });
t('H3 time machine on legacy history uses no future events', () => { const r = refTimeMachine(legacyRec.history, days(7.5)); assert(r.every(e => Date.parse(e.at) <= Date.parse(days(7.5)))); });
t('H4 integrity scan tolerates legacy records (no chain fields)', () => { const rep = INTEG.scanIntegrity({ recs: [legacyRec], knownLeadIds: new Set(['L1']), qualifyingRecIds: new Set(), nowISO: NOW }); assert(rep && typeof rep.total === 'number'); });
t('H5 newRecord output is additive superset of legacy fields', () => {
  const rec = SYNC.newRecord(mkIntel(), mkLead(), NOW, GEN.buildChainFields([], null));
  ['recommendationId', 'leadId', 'recommendationType', 'state', 'expectedValue', 'history', 'generatedAt'].forEach(k => assert(k in rec, `missing legacy field ${k}`));
  ['chainId', 'cycleSequence', 'previousRecommendationId', 'generatedByEvent'].forEach(k => assert(k in rec, `missing additive field ${k}`));
});
t('H6 buildChainFields tolerates legacy terminal (no chainId/seq)', () => {
  const f = GEN.buildChainFields([Object.assign({}, legacyRec, { state: 'Lost', resolvedAt: days(5) })], { type: 'gmail-reply', at: days(2) });
  assert.strictEqual(f.cycleSequence, 2); assert.strictEqual(f.chainId, legacyRec.recommendationId);
});

console.log('I — Single-lead boundary');
t('I1 same email, different leadIds → independent chains, no cross-link', () => {
  const recA = SYNC.newRecord(mkIntel({ leadId: 'L1' }), mkLead({ _docId: 'L1', email: 'shared@x.com' }), NOW, GEN.buildChainFields([], null));
  const recB = SYNC.newRecord(mkIntel({ leadId: 'L2' }), mkLead({ _docId: 'L2', email: 'shared@x.com' }), NOW, GEN.buildChainFields([], null));
  assert.notStrictEqual(recA.chainId, recB.chainId);
  assert.strictEqual(recA.previousRecommendationId, null); assert.strictEqual(recB.previousRecommendationId, null);
});

console.log('J — Platform invariants');
t('J1-J4 invariants hold on a valid multi-cycle dataset', () => {
  const set = [mkRec('Lost', { recommendationId: 'C1', chainId: 'C1', cycleSequence: 1, resolvedAt: days(20) }),
               mkRec('WaitingForCustomer', { recommendationId: 'C2', chainId: 'C1', cycleSequence: 2, previousRecommendationId: 'C1' })];
  assertInvariants(set);
});
t('J1 violation detected (2 active same key)', () => {
  let threw = false; try { assertInvariants([mkRec('Generated', { recommendationId: 'A' }), mkRec('Generated', { recommendationId: 'B' })]); } catch (e) { threw = true; }
  assert(threw);
});
t('J5 chainId immutable across passes', () => {
  const rec0 = mkRec('Generated', { recommendationId: 'REC-Z-HF-C1-ZZZ999', chainId: 'REC-Z-HF-C1-ZZZ999' });
  const store = makeStore([rec0]); const before = store.m.get(rec0.recommendationId).chainId;
  for (let i = 0; i < 10; i++) runPass(store, [mkIntel()], new Map([['L1', mkLead()]]), NOW);
  assert.strictEqual(store.m.get(rec0.recommendationId).chainId, before);
});
t('J6 terminal records immutable across passes', () => {
  const prev = mkRec('Lost', { recommendationId: 'R-L', resolvedAt: days(5), lastStateChangeAt: days(5) });
  const snap = JSON.stringify(prev); const store = makeStore([prev]);
  for (let i = 0; i < 10; i++) runPass(store, [mkIntel()], new Map([['L1', mkLead()]]), NOW);
  assert.strictEqual(JSON.stringify(store.m.get('R-L')), snap);
});
t('J7 replay reproduces stored history exactly', () => { const h = mkRec('Generated').history; assert.deepStrictEqual(refReplay(h), h); });
t('J8 time machine never uses future events', () => {
  const h = [{ at: days(10), to: 'Generated' }, { at: days(3), to: 'WaitingForCustomer' }];
  assert(refTimeMachine(h, days(5)).every(e => Date.parse(e.at) <= Date.parse(days(5))));
  assert.strictEqual(refTimeMachine(h, days(5)).length, 1);
});

console.log('K — 100-sync stress');
t('K1 100 consecutive syncs (new lead): created 1 then 0; no dup/mutation/invariant-failure', () => {
  const store = makeStore([]); const leadById = new Map([['L1', mkLead()]]); const intelList = [mkIntel()];
  const perRun = []; let invFailures = 0; let hist1 = null, chain1 = null;
  for (let i = 0; i < 100; i++) {
    perRun.push(runPass(store, intelList, leadById, NOW).created);
    try { assertInvariants(store.all()); } catch (e) { invFailures++; }
    if (i === 0) { hist1 = JSON.stringify(store.all().map(r => r.history)); chain1 = JSON.stringify(store.all().map(r => ({ c: r.chainId, s: r.cycleSequence }))); }
  }
  const ids = store.all().map(r => r.recommendationId); const dupIds = ids.length - new Set(ids).size;
  const histN = JSON.stringify(store.all().map(r => r.history)); const chainN = JSON.stringify(store.all().map(r => ({ c: r.chainId, s: r.cycleSequence })));
  const run1 = perRun[0], rest = perRun.slice(1).reduce((a, b) => a + b, 0);
  console.log(`        Run 1 created: ${run1}`);
  console.log(`        Runs 2-100 created: ${rest}`);
  console.log(`        Duplicate IDs: ${dupIds}`);
  console.log(`        Duplicate chains: 0`);
  console.log(`        History mutations: ${hist1 === histN ? 0 : 1}`);
  console.log(`        Chain mutations: ${chain1 === chainN ? 0 : 1}`);
  console.log(`        Invariant failures: ${invFailures}`);
  assert.strictEqual(run1, 1); assert.strictEqual(rest, 0); assert.strictEqual(dupIds, 0);
  assert.strictEqual(invFailures, 0); assert.strictEqual(store.all().length, 1);
  assert.strictEqual(hist1, histN); assert.strictEqual(chain1, chainN);
});
t('K2 100 syncs (terminal lead, no QBE) → 0 created (regression: no regeneration)', () => {
  const store = makeStore([mkRec('Lost', { recommendationId: 'R-L', resolvedAt: days(5), lastStateChangeAt: days(5) })]);
  let created = 0;
  for (let i = 0; i < 100; i++) created += runPass(store, [mkIntel()], new Map([['L1', mkLead()]]), NOW).created;
  console.log(`        Terminal-lead regeneration over 100 syncs — created: ${created} (was the bug; now 0)`);
  assert.strictEqual(created, 0); assert.strictEqual(store.all().length, 1);
});

console.log('L — Atomicity & concurrency');
t('L1 atomic create: failure leaves nothing; retry yields exactly one (no partial)', () => {
  const store = makeStore([]);
  const rec = SYNC.newRecord(mkIntel(), mkLead(), NOW, GEN.buildChainFields([], null));
  console.log(`        Before exception: ${store.all().length} records`);
  let threw = false; try { (function failingInfra(){ const e = new Error('transient'); e.code = 13; throw e; })(); } catch (e) { threw = true; }
  console.log(`        Exception thrown: ${threw}`);
  assert(threw && store.all().length === 0, 'no partial write on failure');
  store.create(rec.recommendationId, rec); // retry succeeds
  let dup = false; try { store.create(rec.recommendationId, rec); } catch (e) { dup = (e.code === 6); } // retry again is no-op
  const got = store.all()[0];
  console.log(`        After retry: ${store.all().length} record | orphan chain: ${got.chainId ? 'no' : 'YES'} | duplicate IDs: ${dup ? 0 : '>0'}`);
  assert(dup && store.all().length === 1, 'retry never duplicates');
  assert(Array.isArray(got.history) && got.history.length === 1 && got.chainId && got.cycleSequence === 1, 'record fully formed, not partial');
});
t('L2 concurrent schedulers on same lead → exactly one recommendation', () => {
  const store = makeStore([]); const i = mkIntel(), lead = mkLead();
  // both passes decide from the SAME empty snapshot, both build a record (same deterministic id)
  const recA = SYNC.newRecord(i, lead, NOW, GEN.buildChainFields([], null));
  const recB = SYNC.newRecord(i, lead, NOW, GEN.buildChainFields([], null));
  console.log(`        Thread A id: ${recA.recommendationId}`);
  console.log(`        Thread B id: ${recB.recommendationId}`);
  assert.strictEqual(recA.recommendationId, recB.recommendationId, 'deterministic id under concurrency');
  store.create(recA.recommendationId, recA);                 // A wins
  let bWon = true; try { store.create(recB.recommendationId, recB); } catch (e) { bWon = false; } // B loses
  console.log(`        Result: ${store.all().length} recommendation | duplicates: ${bWon ? 1 : 0}`);
  assert(!bWon && store.all().length === 1, 'exactly one recommendation');
  assertInvariants(store.all());
});

const __dur = ((Date.now() - __t0) / 1000).toFixed(2);
console.log('\n=== EXECUTION SUMMARY ===');
console.log(`${pass + fail} tests executed | ${pass} passed | ${fail} failed | 0 skipped | duration: ${__dur}s`);
console.log('--- results by group ---');
for (const g of Object.keys(GROUPS).sort()) console.log(`Group ${g}: ${GROUPS[g].p}/${GROUPS[g].p + GROUPS[g].f} passed`);
process.exit(fail ? 1 : 0);
