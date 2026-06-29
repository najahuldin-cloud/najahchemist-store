// recommendation-agent/reconcile.js — PURE order→recommendation reconciliation core. §2
//
// Given the active recommendations, the orders, and a lead index, decide which
// recommendations have OBJECTIVE evidence of a win (a qualifying paid order) and
// whether that evidence is strong enough to auto-resolve or must go to Review Required.
//
// No Firestore/network here — the agent passes data + small accessor helpers, so this
// is fully unit-testable and deterministic. The agent decides whether to WRITE
// (live) or only record a PROPOSAL (shadow).

const RM = require('../_shared/recommendation-model');
const { matchOrderToLead, customerIdFor } = require('../_shared/identity');

// Normalize one order into a match record against the lead index.
// helpers: { isPaid(o)->bool, orderDate(o)->Date|null, orderTotal(o)->number, orderId(o)->string }
function evaluateOrder(order, leadIndex, helpers) {
  const m = matchOrderToLead(order, leadIndex);
  return {
    order,
    orderId: helpers.orderId(order),
    paid: !!helpers.isPaid(order),
    date: helpers.orderDate(order) || null,
    total: Number(helpers.orderTotal(order)) || 0,
    leadId: m.leadId,                 // unambiguous auto-bind, else null
    candidates: m.candidates || [],   // all leadIds the order could be
    customerId: m.customerId,
    confidence: m.confidence,
    method: m.method,
    ambiguous: m.ambiguous,
    decision: m.decision,             // 'auto' | 'review' | 'none'
  };
}

// Build resolution plans for every ACTIVE recommendation that has a qualifying order.
// Returns { resolutions, reviews } where each entry references a recommendationId and
// carries everything needed to write the outcome (orderId, revenue, variance, match).
function planResolutions({ recs, orders, leadIndex, helpers, nowISO }) {
  const matches = (orders || [])
    .map(o => evaluateOrder(o, leadIndex, helpers))
    .filter(x => x.paid && x.date);           // qualifying gate #1: paid + has a date

  // Index paid matches for quick lookup by bound leadId and by customerId.
  const byLead = new Map();      // leadId -> [match]  (auto-bound, unambiguous)
  const byCustomer = new Map();  // customerId -> [match]
  for (const x of matches) {
    if (x.leadId) { const a = byLead.get(x.leadId) || []; a.push(x); byLead.set(x.leadId, a); }
    if (x.customerId) { const a = byCustomer.get(x.customerId) || []; a.push(x); byCustomer.set(x.customerId, a); }
    // ambiguous candidate leads also indexed so a review can name them
    if (!x.leadId && x.candidates) for (const c of x.candidates) { const a = byLead.get(c) || []; a.push(x); byLead.set(c, a); }
  }

  const resolutions = [], reviews = [];
  for (const rec of (recs || [])) {
    if (!RM.isActiveState(rec.state)) continue;
    const baseline = rec.baselineActivityAt ? new Date(rec.baselineActivityAt) : null;

    // Candidate orders for this rec: bound by leadId, or (for review) by customerId.
    const pool = []
      .concat(byLead.get(rec.leadId) || [])
      .concat(rec.customerId ? (byCustomer.get(rec.customerId) || []) : []);
    // de-dup by orderId
    const seen = new Set();
    const candidates = pool.filter(x => { if (seen.has(x.orderId)) return false; seen.add(x.orderId); return true; })
      // qualifying gate #2: dated on/after the recommendation began
      .filter(x => RM.isQualifyingOrder({ paid: x.paid, orderDate: x.date, recBaseline: baseline }))
      .sort((a, b) => a.date - b.date);   // earliest qualifying conversion wins

    if (!candidates.length) continue;

    // Prefer a high-confidence, unambiguous, lead-bound match for auto-resolution.
    const auto = candidates.find(x => x.decision === 'auto' && x.leadId === rec.leadId);
    const chosen = auto || candidates[0];
    const actual = chosen.total;
    const expected = Number(rec.expectedRevenue) || 0;
    const base = {
      recommendationId: rec.recommendationId,
      leadId: rec.leadId,
      customerId: rec.customerId,
      recommendationType: rec.recommendationType,
      orderId: chosen.orderId,
      orderDate: chosen.date ? chosen.date.toISOString() : null,
      actualRevenue: actual,
      expectedRevenue: expected,
      revenueVariance: actual - expected,
      matchMethod: chosen.method,
      matchConfidence: chosen.confidence,
      ambiguous: chosen.ambiguous,
      candidates: chosen.candidates,
      evaluatedAt: nowISO,
    };

    if (auto) resolutions.push({ ...base, kind: 'auto-won' });
    else      reviews.push({ ...base, kind: 'review-required', reason: chosen.ambiguous ? 'Ambiguous match (shared contact)' : `Match confidence ${chosen.confidence} below auto-resolve threshold` });
  }
  return { resolutions, reviews };
}

module.exports = { evaluateOrder, planResolutions };
