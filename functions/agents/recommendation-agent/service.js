// recommendation-agent/service.js — orchestration logic (plain helpers, NOT Cloud
// Functions). index.js wraps these as deployable triggers; functions/index.js imports
// reconcileForOrder() from here for the onOrderCreated hook. Kept separate from index.js
// so the agents barrel never scans a non-trigger export as a deployable function.
//
// recommendation-agent — owns the canonical `recommendations` collection and the
// Recommendation Integrity + Automatic Order Reconciliation services (Phases A–D).
//
// Constitution compliance:
//   • Permission-gated  — every write asserts an explicit permission (no "*").
//   • Kill-switchable    — short-circuits if agent_controls disables it.
//   • Audit-logged       — every state transition / resolution writes jarvis_audit_logs.
//   • Idempotent         — safe to re-run; reuses permanent IDs, dedupes outcomes.
//   • Simulate-first      — RECONCILE_LIVE_ENABLED=false ⇒ the reconciler only writes
//                          PROPOSALS + audit; it never auto-marks Won until validated.
//   • Never overwrites historical outcomes — resolution skips already-terminal recs
//     and never writes a second converted jarvis_outcomes row for the same rec.
//
// Owned collections: recommendations, recommendation_resolution_proposals,
// recommendation_integrity_reports. Resolution ALSO writes the existing jarvis_outcomes
// ledger (when live) so the dashboard's learning/pending surfaces stay continuous.

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const RM = require('../_shared/recommendation-model');
const ID = require('../_shared/identity');
const SYNC = require('./sync');
const GEN = require('./generation');
const REC = require('./reconcile');
const INTEG = require('./integrity');
const { assertPermission } = require('../_shared/permissions');
const { isKilled } = require('../_shared/killswitch');
const { logAction } = require('../_shared/audit');

const AGENT = 'recommendation-agent';
const ADMIN_EMAIL = 'start@najahchemist.com';
const TZ = 'America/Jamaica';

// ── Deploy gates ──────────────────────────────────────────────────────────────
// Sync writes are additive (a NEW collection the dashboard does not read yet), so
// they are safe to enable on first deploy. Reconciliation auto-Won mutates the
// revenue ledger, so it ships in SHADOW until validated on real data.
const SYNC_WRITE_ENABLED = true;
const RECONCILE_LIVE_ENABLED = false;   // ← flip to true only after validating proposals

const CHUNK = 400;

// ── Minimal order lifecycle (kept consistent with the dashboard/Phase 4.3) ──────
const ORDER_CLOSED = ['cancelled', 'abandoned', 'refunded'];
const orderHelpers = {
  isPaid(o) {
    const ps = (o.paymentStatus || o.payStatus || o.payment || '').toString().trim().toLowerCase();
    const st = (o.status || '').toString().trim().toLowerCase();
    if (ORDER_CLOSED.includes(ps) || ORDER_CLOSED.includes(st)) return false;
    return ps === 'paid';
  },
  orderDate(o) {
    const ca = o.createdAt;
    if (ca) {
      if (ca.toDate) return ca.toDate();
      if (ca.seconds) return new Date(ca.seconds * 1000);
      if (typeof ca === 'number') return new Date(ca);
      if (typeof ca === 'string') { const d = new Date(ca); if (!isNaN(d)) return d; }
    }
    if (typeof o.date === 'string' && o.date) { const d = new Date(o.date); if (!isNaN(d)) return d; }
    return null;
  },
  orderTotal(o) { return parseFloat(o.total) || 0; },
  orderId(o) { return (o.id || o.orderId || o.dbId || '').toString(); },
};

