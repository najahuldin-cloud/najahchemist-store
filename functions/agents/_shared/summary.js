// Jarvis OS — Local, deterministic natural-language generation (NO LLM):
// executiveSummary, whyRecommended. Templated from the scored context.

const { getValue } = require('./scoring');

function fmtJ(n) {
  return 'J$' + Math.round(n).toLocaleString('en-US');
}

function whyRecommended(ctx) {
  const { lead, offer, closeProbability, potentialValue, opportunitySource, urgency } = ctx;
  const w = [];
  w.push(`Segment ${offer.offered.key}; recommend ${offer.offered.name} (${fmtJ(getValue(offer.offered.value))}).`);
  if (lead.budget) w.push(`Stated budget: ${lead.budget}.`);
  if (lead.journey) w.push(`Journey: "${lead.journey}".`);
  w.push(`Close probability ${(closeProbability * 100).toFixed(0)}% → expected value ${fmtJ(getValue(potentialValue) * closeProbability)}.`);
  w.push(`Opportunity type: ${opportunitySource}; urgency ${urgency}/100.`);
  return w;
}

function executiveSummary(ctx) {
  const { lead, offer, score, scoreLabel, closeProbability, potentialValue, nextAction } = ctx;
  const first = (lead.name || 'Lead').split(' ')[0];
  return `${first} — ${scoreLabel} (${score}/100). ${offer.offered.key} lead` +
    `${lead.budget ? `, budget ${lead.budget}` : ''}. ` +
    `Recommend ${offer.offered.name}; ${(closeProbability * 100).toFixed(0)}% close, ` +
    `expected ${fmtJ(getValue(potentialValue) * closeProbability)}. Next: ${nextAction}`;
}

module.exports = { whyRecommended, executiveSummary, fmtJ };
