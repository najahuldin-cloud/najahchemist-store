// Standalone validation of the recommendation-integrity pure core (no Firestore).
// Run: node scripts/validate-recommendation-integrity.js
'use strict';
const assert = require('assert');
const RM = require('../agents/_shared/recommendation-model');
const ID = require('../agents/_shared/identity');
const SYNC = require('../agents/recommendation-agent/sync');
const REC = require('../agents/recommendation-agent/reconcile');
const INTEG = require('../agents/recommendation-agent/integrity');

let pass = 0; const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n     ', e.message); process.exitCode = 1; } };

console.log('§3/§5 recommendation-model');
t('permanent ID is valid + type-coded + deterministic', () => {
  const id = RM.newRecommendationId('abc123def', 'HF', 1);
  assert(RM.isValidRecommendationId(id), id);
  assert(/^REC-[A-Z0-9]{6}-HF-C1-[A-Z0-9]{6}$/.test(id), id);
  assert.strictEqual(id, RM.newRecommendationId('abc123def', 'HF', 1)); // deterministic (concurrency key)
});
t('recType mirrors dashboard codes', () => {
  assert.strictEqual(RM.recType({ recommendedOffer: 'Manufacturing', opportunitySource: 'newlead' }).tc, 'MQ');
  assert.strictEqual(RM.recType({ opportunitySource: 'hot', preferredChannel: 'whatsapp' }).tc, 'HF');
  assert.strictEqual(RM.recType({ opportunitySource: 'overdue' }).tc, 'FO');
  assert.strictEqual(RM.recType({ opportunitySource: 'dormant' }).tc, 'RA');
});
t('state machine forbids illegal transitions', () => {
  assert(RM.canTransition(RM.STATE.GENERATED, RM.STATE.WON));
  assert(!RM.canTransition(RM.STATE.WON, RM.STATE.GENERATED));
  assert(!RM.canTransition(RM.STATE.ARCHIVED, RM.STATE.WON));
  assert(RM.canTransition(RM.STATE.WON, RM.STATE.ARCHIVED));
});
t('qualifying-order rule = paid AND dated-after', () => {
  const baseline = new Date('2026-06-01');
  assert.strictEqual(RM.isQualifyingOrder({ paid: true, orderDate: new Date('2026-06-10'), recBaseline: baseline }), true);
  assert.strictEqual(RM.isQualifyingOrder({ paid: true, orderDate: new Date('2026-05-10'), recBaseline: baseline }), false, 'old order must not qualify');
  assert.strictEqual(RM.isQualifyingOrder({ paid: false, orderDate: new Date('2026-06-10'), recBaseline: baseline }), false, 'unpaid must not qualify');
});
t('expiration + supersession policy', () => {
  const wc = { state: RM.STATE.WAITING_FOR_CUSTOMER };
  assert.strictEqual(RM.expirationFor(wc, { waitingDays: 25 }).state, RM.STATE.EXPIRED);
  const gen = { state: RM.STATE.GENERATED };
  assert.strictEqual(RM.expirationFor(gen, { ageDays: 35 }).state, RM.STATE.EXPIRED);
  assert.strictEqual(RM.expirationFor(gen, { ageDays: 1, hasNewerActiveOfOtherType: true }).state, RM.STATE.SUPERSEDED);
  assert.strictEqual(RM.expirationFor({ state: RM.STATE.WON }, { ageDays: 999 }), null, 'terminal never expires');
});

console.log('§4 identity matching');
const leads = [
  { leadId: 'L1', name: 'Ann Lee',  email: 'ann@x.com', phone: '18761111111' },
  { leadId: 'L2', name: 'Bob Roy',  email: 'bob@x.com', phone: '18762222222' },
  { leadId: 'L3', name: 'Ann Twin', email: 'ann@x.com', phone: '18763333333' }, // shares email w/ L1
];
const index = ID.buildLeadIndex(leads);
t('explicit leadId → confidence 1.0 auto', () => {
  const m = ID.matchOrderToLead({ leadId: 'L2', total: 1 }, index);
  assert.strictEqual(m.method, 'leadId'); assert.strictEqual(m.leadId, 'L2'); assert.strictEqual(m.decision, 'auto');
});
t('phone-only → 0.90 auto', () => {
  const m = ID.matchOrderToLead({ customerWhatsApp: '1-876-222-2222' }, index);
  assert.strictEqual(m.method, 'phone'); assert.strictEqual(m.leadId, 'L2'); assert.strictEqual(m.decision, 'auto');
});
t('shared email → ambiguous → review (not auto)', () => {
  const m = ID.matchOrderToLead({ email: 'ann@x.com' }, index);
  assert.strictEqual(m.method, 'email'); assert.strictEqual(m.ambiguous, true);
  assert.strictEqual(m.leadId, null, 'ambiguous must not bind a single lead');
  assert.strictEqual(m.decision, 'review');
});
t('no identifiers → no match', () => {
  assert.strictEqual(ID.matchOrderToLead({ total: 5 }, index).decision, 'none');
});