function nowISO() { return new Date().toISOString(); }
function chunked(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

async function loadAll(db, name, idField) {
  const snap = await db.collection(name).get();
  return snap.docs.map(d => ({ ...d.data(), [idField || '_docId']: d.id }));
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE A — persist-at-generation: materialize canonical recommendations.
// ════════════════════════════════════════════════════════════════════════════
// CONCURRENCY MECHANISM (Phase 4 L1/L2): new records use a DETERMINISTIC id per
// (leadId, type, cycleSequence) and are written with Firestore `create()` (create-if-absent).
// Two schedulers racing on the same lead compute the SAME id → the loser's create rejects
// with ALREADY_EXISTS and is a safe no-op → exactly one record. Each record is a single
// atomic document write (id + state + chain + initial history), so a failure leaves no
// partial state. The regeneration defect is fixed by GEN.decideGeneration: a terminal
// record without a qualifying business event yields BLOCK (no create).
async function syncRecommendations(db, { write }) {
  if (await isKilled(AGENT)) return { killed: true };
  const __start = Date.now();

  const intel = await loadAll(db, 'lead_intelligence', 'leadId');
  const leads = await loadAll(db, 'leads', '_docId');
  const recs  = await loadAll(db, 'recommendations', 'recommendationId');
  const leadById = new Map(leads.map(l => [l._docId, l]));

  // Index ALL recs (active AND terminal) by chain key (leadId::type) — the decision must
  // see terminal records to enforce the terminal gate. Also collect active recs per lead.
  const recsByChainKey = new Map();
  const activeByLead = new Map();
  for (const r of recs) {
    const k = RM.openCycleKey(r.leadId, r.recommendationType);
    const a = recsByChainKey.get(k) || []; a.push(r); recsByChainKey.set(k, a);
    if (RM.isActiveState(r.state)) { const b = activeByLead.get(r.leadId) || []; b.push(r); activeByLead.set(r.leadId, b); }
  }

  const ts = nowISO();
  const creates = [], updates = [], transitions = [];
  const reasons = { skip: 0, block: 0, update: 0, generateFirst: 0, generateNewCycle: 0 };

  for (const i of intel) {
    const lead = leadById.get(i.leadId) || {};
    const t = RM.recType(i);
    const key = RM.openCycleKey(i.leadId, t.key);
    const recsForKey = recsByChainKey.get(key) || [];
    const decision = GEN.decideGeneration({ intel: i, lead, recsForChainKey: recsForKey, nowISO: ts });
    if (decision.action === 'SKIP')  { reasons.skip++; continue; }
    if (decision.action === 'BLOCK') { reasons.block++; continue; }
    if (decision.action === 'UPDATE') {
      reasons.update++;
      updates.push({ id: decision.target.recommendationId, patch: SYNC.refreshedDerived(decision.target, i, lead, ts) });
      continue;
    }
    // GENERATE_FIRST or GENERATE_NEW_CYCLE
    const chain = GEN.buildChainFields(recsForKey, decision.qbe);
    const rec = SYNC.newRecord(i, lead, ts, chain);
    creates.push(rec);
    if (decision.action === 'GENERATE_FIRST') reasons.generateFirst++; else reasons.generateNewCycle++;
  }

  // §9 Supersession + Expiration over active recs (unchanged; never re-mints).
  const currentTypeByLead = new Map();
  for (const i of intel) if (SYNC.isGeneratable(i)) currentTypeByLead.set(i.leadId, RM.recType(i).key);
  for (const [leadId, arr] of activeByLead) {
    const currentType = currentTypeByLead.get(leadId) || null;
    const hasNewerOfOtherType = arr.some(r => r.recommendationType === currentType);
    for (const r of arr) {
      const ageDays = daysSince(r.generatedAt, ts);
      const waitingDays = daysSince(r.lastStateChangeAt || r.generatedAt, ts);
      const otherType = currentType && r.recommendationType !== currentType && hasNewerOfOtherType;
      const exp = RM.expirationFor(r, { ageDays, waitingDays, hasNewerActiveOfOtherType: otherType });
      if (exp && RM.canTransition(r.state, exp.state)) {
        transitions.push({ id: r.recommendationId, from: r.state, to: exp.state, reason: exp.reason, at: ts });
      }
    }
  }

  if (!write) {
    return { dryRun: true, wouldCreate: creates.length, wouldUpdate: updates.length, wouldTransition: transitions.length, decisions: reasons };
  }

  assertPermission(AGENT, 'write:recommendations');
  // Create-if-absent (concurrency-safe + atomic single-doc write). A create that fails for
  // a reason OTHER than ALREADY_EXISTS is counted as a generation error and skipped — one
  // bad document never aborts the whole sync.
  let created = 0, concurrencySkipped = 0, generationErrors = 0;
  for (const rec of creates) {
    try {
      await db.collection('recommendations').doc(rec.recommendationId).create({ ...rec, lastScoredAt: FieldValue.serverTimestamp() });
      created++;
    } catch (e) {
      if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) { concurrencySkipped++; }
      else { generationErrors++; console.error(`[${AGENT}] create failed ${rec.recommendationId}:`, e && e.message); }
    }
  }
  for (const group of chunked(updates, CHUNK)) {
    const batch = db.batch();
    for (const u of group) batch.set(db.collection('recommendations').doc(u.id), u.patch, { merge: true });
    await batch.commit();
  }
  for (const tr of transitions) {
    await applyTransition(db, tr.id, tr.to, tr.reason, AGENT, { actor: 'system', source: 'sync' });
  }

  // ── Recommendation Generation Metrics (daily observability) ──
  const metrics = {
    generated: created,                       // recommendations actually created
    updated: updates.length,                  // recommendations refreshed
    newChains: reasons.generateFirst,         // first-cycle creates (new chains)
    newCycles: reasons.generateNewCycle,      // re-engagement cycles
    suppressedG2: reasons.update,             // not created — active rec exists (G2)
    suppressedG3: reasons.block,              // not created — terminal, no qualifying event (G3)
    qbesDetected: reasons.generateNewCycle,   // qualifying events that drove a new cycle
    duplicatePreventionCount: concurrencySkipped, // create-if-absent no-ops (concurrency)
    generationErrors,
    transitions: transitions.length,
    generationDurationMs: Date.now() - __start,
  };
  metrics.health = generationHealth(metrics);   // derived summary (Green/Yellow/Red + reasons)
  await logAction({ agent: AGENT, action: 'syncRecommendations', after: metrics, level: 1, actor: 'scheduler' });
  return metrics;
}

function daysSince(iso, nowIso) {
  if (!iso) return null;
  const a = new Date(iso), b = new Date(nowIso);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

// Canonical event-type label for a target state (used by Replay/Time Machine).
const EVENT_TYPE_BY_STATE = {
  [RM.STATE.GENERATED]: 'generated', [RM.STATE.WAITING_FOR_FOUNDER]: 'surfaced',
  [RM.STATE.AUTOMATION_RUNNING]: 'automation', [RM.STATE.WAITING_FOR_CUSTOMER]: 'actioned',
  [RM.STATE.CUSTOMER_RESPONDED]: 'customer-responded', [RM.STATE.WON]: 'resolved-won',
  [RM.STATE.LOST]: 'resolved-lost', [RM.STATE.SNOOZED]: 'snoozed', [RM.STATE.EXPIRED]: 'expired',
  [RM.STATE.SUPERSEDED]: 'superseded', [RM.STATE.ARCHIVED]: 'archived',
};
function defaultEventType(toState) { return EVENT_TYPE_BY_STATE[toState] || 'transition'; }

// Derived single-run generation health (NO new logic — summarizes the metrics already
// collected, so the Command Center / logs are scannable at a glance). Red on any
// generation error; Yellow on a slow run; Green otherwise. Cross-run trends (e.g.
// suppressedG3 dropping to 0 while terminals still occur) are an Observation/Watchdog
// concern, not a single-run signal.
function generationHealth(m) {
  const status = m.generationErrors > 0 ? 'red' : (m.generationDurationMs > 120000 ? 'yellow' : 'green');
  return {
    status,
    reasons: [
      `Generation Errors: ${m.generationErrors}`,
      `Duplicate Prevention: ${m.duplicatePreventionCount}`,
      `G3 Suppressions: ${m.suppressedG3}`,
      `New Cycles: ${m.newCycles}`,
      `Runtime: ${m.generationDurationMs} ms`,
    ],
  };
}

// Apply + audit a single canonical state transition (append to history). Never illegal.
async function applyTransition(db, recId, toState, reason, actor, extra) {
  const ref = db.collection('recommendations').doc(recId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const rec = snap.data();
  if (!RM.canTransition(rec.state, toState)) {
    console.warn(`[${AGENT}] illegal transition ${rec.state} → ${toState} for ${recId} — skipped`);
    return false;
  }
  const ts = nowISO();
  // Self-describing event entry (Replay Mode / Time Machine read these directly).
  const entry = {
    at: ts, from: rec.state, to: toState, reason: reason || null,
    actor: (extra && extra.actor) || actor,
    eventType: (extra && extra.eventType) || defaultEventType(toState),
    source: (extra && extra.source) || 'recommendation-agent',
    data: (extra && extra.data) || null,
  };
  assertPermission(AGENT, 'write:recommendations');
  await ref.set({
    state: toState, stateReason: reason || null, lastStateChangeAt: ts,
    history: FieldValue.arrayUnion(entry),
    ...((extra && extra.patch) || {}),
  }, { merge: true });
  await logAction({ agent: AGENT, action: 'recommendationTransition', leadId: rec.leadId, before: { state: rec.state }, after: { state: toState, reason }, level: 1, actor: (extra && extra.actor) || actor });
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE C — automatic order reconciliation (shadow unless RECONCILE_LIVE_ENABLED).
// ════════════════════════════════════════════════════════════════════════════
async function reconcileOnce(db, { live, onlyOrderId }) {
  if (await isKilled(AGENT)) return { killed: true };

  const leads = await loadAll(db, 'leads', '_docId');
  const recs  = (await loadAll(db, 'recommendations', 'recommendationId')).filter(r => RM.isActiveState(r.state));
  let orders  = await loadAll(db, 'orders', 'dbId');
  if (onlyOrderId) orders = orders.filter(o => o.dbId === onlyOrderId || orderHelpers.orderId(o) === onlyOrderId);

  const leadIndex = ID.buildLeadIndex(leads.map(l => ({ leadId: l._docId, name: l.name, email: l.email, phone: l.whatsapp })));
  const { resolutions, reviews } = REC.planResolutions({ recs, orders, leadIndex, helpers: orderHelpers, nowISO: nowISO() });

  // Existing converted outcomes by recommendationId — idempotency guard.
  const outcomes = await loadAll(db, 'jarvis_outcomes', 'id');
  const resolvedRecIds = new Set(outcomes.filter(o => o.status === 'converted' && o.recommendationId).map(o => o.recommendationId));

  let won = 0, proposed = 0, reviewed = 0, skipped = 0;

  for (const r of resolutions) {
    if (resolvedRecIds.has(r.recommendationId)) { skipped++; continue; }
    // Always record the proposal (audit trail of what the reconciler saw).
    await writeProposal(db, r, live ? 'applied' : 'shadow');
    proposed++;
    if (live) {
      await applyAutoWon(db, r);
      won++;
    }
  }
  for (const rv of reviews) {
    if (resolvedRecIds.has(rv.recommendationId)) { skipped++; continue; }
    await writeProposal(db, rv, 'review');
    reviewed++;
    if (live) {
      // Flag the rec for human review without changing its single canonical state.
      assertPermission(AGENT, 'write:recommendations');
      await db.collection('recommendations').doc(rv.recommendationId).set({
        reviewRequired: true, reviewReason: rv.reason, reviewCandidates: rv.candidates || [], reviewedAt: nowISO(),
      }, { merge: true });
    }
  }

  await logAction({ agent: AGENT, action: live ? 'reconcileOrders(live)' : 'reconcileOrders(shadow)', after: { won, proposed, reviewed, skipped }, level: live ? 2 : 1, actor: 'scheduler' });
  return { live: !!live, won, proposed, reviewed, skipped, candidates: resolutions.length + reviews.length };
}

async function writeProposal(db, plan, mode) {
  assertPermission(AGENT, 'write:recommendation_resolution_proposals');
  await db.collection('recommendation_resolution_proposals').doc(plan.recommendationId).set({
    ...plan, mode, writtenAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

// LIVE auto-Won: resolve the canonical rec, write the jarvis_outcomes ledger row for
// dashboard/learning continuity, link them, then archive. Idempotent + audited.
async function applyAutoWon(db, r) {
  const expected = Number(r.expectedRevenue) || 0;
  const actual = Number(r.actualRevenue) || 0;
  const variance = actual - expected;
  const accuracyScore = expected > 0 ? Math.max(0, Math.round((1 - Math.abs(variance) / expected) * 100)) : null;
  const ts = nowISO();

  // 1) jarvis_outcomes ledger (continuity with the existing learning engine).
  assertPermission(AGENT, 'write:jarvis_outcomes');
  const outcome = {
    opportunityType: r.recommendationType ? ('Lead — ' + r.recommendationType) : 'Lead',
    leadId: r.leadId, customerId: r.customerId || null,
    recommendationId: r.recommendationId, recommendationType: r.recommendationType,
    expectedRevenue: expected, actualRevenue: actual, revenueVariance: variance, accuracyScore,
    status: 'converted', outcome: 'won', executionStatus: 'resolved',
    source: 'auto-order-match', resolvedBy: 'recommendation-agent',
    orderId: r.orderId, matchMethod: r.matchMethod, matchConfidence: r.matchConfidence,
    recommendedAt: r.orderDate ? r.orderDate.slice(0, 10) : ts.slice(0, 10),
    actionedAt: ts, resolvedAt: ts.slice(0, 10),
  };
  const ref = await db.collection('jarvis_outcomes').add(outcome);

  // 2) Canonical rec → Won (with resolution evidence) → Archived.
  await applyTransition(db, r.recommendationId, RM.STATE.WON,
    `Auto-resolved from order ${r.orderId} (match ${r.matchMethod} @ ${r.matchConfidence})`,
    AGENT,
    { actor: 'recommendation-agent', source: 'reconciler', eventType: 'resolved-won',
      data: { orderId: r.orderId, actualRevenue: actual, revenueVariance: variance, matchMethod: r.matchMethod, matchConfidence: r.matchConfidence },
      patch: {
        orderId: r.orderId, actualRevenue: actual, revenueVariance: variance,
        resolvedAt: ts, resolvedBy: 'auto-order-match', matchMethod: r.matchMethod,
        matchConfidence: r.matchConfidence, outcomeId: ref.id,
      } });
  await applyTransition(db, r.recommendationId, RM.STATE.ARCHIVED, 'Resolved — moved to history', AGENT, { actor: 'recommendation-agent', source: 'reconciler' });
}

// Called from functions/index.js onOrderCreated (additive hook). Never throws upward.
async function reconcileForOrder(orderId) {
  try {
    const db = getFirestore();
    return await reconcileOnce(db, { live: RECONCILE_LIVE_ENABLED, onlyOrderId: orderId });
  } catch (e) {
    console.error(`[${AGENT}] reconcileForOrder(${orderId}) failed:`, e.message);
    return { error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE D — integrity monitor.
// ════════════════════════════════════════════════════════════════════════════
async function integrityScan(db) {
  if (await isKilled(AGENT)) return { killed: true };
  const recs = await loadAll(db, 'recommendations', 'recommendationId');
  const leads = await loadAll(db, 'leads', '_docId');
  const orders = await loadAll(db, 'orders', 'dbId');
  const knownLeadIds = new Set(leads.map(l => l._docId));

  // Which active recs have a qualifying paid order (should be resolved)?
  const leadIndex = ID.buildLeadIndex(leads.map(l => ({ leadId: l._docId, name: l.name, email: l.email, phone: l.whatsapp })));
  const { resolutions, reviews } = REC.planResolutions({ recs: recs.filter(r => RM.isActiveState(r.state)), orders, leadIndex, helpers: orderHelpers, nowISO: nowISO() });
  const qualifyingRecIds = new Set([...resolutions, ...reviews].map(p => p.recommendationId));

  const report = INTEG.scanIntegrity({ recs, knownLeadIds, qualifyingRecIds, nowISO: nowISO() });

  assertPermission(AGENT, 'write:recommendation_integrity_reports');
  await db.collection('recommendation_integrity_reports').add({ ...report, createdAt: FieldValue.serverTimestamp() });
  await logAction({ agent: AGENT, action: 'recommendationIntegrityScan', after: { total: report.total, summary: report.summary }, level: 1, actor: 'scheduler' });
  return report;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE E — one-time migration backfill. Reconstructs canonical recommendation
// records from CURRENT lead_intelligence + jarvis_outcomes so the dashboard read-model
// mirrors today's state at cutover. Idempotent (skips any (lead,type) that already has
// a record) and dry-run by default.
// ════════════════════════════════════════════════════════════════════════════
// Dominant outcome per lead — converted/lost beats pending; newest wins within a tier.
function buildOutcomeIndexByLead(outcomes) {
  const rank = s => s === 'converted' ? 3 : s === 'lost' ? 2 : s === 'pending' ? 1 : 0;
  const m = new Map();
  for (const o of (outcomes || [])) {
    if (!o || !o.leadId || o.status === 'skipped') continue;
    const cur = m.get(o.leadId);
    if (!cur) { m.set(o.leadId, o); continue; }
    const ro = rank(o.status), rc = rank(cur.status);
    const ta = o.resolvedAt || o.actionedAt || o.recommendedAt || '';
    const tb = cur.resolvedAt || cur.actionedAt || cur.recommendedAt || '';
    if (ro > rc || (ro === rc && ta > tb)) m.set(o.leadId, o);
  }
  return m;
}

async function backfillRecommendations(db, { write }) {
  if (await isKilled(AGENT)) return { killed: true };

  const intel = await loadAll(db, 'lead_intelligence', 'leadId');
  const leads = await loadAll(db, 'leads', '_docId');
  const outcomes = await loadAll(db, 'jarvis_outcomes', 'id');
  const recs = await loadAll(db, 'recommendations', 'recommendationId');
  const leadById = new Map(leads.map(l => [l._docId, l]));
  const ocByLead = buildOutcomeIndexByLead(outcomes);

  // Existing (lead,type) coverage — skip these to stay idempotent.
  const covered = new Set(recs.map(r => RM.openCycleKey(r.leadId, r.recommendationType)));

  const ts = nowISO();
  const toWrite = [];
  const counts = { generated: 0, waiting: 0, won: 0, lost: 0, skipped: 0 };

  for (const i of intel) {
    if (!SYNC.isHonest(i)) continue;
    const t = RM.recType(i);
    const cycle = RM.openCycleKey(i.leadId, t.key);
    if (covered.has(cycle)) { counts.skipped++; continue; }
    const lead = leadById.get(i.leadId) || {};
    const oc = ocByLead.get(i.leadId);

    // Base record (mints a permanent ID + frozen generatedAt + read-model fields).
    const rec = SYNC.newRecord(i, lead, ts);
    // Reuse the ledger's recommendationId when present so record + ledger share an ID.
    if (oc && RM.isValidRecommendationId(oc.recommendationId)) rec.recommendationId = oc.recommendationId;

    if (oc && oc.status === 'converted') {
      const actual = Number(oc.actualRevenue) || 0, expected = Number(oc.expectedRevenue) || rec.expectedRevenue || 0;
      Object.assign(rec, {
        state: RM.STATE.WON, stateReason: 'Backfilled from resolved outcome',
        orderId: oc.orderId || null, outcomeId: oc.id, actualRevenue: actual,
        expectedRevenue: expected, revenueVariance: actual - expected,
        resolvedAt: oc.resolvedAt || ts, resolvedBy: oc.source || 'backfill',
        lastStateChangeAt: oc.resolvedAt || ts,
        history: [{ at: oc.resolvedAt || ts, from: null, to: RM.STATE.WON, reason: 'Backfilled (won)', actor: 'backfill', eventType: 'resolved-won', source: 'backfill', data: { orderId: oc.orderId || null, actualRevenue: actual } }],
      });
      counts.won++;
    } else if (oc && oc.status === 'lost') {
      Object.assign(rec, {
        state: RM.STATE.LOST, stateReason: 'Backfilled from resolved outcome',
        outcomeId: oc.id, actualRevenue: 0, resolvedAt: oc.resolvedAt || ts, resolvedBy: oc.source || 'backfill',
        lastStateChangeAt: oc.resolvedAt || ts,
        history: [{ at: oc.resolvedAt || ts, from: null, to: RM.STATE.LOST, reason: 'Backfilled (lost)', actor: 'backfill', eventType: 'resolved-lost', source: 'backfill', data: null }],
      });
      counts.lost++;
    } else if (oc && oc.status === 'pending') {
      const actionedAt = oc.actionedAt || ts;
      Object.assign(rec, {
        state: RM.STATE.WAITING_FOR_CUSTOMER, stateReason: 'Backfilled — actioned, awaiting customer',
        outcomeId: oc.id, lastStateChangeAt: actionedAt,
        history: [
          { at: rec.generatedAt, from: null, to: RM.STATE.GENERATED, reason: 'Backfilled', actor: 'backfill', eventType: 'generated', source: 'backfill', data: null },
          { at: actionedAt, from: RM.STATE.GENERATED, to: RM.STATE.WAITING_FOR_CUSTOMER, reason: 'Backfilled (actioned)', actor: 'backfill', eventType: 'actioned', source: 'backfill', data: { channel: rec.recommendedChannel || null } },
        ],
      });
      counts.waiting++;
    } else {
      if (!SYNC.isGeneratable(i)) { counts.skipped++; continue; } // Won/Lost stage, no outcome → don't guess
      counts.generated++;
    }
    toWrite.push(rec);
    covered.add(cycle);
  }

  if (!write) return { dryRun: true, wouldWrite: toWrite.length, ...counts };

  assertPermission(AGENT, 'write:recommendations');
  for (const group of chunked(toWrite, CHUNK)) {
    const batch = db.batch();
    for (const rec of group) batch.set(db.collection('recommendations').doc(rec.recommendationId), { ...rec, backfilledAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
  }
  await logAction({ agent: AGENT, action: 'backfillRecommendations', after: { written: toWrite.length, ...counts }, level: 1, actor: 'admin' });
  return { written: toWrite.length, ...counts };
}

// ════════════════════════════════════════════════════════════════════════════
// Exports — plain helpers only (index.js wraps these as Cloud Functions).
// ════════════════════════════════════════════════════════════════════════════
module.exports = {
  AGENT, TZ, ADMIN_EMAIL, SYNC_WRITE_ENABLED, RECONCILE_LIVE_ENABLED,
  syncRecommendations, reconcileOnce, integrityScan, reconcileForOrder,
  backfillRecommendations, applyTransition, orderHelpers, generationHealth,
};
