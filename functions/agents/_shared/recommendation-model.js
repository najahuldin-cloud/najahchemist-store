// Jarvis OS — Recommendation identity + canonical lifecycle model (SINGLE SOURCE OF TRUTH).
//
// This module is PURE (no Firestore, no network) so it is fully unit-testable and
// can be shared by the recommendation-agent, the reconciler, the integrity monitor,
// and (later) the dashboard read-model.
//
// It owns four concerns that the rest of the integrity phase builds on:
//   §3 Recommendation Identity  — permanent, never-regenerated Recommendation IDs.
//   §5 Unified Lifecycle        — exactly one canonical `state` per recommendation.
//   §9 Expiration               — when an active recommendation must leave the queues.
//   §2 Qualifying order rule    — the founder-approved "paid + dated-after" predicate.
//
// Type codes (tc) are kept identical to the dashboard's derived recTypeFor() so a
// recommendation carries the SAME human-readable ID on every screen (§3).

const crypto = require('crypto');

// ── §5 Canonical states ──────────────────────────────────────────────────────
// A recommendation is ALWAYS in exactly one of these. The first five are "active"
// (they may appear in a work queue); the rest are terminal/parked.
const STATE = {
  GENERATED:           'Generated',            // materialized by the scorer, not yet seen/acted
  WAITING_FOR_FOUNDER: 'WaitingForFounder',    // surfaced; awaiting a founder decision
  AUTOMATION_RUNNING:  'AutomationRunning',    // an automated step is mid-flight
  WAITING_FOR_CUSTOMER:'WaitingForCustomer',   // outreach done; awaiting a customer reply/order
  CUSTOMER_RESPONDED:  'CustomerResponded',    // customer replied — founder/automation must act
  WON:                 'Won',                  // resolved — order/conversion (manual or auto)
  LOST:                'Lost',                  // resolved — explicitly lost
  SNOOZED:             'Snoozed',              // intentionally parked until snoozeUntil
  EXPIRED:             'Expired',              // aged out of active work (§9)
  SUPERSEDED:          'Superseded',           // replaced by a newer recommendation (§9)
  ARCHIVED:            'Archived',             // moved to history after a terminal state
};

// States that may surface in Today's Top Actions / Founder Focus / Pending Outcomes.
// SNOOZED is active-but-hidden (it returns to WAITING_* when the snooze expires).
const ACTIVE_STATES = [
  STATE.GENERATED, STATE.WAITING_FOR_FOUNDER, STATE.AUTOMATION_RUNNING,
  STATE.WAITING_FOR_CUSTOMER, STATE.CUSTOMER_RESPONDED,
];
const TERMINAL_STATES = [STATE.WON, STATE.LOST, STATE.EXPIRED, STATE.SUPERSEDED, STATE.ARCHIVED];

function isActiveState(s)   { return ACTIVE_STATES.includes(s); }
function isTerminalState(s) { return TERMINAL_STATES.includes(s); }

// Allowed transitions — enforced by the agent so nothing changes state silently or
// illegally (§1 "nothing should disappear without explanation"). Every applied
// transition is expected to be accompanied by a `reason` + an audit log entry.
const TRANSITIONS = {
  [STATE.GENERATED]:            [STATE.WAITING_FOR_FOUNDER, STATE.AUTOMATION_RUNNING, STATE.WON, STATE.LOST, STATE.SNOOZED, STATE.EXPIRED, STATE.SUPERSEDED],
  [STATE.WAITING_FOR_FOUNDER]:  [STATE.AUTOMATION_RUNNING, STATE.WAITING_FOR_CUSTOMER, STATE.WON, STATE.LOST, STATE.SNOOZED, STATE.EXPIRED, STATE.SUPERSEDED],
  [STATE.AUTOMATION_RUNNING]:   [STATE.WAITING_FOR_CUSTOMER, STATE.WON, STATE.LOST, STATE.EXPIRED, STATE.SUPERSEDED],
  [STATE.WAITING_FOR_CUSTOMER]: [STATE.CUSTOMER_RESPONDED, STATE.WON, STATE.LOST, STATE.SNOOZED, STATE.EXPIRED, STATE.SUPERSEDED],
  [STATE.CUSTOMER_RESPONDED]:   [STATE.WAITING_FOR_FOUNDER, STATE.AUTOMATION_RUNNING, STATE.WON, STATE.LOST, STATE.SNOOZED, STATE.SUPERSEDED],
  [STATE.SNOOZED]:              [STATE.WAITING_FOR_FOUNDER, STATE.WAITING_FOR_CUSTOMER, STATE.WON, STATE.LOST, STATE.EXPIRED, STATE.SUPERSEDED],
  [STATE.WON]:                  [STATE.ARCHIVED],
  [STATE.LOST]:                 [STATE.ARCHIVED],
  [STATE.EXPIRED]:              [STATE.ARCHIVED, STATE.SUPERSEDED],
  [STATE.SUPERSEDED]:           [STATE.ARCHIVED],
  [STATE.ARCHIVED]:             [],
};

function canTransition(from, to) {
  if (from === to) return true; // idempotent re-write of the same state is allowed
  return (TRANSITIONS[from] || []).includes(to);
}

