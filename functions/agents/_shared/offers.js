// Jarvis OS — Offer model. Maps a lead to exactly one of the three REVENUE offers
// (Manufacturing | First Sale System | Coaching), computes its potentialValue from
// the offer-level model in rule-values.js (NOT retail AOV), and suggests a public
// catalogue product for the outreach copy (suggestedProduct — separate field).

const RV = require('./rule-values');

const OFFER_NAMES = ['Manufacturing', 'First Sale System', 'Coaching'];

// Mirrors leadSegment() in admin-module.js / functions/index.js.
function segmentKey(brandType) {
  const b = (brandType || '').toLowerCase().trim();
  if (b.includes('hair')) return 'haircare';
  if (b.includes('feminine') || b.includes('yoni')) return 'feminine';
  if (b.includes('men')) return 'mens';
  if (b.includes('skin') || b.includes('body') || b.includes('face')) return 'skincare';
  return 'general';
}

// Public catalogue product to name in the outreach copy (NOT used for valuation).
const PRODUCT_BY_SEGMENT = {
  skincare: 'HydraGlow Skincare Bundle',
  feminine: 'Feminine Care Starter Kit',
  mens:     'Mencare Bundle',
  haircare: '1L Ayurvedic Hair Growth Oil',
  general:  'Starter Litre',
};

function suggestProduct(brandType) {
  return PRODUCT_BY_SEGMENT[segmentKey(brandType)] || PRODUCT_BY_SEGMENT.general;
}

// Free text to scan for EXPLICIT offer signals (only used for nicheless leads).
function leadText(lead) {
  return [
    lead.journey, lead.hearAboutUs, lead.notes, lead.message,
    Array.isArray(lead.answers) ? lead.answers.join(' ') : lead.answers,
  ].filter(Boolean).join(' ').toLowerCase();
}

// Explicit signals only — generic business words (business/selling/income/revenue/
// customers) are deliberately NOT here: every manufacturing lead uses them.
const FSS_SIGNAL      = /(first sale system|e-?book|\bbook\b|\bcourse\b|digital product)/;
const COACHING_SIGNAL = /(coaching|mentorship|consult|one[ -]on[ -]one)/;

// Only an explicit J$/JMD numeric budget below threshold counts. USD tier labels
// ("Under $200 USD" etc.) are NOT treated as sub-J$10,000.
function statedBudgetBelowJMD(lead, threshold) {
  const b = (lead.budget == null ? '' : String(lead.budget));
  if (/usd/i.test(b)) return false;
  const m = b.match(/([\d,]+)/);
  if (!m) return false;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 && n < threshold;
}

// Routing precedence (rule-sourced; learning can override later):
//   1) Recognized product niche/segment from /start → Manufacturing, ALWAYS
//      (segment is the strongest signal we have).
//   2) FSS only on explicit signals (book/ebook/course/digital product/"first sale
//      system") or an explicit stated J$ budget below 10,000.
//   3) Coaching only on explicit signals (coaching/mentorship/consult/one on one).
//   4) Default → Manufacturing.
function chooseOffer(lead) {
  if (segmentKey(lead.brandType) !== 'general') return 'Manufacturing';
  const text = leadText(lead);
  if (COACHING_SIGNAL.test(text)) return 'Coaching';
  if (FSS_SIGNAL.test(text) || statedBudgetBelowJMD(lead, 10000)) return 'First Sale System';
  return 'Manufacturing';
}

// FSS kept as a DOWNSELL FLAG on low-budget / early Manufacturing leads — their
// offer stays Manufacturing (mirrors the existing Jarvis "💡 Downsell candidate").
function isDownsellCandidate(lead, offer) {
  if (offer !== 'Manufacturing') return false;
  const b = (lead.budget || '').toLowerCase();
  const j = (lead.journey || '').toLowerCase();
  return b.includes('under $200') || j.includes('exploring');
}

// potentialValue { value, source, confidence } from the offer model + modifiers.
function offerPotentialValue(offer, scoreLabel, { premiumNiche, engaged }) {
  const baseRule = offer === 'Manufacturing'
    ? RV.OFFER_VALUES.Manufacturing[scoreLabel]
    : RV.OFFER_VALUES[offer];
  let value = baseRule.value;
  if (premiumNiche) value *= RV.PREMIUM_NICHE_MULT.value; // +20%
  if (engaged)      value *= RV.ENGAGEMENT_MULT.value;    // +15%
  return { value: Math.round(value), source: 'rule', confidence: baseRule.confidence };
}

// Offer-level reasons the other two offers were not recommended.
const WHYNOT_REASON = {
  Manufacturing: 'lead has a product niche / manufacturing intent — sell the wholesale order.',
  'First Sale System': 'no explicit digital-product/book signal and budget is not sub-J$10k.',
  Coaching: 'no explicit coaching/mentorship/consult request.',
};

function recommendOffer(lead, scoreLabel, { premiumNiche, engaged }) {
  const offer = chooseOffer(lead);
  const potentialValue = offerPotentialValue(offer, scoreLabel, { premiumNiche, engaged });
  const suggestedProduct = suggestProduct(lead.brandType);
  const downsellCandidate = isDownsellCandidate(lead, offer);
  const whyNot = OFFER_NAMES
    .filter(o => o !== offer)
    .map(o => `${o} not recommended — ${WHYNOT_REASON[o]}`);
  return { offer, potentialValue, suggestedProduct, downsellCandidate, whyNot };
}

module.exports = {
  OFFER_NAMES, segmentKey, suggestProduct, leadText, chooseOffer,
  isDownsellCandidate, statedBudgetBelowJMD, offerPotentialValue, recommendOffer,
};
