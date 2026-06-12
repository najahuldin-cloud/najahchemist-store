// Jarvis OS — Seed rule-values for the Lead Intelligence Engine.
//
// NO STATIC RULES WITHOUT LEARNING: every assumption is stored as
// { value, source: 'rule', confidence }. The learning layer (Phase 5) can later
// promote data-derived values (source: 'data', higher confidence) without code
// changes. Close-probability seeds reuse the constants proven in jarvis.html.

const SCORER_VERSION = 4; // v4: Contacted/Interested base split, budget-tier fix, isTest/dataQuality

function rule(value, confidence) {
  return { value, source: 'rule', confidence };
}

// Base close probabilities by opportunity source — jarvis.html PROB map.
const CLOSE_PROB = {
  reorder: rule(0.80, 0.6),
  hot:     rule(0.45, 0.6),
  overdue: rule(0.35, 0.6),
  newlead: rule(0.25, 0.6),
  dormant: rule(0.10, 0.5),
  lost:    rule(0.02, 0.5),
};

// ── Offer-level revenue model (the three revenue offers) ──────────────────────
// Manufacturing is tiered by scoreLabel; First Sale System and Coaching are flat.
// potentialValue, pipeline value, and expectedValue are ALL derived from this
// model — never from retail product AOV. Product names are a separate suggestion.
const OFFER_VALUES = {
  Manufacturing: {
    Cold:  rule(25000, 0.5),
    Warm:  rule(45000, 0.5),
    Hot:   rule(75000, 0.5),
    Ready: rule(120000, 0.5),
  },
  'First Sale System': rule(3999, 0.6),
  Coaching:            rule(25000, 0.5),
};

// Multipliers applied to the chosen offer's base potentialValue.
const PREMIUM_NICHE_MULT = rule(1.20, 0.4); // +20% for premium niches
const ENGAGEMENT_MULT    = rule(1.15, 0.4); // +15% when the lead has engaged

// Niches with higher willingness-to-pay (premium +20% applies).
const PREMIUM_SEGMENTS = ['feminine', 'skincare'];

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
// Cold 0–30, Warm 31–54, Hot 55–74, Ready 75+. Hot starts at 55 so plain
// status=Interested (base 55) labels Hot on base alone. Labels are a PURE function
// of score — isTest never affects labeling (test leads keep their natural label).
const LABEL_THRESHOLDS = [
  { min: 75, label: 'Ready' },
  { min: 55, label: 'Hot' },
  { min: 31, label: 'Warm' },
  { min: 0,  label: 'Cold' },
];

module.exports = {
  SCORER_VERSION, rule, CLOSE_PROB, OFFER_VALUES,
  PREMIUM_NICHE_MULT, ENGAGEMENT_MULT, PREMIUM_SEGMENTS,
  REORDER_MULTIPLIER, DECAY_STEPS, LABEL_THRESHOLDS,
};