// ── §3 Recommendation type codes (mirror dashboard recTypeFor) ────────────────
// Returns { key, label, tc, channel } from an intel doc. `tc` becomes part of the
// permanent ID; `key` is the learning-engine grouping key (matches jarvis_outcomes
// recommendationType written by Phase 4.7), so learning stays continuous.
function recType(intel) {
  const i = intel || {};
  const channel = i.preferredChannel || 'whatsapp';
  if (i.recommendedOffer === 'Manufacturing' && i.opportunitySource === 'newlead') {
    return { key: 'moq-quote', label: 'MOQ Quote', tc: 'MQ', channel: 'whatsapp' };
  }
  if (i.opportunitySource === 'overdue')                              return { key: 'followup-overdue', label: 'Overdue Follow-up',  tc: 'FO', channel };
  if (i.opportunitySource === 'hot')                                  return { key: 'hot-followup',     label: 'Hot-Lead Follow-up', tc: 'HF', channel };
  if (i.opportunitySource === 'dormant' || i.opportunitySource === 'lost') return { key: 'reactivation', label: 'Reactivation',  tc: 'RA', channel };
  return channel === 'email'
    ? { key: 'email-followup', label: 'Email Follow-up',    tc: 'EM', channel: 'email' }
    : { key: 'wa-followup',    label: 'WhatsApp Follow-up', tc: 'WA', channel: 'whatsapp' };
}

// ── §3 Permanent Recommendation IDs ───────────────────────────────────────────
// Format: REC-<LEAD6>-<YYYYMMDD>-<TC>-<RAND4>
//   LEAD6  first 6 chars of the leadId (display continuity with Phase 4.7)
//   DATE   the date the recommendation was FIRST generated (frozen forever)
//   TC     type code (MQ/FO/HF/RA/EM/WA)
//   RAND4  base36 entropy so two cycles of the same type on the same day never collide
// The ID is PERMANENT: the agent reuses the existing open record's ID rather than
// recomputing one, so a recommendation's ID never changes across rescores.
function ymd(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
function newRecommendationId(leadId, tc, createdAt) {
  const lead6 = String(leadId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase().padEnd(6, '0');
  const rand4 = crypto.randomBytes(3).toString('hex').slice(0, 4).toUpperCase();
  return `REC-${lead6}-${ymd(createdAt || Date.now())}-${tc || 'WA'}-${rand4}`;
}
const REC_ID_RE = /^REC-[A-Z0-9]{6}-\d{8}-(MQ|FO|HF|RA|EM|WA)-[A-Z0-9]{4}$/;
function isValidRecommendationId(id) { return typeof id === 'string' && REC_ID_RE.test(id); }

// Stable per-(lead,type) key used to dedupe within a sync run and to find "the open
// recommendation of this type for this lead". NOT the ID — the ID is permanent and
// per-cycle; this key groups cycles so we know when to reuse vs. create.
function openCycleKey(leadId, typeKey) { return `${leadId}::${typeKey}`; }

// ── §9 Expiration / supersession policy ───────────────────────────────────────
const EXPIRY = {
  // An active rec with no founder action older than this expires out of the queues.
  ACTIVE_NO_ACTION_DAYS: 30,
  // A WaitingForCustomer rec with no response older than this expires (separate from
  // the 3-day "overdue" *display* flag the dashboard already uses — overdue ≠ expired).
  WAITING_CUSTOMER_DAYS: 21,
};

// Decide whether an open recommendation should auto-leave the active queues (§9).
// Pure: caller passes the rec, the comparable ages (days), and whether a newer rec of
// a different type now exists for the same lead. Returns null or { state, reason }.
function expirationFor(rec, { ageDays, waitingDays, hasNewerActiveOfOtherType }) {
  if (!rec || isTerminalState(rec.state)) return null;
  if (hasNewerActiveOfOtherType && (rec.state === STATE.GENERATED || rec.state === STATE.WAITING_FOR_FOUNDER)) {
    return { state: STATE.SUPERSEDED, reason: 'Replaced by a newer recommendation for this customer' };
  }
  if (rec.state === STATE.WAITING_FOR_CUSTOMER && waitingDays != null && waitingDays >= EXPIRY.WAITING_CUSTOMER_DAYS) {
    return { state: STATE.EXPIRED, reason: `No customer response in ${waitingDays} days` };
  }
  if ((rec.state === STATE.GENERATED || rec.state === STATE.WAITING_FOR_FOUNDER) && ageDays != null && ageDays >= EXPIRY.ACTIVE_NO_ACTION_DAYS) {
    return { state: STATE.EXPIRED, reason: `No action taken in ${ageDays} days` };
  }
  return null;
}

// ── §2 Qualifying-order rule (founder-approved: PAID + dated on/after the rec) ──
// Pure: caller resolves paid-ness and dates and passes primitives.
//   paid       — boolean, the order is in a paid/success lifecycle
//   orderDate  — Date|null, when the order was placed (createdAt)
//   recBaseline— Date|null, the recommendation's generatedAt (or lead's baseline)
// An order qualifies only if it is paid AND placed on/after the recommendation began,
// so an OLD purchase can never auto-win a brand-new inquiry from a returning customer.
function isQualifyingOrder({ paid, orderDate, recBaseline }) {
  if (!paid) return false;
  if (!orderDate) return false;
  if (recBaseline && orderDate < recBaseline) return false;
  return true;
}

module.exports = {
  STATE, ACTIVE_STATES, TERMINAL_STATES,
  isActiveState, isTerminalState, canTransition, TRANSITIONS,
  recType,
  newRecommendationId, isValidRecommendationId, REC_ID_RE, ymd,
  openCycleKey,
  EXPIRY, expirationFor,
  isQualifyingOrder,
};
