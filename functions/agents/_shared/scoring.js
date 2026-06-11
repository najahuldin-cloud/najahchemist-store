// Jarvis OS — Deterministic scoring math. NO external/LLM calls.

const { DECAY_STEPS, LABEL_THRESHOLDS } = require('./rule-values');

const DAY_MS = 24 * 60 * 60 * 1000;

// Accepts a JS Date, a Firestore Timestamp (has toDate()), an ISO string, or ms.
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function daysSince(value, now) {
  const d = toDate(value);
  if (!d) return null;
  return Math.floor((now - d.getTime()) / DAY_MS);
}

// Absolute decay points for days inactive (-10@30, -20@60, -30@90).
function decayPoints(daysInactive) {
  if (daysInactive == null) return 0;
  for (const step of DECAY_STEPS) {       // ordered 90, 60, 30
    if (daysInactive >= step.days) return step.points;
  }
  return 0;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function scoreLabel(score) {
  for (const t of LABEL_THRESHOLDS) if (score >= t.min) return t.label;
  return 'Cold';
}

// Reads the .value off a { value, source, confidence } rule object, or returns a raw number.
function getValue(v) {
  return (v && typeof v === 'object' && 'value' in v) ? v.value : v;
}

module.exports = { DAY_MS, toDate, daysSince, decayPoints, clamp, scoreLabel, getValue };
