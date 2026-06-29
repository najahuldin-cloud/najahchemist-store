// Jarvis OS — Intelligent Matching Service (SINGLE SOURCE OF TRUTH for identity). §4
//
// One shared matcher used everywhere an order/contact must be resolved to a lead —
// the reconciler, the integrity monitor, and (later) the dashboard's conversion stat.
// Replaces the email-only matching scattered across the codebase.
//
// Matching priority (highest-confidence first):
//   1. Lead ID        — explicit foreign key on the record
//   2. Customer ID    — explicit stable customer key
//   3. Email          — normalized, exact
//   4. Normalized Phone
//   5. Name + Phone
//   6. Name + Email
//
// Every match returns a CONFIDENCE score and the METHOD used. Ambiguous keys (one
// contact mapping to several leads — e.g. shared email across duplicate leads) are
// penalized so they fall below the auto-resolve threshold and become Review Required.
// The service NEVER silently guesses: below the review floor it returns no match.

const { normEmail, normName, normPhone } = require('./data-quality');

// Tunables. Auto-resolve only at/above AUTO_RESOLVE; between REVIEW_FLOOR and
// AUTO_RESOLVE => Review Required; below REVIEW_FLOOR => no match (ignored).
const THRESHOLDS = { AUTO_RESOLVE: 0.90, REVIEW_FLOOR: 0.50 };

const METHOD_CONFIDENCE = {
  leadId:       1.00,
  customerId:   0.98,
  email:        0.95,
  phone:        0.90,
  'name+phone': 0.80,
  'name+email': 0.80,
};
// Multiplier applied when a key resolves to MORE THAN ONE lead (ambiguous).
const AMBIGUITY_PENALTY = 0.6;

// Deterministic, stable customer identity derivable from any contactable record.
// Email is preferred (more stable than a re-formatted phone); phone is the fallback.
function customerIdFor({ email, phone } = {}) {
  const e = normEmail(email); if (e) return `c:e:${e}`;
  const p = normPhone(phone); if (p) return `c:p:${p}`;
  return null;
}

function nameEmailKey(name, email) {
  const n = normName(name), e = normEmail(email);
  return (n && e) ? `${n}|${e}` : null;
}
function namePhoneKey(name, phone) {
  const n = normName(name), p = normPhone(phone);
  return (n && p) ? `${n}|${p}` : null;
}

// Build a reverse index from lead records: [{ leadId, name, email, phone, customerId? }].
// Each map value is an array of leadIds so ambiguity (shared contact) is detectable.
function buildLeadIndex(records) {
  const idx = {
    byLeadId: new Map(), byCustomerId: new Map(), byEmail: new Map(),
    byPhone: new Map(), byNamePhone: new Map(), byNameEmail: new Map(),
  };
  const push = (map, key, leadId) => {
    if (!key) return;
    const arr = map.get(key) || []; if (!arr.includes(leadId)) arr.push(leadId); map.set(key, arr);
  };
  for (const r of (records || [])) {
    const leadId = r.leadId; if (!leadId) continue;
    const cid = r.customerId || customerIdFor({ email: r.email, phone: r.phone });
    push(idx.byLeadId, leadId, leadId);
    push(idx.byCustomerId, cid, leadId);
    push(idx.byEmail, normEmail(r.email), leadId);
    push(idx.byPhone, normPhone(r.phone), leadId);
    push(idx.byNamePhone, namePhoneKey(r.name, r.phone), leadId);
    push(idx.byNameEmail, nameEmailKey(r.name, r.email), leadId);
  }
  return idx;
}

// Pull the candidate identifiers off an order doc (tolerant of field-name variants).
function orderIdentifiers(order) {
  const o = order || {};
  return {
    leadId:     o.leadId || o.lead_id || null,
    customerId: o.customerId || o.custId || null,
    email:      o.email || o.customerEmail || null,
    phone:      o.customerWhatsApp || o.phone || o.whatsapp || o.wa || null,
    name:       o.client || o.customerName || o.clientName || o.name || null,
  };
}

// Resolve an order to a lead. Returns:
//   { matched, leadId, customerId, confidence, method, ambiguous, ambiguousCount, decision }
// decision ∈ 'auto' | 'review' | 'none'. NEVER throws; missing data → decision 'none'.
function matchOrderToLead(order, index) {
  const ids = orderIdentifiers(order);
  const customerId = ids.customerId || customerIdFor({ email: ids.email, phone: ids.phone });

  const attempts = [
    { method: 'leadId',     key: ids.leadId,                              map: index.byLeadId },
    { method: 'customerId', key: ids.customerId,                          map: index.byCustomerId },
    { method: 'email',      key: normEmail(ids.email),                    map: index.byEmail },
    { method: 'phone',      key: normPhone(ids.phone),                    map: index.byPhone },
    { method: 'name+phone', key: namePhoneKey(ids.name, ids.phone),       map: index.byNamePhone },
    { method: 'name+email', key: nameEmailKey(ids.name, ids.email),       map: index.byNameEmail },
  ];

  for (const a of attempts) {
    if (!a.key) continue;
    const hits = a.map.get(a.key);
    if (!hits || !hits.length) continue;
    const ambiguous = hits.length > 1;
    let confidence = METHOD_CONFIDENCE[a.method];
    if (ambiguous) confidence = Math.round(confidence * AMBIGUITY_PENALTY * 100) / 100;
    return {
      matched: true,
      leadId: ambiguous ? null : hits[0],   // ambiguous never auto-binds a single lead
      candidates: hits.slice(),
      customerId,
      confidence,
      method: a.method,
      ambiguous,
      ambiguousCount: hits.length,
      decision: decisionFor(confidence),
    };
  }
  return { matched: false, leadId: null, customerId, confidence: 0, method: null, ambiguous: false, ambiguousCount: 0, decision: 'none' };
}

function decisionFor(confidence) {
  if (confidence >= THRESHOLDS.AUTO_RESOLVE) return 'auto';
  if (confidence >= THRESHOLDS.REVIEW_FLOOR) return 'review';
  return 'none';
}

module.exports = {
  THRESHOLDS, METHOD_CONFIDENCE, AMBIGUITY_PENALTY,
  customerIdFor, buildLeadIndex, orderIdentifiers, matchOrderToLead, decisionFor,
  nameEmailKey, namePhoneKey,
};
