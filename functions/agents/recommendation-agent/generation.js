// recommendation-agent/generation.js — PURE generation decision (Phase 2 rules) +
// single-lead Qualifying Business Event detection + Phase 3 chain building.
// No Firestore/network: fully unit-testable. Single-lead ONLY — never reads clusters,
// never links across leadIds (cross-lead identity is the future Identity Resolution Service).

const RM = require('../_shared/recommendation-model');
const SYNC = require('./sync');

// Tolerant timestamp → ms (handles ISO string, Date, {seconds}, Firestore Timestamp {toDate}).
function _ms(v) {
  if (v == null) return null;
  if (v instanceof Date) return +v;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  if (typeof v.toDate === 'function') { try { return +v.toDate(); } catch (_) { return null; } }
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}
function _iso(v) { const m = _ms(v); return m == null ? null : new Date(m).toISOString(); }

// Resolution time of a terminal record (the gate timestamp T_term).
function resolutionTime(rec) { return _ms(rec.resolvedAt) != null ? _ms(rec.resolvedAt) : _ms(rec.lastStateChangeAt); }

// ── Single-lead Qualifying Business Event detection ──────────────────────────
// SCOPE (v1): the only customer-originated re-engagement signal that lives on the SAME
// lead document is an inbound GMAIL reply (lastReplyAt / emailConversation user-turns).
// Website re-inquiry creates a NEW lead doc (cross-lead → out of scope). WhatsApp has no
// inbound signal yet (deferred). Orders are conversions (reconciler → Won), not QBEs.
// Our own outreach (lastContacted, emails we send) is NEVER a QBE.
// Returns the earliest qualifying event strictly after `afterMs`, or null.
function detectReengagementQBE(lead, afterMs) {
  if (afterMs == null) return null;
  const l = lead || {};
  const cands = [];
  const lr = _ms(l.lastReplyAt);
  if (lr != null && lr > afterMs) cands.push({ type: 'gmail-reply', at: new Date(lr).toISOString(), evidence: 'lead.lastReplyAt' });
  if (Array.isArray(l.emailConversation)) {
    for (const turn of l.emailConversation) {
      if (turn && turn.role === 'user') {
        const tt = _ms(turn.at);
        if (tt != null && tt > afterMs) cands.push({ type: 'gmail-reply', at: new Date(tt).toISOString(), evidence: 'emailConversation.user' });
      }
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => _ms(a.at) - _ms(b.at));
  return cands[0]; // earliest qualifying event after T_term
}

// ── Generation decision (deterministic, single-lead) ─────────────────────────
// recsForChainKey = ALL recommendation records for this (leadId, recommendationType),
// active AND terminal. Returns one of:
//   { action: 'SKIP' | 'BLOCK', reason }
//   { action: 'UPDATE', target }
//   { action: 'GENERATE_FIRST' }
//   { action: 'GENERATE_NEW_CYCLE', qbe }
function decideGeneration({ intel, lead, recsForChainKey, nowISO }) {
  // G1 — Lead Intelligence criteria
  if (!SYNC.isHonest(intel)) return { action: 'SKIP', reason: 'not honest (test/non-primary/suspicious)' };
  if (intel.lifecycleStage === 'Won' || intel.lifecycleStage === 'Lost') return { action: 'SKIP', reason: 'lifecycleStage terminal' };

  const recs = Array.isArray(recsForChainKey) ? recsForChainKey : [];
  const active = recs.filter(r => RM.isActiveState(r.state));
  // G2 — never create when an active rec of this type already exists
  if (active.length) {
    const target = active.slice().sort((a, b) => (_ms(b.lastStateChangeAt || b.generatedAt) || 0) - (_ms(a.lastStateChangeAt || a.generatedAt) || 0))[0];
    return { action: 'UPDATE', target };
  }

  const terminal = recs.filter(r => RM.isTerminalState(r.state));
  // G3(a) — never recommended → first cycle
  if (!terminal.length) return { action: 'GENERATE_FIRST' };

  // G3(b) — terminal exists → require a re-engagement QBE strictly after the LATEST T_term
  const tTermMs = Math.max(...terminal.map(resolutionTime).filter(v => v != null));
  if (!isFinite(tTermMs)) return { action: 'BLOCK', reason: 'terminal without resolvable time' };
  const qbe = detectReengagementQBE(lead, tTermMs);
  if (!qbe) return { action: 'BLOCK', reason: 'terminal, no qualifying business event after T_term' };
  // Idempotency: don't re-mint for a QBE already consumed by an existing cycle.
  const consumed = recs.some(r => r.generatedByEvent && _ms(r.generatedByEvent.at) != null && _ms(r.generatedByEvent.at) >= _ms(qbe.at));
  if (consumed) return { action: 'BLOCK', reason: 'qualifying event already consumed by an existing cycle' };
  return { action: 'GENERATE_NEW_CYCLE', qbe };
}

// ── Phase 3 chain fields (single-lead) ───────────────────────────────────────
// For GENERATE_FIRST: caller sets chainId = the new record's own id (passed back as
// chainId:null here → newRecord fills it). For GENERATE_NEW_CYCLE: inherit chainId,
// cycleSequence = prevMax+1, previousRecommendationId = latest terminal record's id.
function buildChainFields(recsForChainKey, qbe) {
  const recs = Array.isArray(recsForChainKey) ? recsForChainKey : [];
  if (!recs.length) {
    return { chainId: null, cycleSequence: 1, previousRecommendationId: null,
      generatedByEvent: { type: 'scorer-initial', at: null, evidence: 'first cycle' } };
  }
  const maxSeq = Math.max(...recs.map(r => Number(r.cycleSequence) || 1));
  const oldest = recs.slice().sort((a, b) => (_ms(a.generatedAt) || 0) - (_ms(b.generatedAt) || 0))[0];
  const chainId = recs.map(r => r.chainId).find(Boolean) || (oldest && oldest.recommendationId) || null;
  const latestTerminal = recs.filter(r => RM.isTerminalState(r.state))
    .sort((a, b) => (resolutionTime(a) || 0) - (resolutionTime(b) || 0)).slice(-1)[0];
  return {
    chainId,
    cycleSequence: maxSeq + 1,
    previousRecommendationId: latestTerminal ? latestTerminal.recommendationId : null,
    generatedByEvent: qbe ? { type: qbe.type, at: qbe.at, evidence: qbe.evidence } : null,
  };
}

module.exports = { detectReengagementQBE, decideGeneration, buildChainFields, resolutionTime, _ms };
