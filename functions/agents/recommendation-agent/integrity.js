// recommendation-agent/integrity.js — PURE recommendation-integrity detector. §8
//
// Scans the canonical recommendations against the rest of the system and reports
// violations. No Firestore/network — the agent loads data and passes it in.
//
// Detects: duplicates, orphans, customerless recs, recs with completed orders,
// expired/stale recs, and recs with missing/invalid Recommendation IDs.

const RM = require('../_shared/recommendation-model');

const SEV = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

function daysBetween(aISO, bISO) {
  const a = new Date(aISO), b = new Date(bISO);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

// scanIntegrity:
//   recs            — all canonical recommendation docs
//   knownLeadIds    — Set of leadIds that currently exist (for orphan detection)
//   qualifyingRecIds— Set of recommendationIds that have a qualifying paid order
//                     (from reconcile.planResolutions); active members are violations
//   nowISO          — clock
function scanIntegrity({ recs, knownLeadIds, qualifyingRecIds, nowISO }) {
  const violations = [];
  const add = (type, severity, rec, detail, extra) => violations.push({
    type, severity,
    recommendationId: rec && rec.recommendationId || null,
    leadId: rec && rec.leadId || null,
    detail, ...(extra || {}),
  });

  const known = knownLeadIds instanceof Set ? knownLeadIds : new Set(knownLeadIds || []);
  const qualifying = qualifyingRecIds instanceof Set ? qualifyingRecIds : new Set(qualifyingRecIds || []);

  // Duplicate detection — more than one ACTIVE rec for the same (leadId, type).
  const activeByKey = new Map();
  for (const rec of (recs || [])) {
    if (!RM.isActiveState(rec.state)) continue;
    const key = RM.openCycleKey(rec.leadId, rec.recommendationType);
    const arr = activeByKey.get(key) || []; arr.push(rec); activeByKey.set(key, arr);
  }
  for (const [key, arr] of activeByKey) {
    if (arr.length > 1) {
      add('duplicate', SEV.HIGH, arr[0],
        `${arr.length} active recommendations share lead+type ${key}`,
        { duplicateIds: arr.map(r => r.recommendationId) });
    }
  }

  // Per-rec checks.
  for (const rec of (recs || [])) {
    // Missing / invalid Recommendation ID.
    if (!RM.isValidRecommendationId(rec.recommendationId)) {
      add('missing-id', SEV.CRITICAL, rec, `Invalid or missing Recommendation ID: ${rec.recommendationId || '(none)'}`);
    }
    if (!RM.isActiveState(rec.state)) continue; // remaining checks are about active work

    // Orphan — lead no longer exists.
    if (rec.leadId && known.size && !known.has(rec.leadId)) {
      add('orphan', SEV.HIGH, rec, `Lead ${rec.leadId} no longer exists`);
    }
    // Customerless — no way to reach/identify the customer.
    if (!rec.customerId && !rec.leadId) {
      add('customerless', SEV.HIGH, rec, 'Recommendation has neither customerId nor leadId');
    }
    // Completed order but still active — should have been resolved by the reconciler.
    if (qualifying.has(rec.recommendationId)) {
      add('completed-order-still-active', SEV.CRITICAL, rec,
        'Active recommendation has a qualifying paid order — expected resolved Won');
    }
    // Expired / stale (mirrors §9 policy; reported here, applied by the sync pass).
    const ageDays = daysBetween(rec.generatedAt, nowISO);
    const waitingDays = daysBetween(rec.lastStateChangeAt || rec.generatedAt, nowISO);
    const exp = RM.expirationFor(rec, { ageDays, waitingDays, hasNewerActiveOfOtherType: false });
    if (exp) {
      add('expired', SEV.MEDIUM, rec, `${exp.reason} — should be ${exp.state}`, { proposedState: exp.state });
    }
  }

  const summary = violations.reduce((acc, v) => { acc[v.type] = (acc[v.type] || 0) + 1; return acc; }, {});
  return { violations, summary, total: violations.length, scannedAt: nowISO };
}

module.exports = { scanIntegrity, SEV };