console.log('§A persist-at-generation builders');
t('isGeneratable filters test/won leads', () => {
  assert(SYNC.isGeneratable({ leadId: 'L2', isTest: false }));
  assert(!SYNC.isGeneratable({ leadId: 'L2', isTest: true }));
  assert(!SYNC.isGeneratable({ leadId: 'L2', lifecycleStage: 'Won' }));
});
t('newRecord stamps permanent id + Generated + baseline', () => {
  const rec = SYNC.newRecord({ leadId: 'L2', opportunitySource: 'hot', preferredChannel: 'whatsapp', expectedValue: 50000, lastMeaningfulActivity: '2026-06-01T00:00:00Z' }, leads[1], '2026-06-29T00:00:00Z');
  assert(RM.isValidRecommendationId(rec.recommendationId));
  assert.strictEqual(rec.state, RM.STATE.GENERATED);
  assert.strictEqual(rec.baselineActivityAt, '2026-06-01T00:00:00Z');
  assert.strictEqual(rec.expectedRevenue, 50000);
  assert.strictEqual(rec.customerId, 'c:e:bob@x.com');
});
t('refreshedDerived never rewrites the permanent id', () => {
  const patch = SYNC.refreshedDerived({ state: RM.STATE.WAITING_FOR_CUSTOMER }, { leadId: 'L2', opportunitySource: 'hot', expectedValue: 70000 }, leads[1], '2026-06-29T00:00:00Z');
  assert.strictEqual(patch.recommendationId, undefined);
  assert.strictEqual(patch.expectedRevenue, 70000);
});

console.log('§2/§C reconciliation');
const helpers = { isPaid: o => !!o.paid, orderDate: o => o.date ? new Date(o.date) : null, orderTotal: o => o.total, orderId: o => o.id };
const recs = [
  { recommendationId: 'REC-L20000-20260601-HF-AAAA', leadId: 'L2', customerId: 'c:e:bob@x.com', recommendationType: 'hot-followup', state: RM.STATE.WAITING_FOR_CUSTOMER, baselineActivityAt: '2026-06-01T00:00:00Z', expectedRevenue: 50000 },
  { recommendationId: 'REC-L10000-20260601-HF-BBBB', leadId: 'L1', customerId: 'c:e:ann@x.com', recommendationType: 'hot-followup', state: RM.STATE.WAITING_FOR_CUSTOMER, baselineActivityAt: '2026-06-01T00:00:00Z', expectedRevenue: 30000 },
];
const orders = [
  { id: 'O1', leadId: 'L2', paid: true, date: '2026-06-10', total: 62100 },  // qualifying auto-won for R1
  { id: 'O2', leadId: 'L2', paid: true, date: '2026-05-01', total: 99999 },  // pre-baseline → ignored
  { id: 'O3', email: 'ann@x.com', paid: true, date: '2026-06-12', total: 40000 }, // ambiguous → review for R2
];
const plan = REC.planResolutions({ recs, orders, leadIndex: index, helpers, nowISO: '2026-06-29T00:00:00Z' });
t('auto-won uses the qualifying order + correct variance', () => {
  assert.strictEqual(plan.resolutions.length, 1);
  const r = plan.resolutions[0];
  assert.strictEqual(r.recommendationId, 'REC-L20000-20260601-HF-AAAA');
  assert.strictEqual(r.orderId, 'O1');
  assert.strictEqual(r.actualRevenue, 62100);
  assert.strictEqual(r.revenueVariance, 12100);
  assert.strictEqual(r.matchMethod, 'leadId');
});
t('pre-baseline order never auto-wins', () => {
  assert(!JSON.stringify(plan).includes('O2'));
});
t('ambiguous match → review, not auto', () => {
  assert.strictEqual(plan.reviews.length, 1);
  assert.strictEqual(plan.reviews[0].recommendationId, 'REC-L10000-20260601-HF-BBBB');
});

console.log('§8 integrity scan');
t('detects completed-order-still-active + duplicate + missing id + orphan', () => {
  const irecs = [
    { recommendationId: 'REC-L20000-20260601-HF-AAAA', leadId: 'L2', recommendationType: 'hot-followup', state: RM.STATE.WAITING_FOR_CUSTOMER, generatedAt: '2026-06-20T00:00:00Z' },
    { recommendationId: 'REC-L20000-20260601-HF-CCCC', leadId: 'L2', recommendationType: 'hot-followup', state: RM.STATE.GENERATED, generatedAt: '2026-06-20T00:00:00Z' }, // duplicate lead+type
    { recommendationId: 'BAD-ID', leadId: 'L9', recommendationType: 'x', state: RM.STATE.GENERATED, generatedAt: '2026-06-20T00:00:00Z' }, // missing-id + orphan
  ];
  const rep = INTEG.scanIntegrity({
    recs: irecs,
    knownLeadIds: new Set(['L1', 'L2']),
    qualifyingRecIds: new Set(['REC-L20000-20260601-HF-AAAA']),
    nowISO: '2026-06-29T00:00:00Z',
  });
  const types = rep.violations.map(v => v.type);
  assert(types.includes('completed-order-still-active'));
  assert(types.includes('duplicate'));
  assert(types.includes('missing-id'));
  assert(types.includes('orphan'));
});

console.log(`\n${pass} checks passed${process.exitCode ? ' — WITH FAILURES' : ''}.`);
