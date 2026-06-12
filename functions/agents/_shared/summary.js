// Jarvis OS — Local, deterministic natural-language generation (NO LLM):
// executiveSummary, whyRecommended. Templated from the scored, offer-level context.

const { getValue } = require('./scoring');
const { firstName } = require('./names');

function fmtJ(n) {
  return 'J$' + Math.round(n).toLocaleString('en-US');
}

function whyRecommended(ctx) {
  const { lead, offer, suggestedProduct, closeProbability, potentialValue, opportunitySource, urgency } = ctx;
  const w = [];
  w.push(`Offer: ${offer} (${fmtJ(getValue(potentialValue))} potential).`);
  if (suggestedProduct) w.push(`Suggested product for outreach: ${suggestedProduct}.`);
  if (lead.budget) w.push(`Stated budget: ${lead.budget}.`);
  if (lead.journey) w.push(`Journey: "${lead.journey}".`);
  w.push(`Close probability ${(closeProbability * 100).toFixed(0)}% → expected value ${fmtJ(getValue(potentialValue) * closeProbability)}.`);
  w.push(`Opportunity type: ${opportunitySource}; urgency ${urgency}/100.`);
  return w;
}

function executiveSummary(ctx) {
  const { lead, offer, suggestedProduct, score, scoreLabel, closeProbability, potentialValue, nextAction } = ctx;
  const first = firstName(lead.name);
  return `${first} — ${scoreLabel} (${score}/100). Offer: ${offer}; ` +
    `${(closeProbability * 100).toFixed(0)}% close, expected ${fmtJ(getValue(potentialValue) * closeProbability)}. ` +
    `Suggest ${suggestedProduct}. Next: ${nextAction}`;
}

module.exports = { whyRecommended, executiveSummary, fmtJ };
