// Jarvis OS — Seed rule-values for the Lead Intelligence Engine.
//
// NO STATIC RULES WITHOUT LEARNING: every assumption is stored as
// { value, source: 'rule', confidence }. The learning layer (Phase 5) can later
// promote data-derived values (source: 'data', higher confidence) without code
// changes. Seeds reuse constants already proven in jarvis.html (AOV, close probs)
// so the new persisted intelligence stays numerically consistent with the dashboard.

const SCORER_VERSION = 1;

function rule(value, confidence) {
  return { value, source: 'rule', confidence };
}

// Average order value (J$) — jarvis.html AOV = 22535.
const AOV = rule(22535, 0.6);

// Base close probabilities by opportunity source — jarvis.html PROB map.
const CLOSE_PROB = {
  reorder: rule(0.80, 0.6),
  hot:     rule(0.45, 0.6),
  overdue: rule(0.35, 0.6),
  newlead: rule(0.25, 0.6),
  dormant: rule(0.10, 0.5),
  lost:    rule(0.02, 0.5),
};

// Budget tier (lead.budget string) → potential first-order value (J$). Assumptions.
// Both en-dash and hyphen variants are mapped because the funnel has used both.
const BUDGET_VALUE = {
  'Under $200 USD':  rule(28000, 0.4),
  '$200–$500 USD':   rule(56000, 0.4),
  '$200-$500 USD':   rule(56000, 0.4),
  '$500–$1,000 USD': rule(120000, 0.4),
  '$500-$1,000 USD': rule(120000, 0.4),
  '$1,000+ USD':     rule(200000, 0.4),
};

// Expected reorders within first year (for predictedLifetimeValue). Assumption.
const REORDER_MULTIPLIER = rule(3, 0.3);

// Decay (absolute score points) by days since last meaningful activity.
// Ordered high→low so the first match wins: -10 @ 30d, -20 @ 60d, -30 @ 90d.
const DECAY_STEPS = [
  { days: 90, points: 30 },
  { days: 60, points: 20 },
  { days: 30, points: 10 },
];

// Score label thresholds (0-100), checked high→low.
const LABEL_THRESHOLDS = [
  { min: 75, label: 'Ready' },
  { min: 50, label: 'Hot' },
  { min: 25, label: 'Warm' },
  { min: 0,  label: 'Cold' },
];

module.exports = {
  SCORER_VERSION, rule, AOV, CLOSE_PROB, BUDGET_VALUE,
  REORDER_MULTIPLIER, DECAY_STEPS, LABEL_THRESHOLDS,
};
