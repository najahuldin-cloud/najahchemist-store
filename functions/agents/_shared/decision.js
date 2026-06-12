// Jarvis OS — Decision Engine. Every intelligence output carries an action:
// no score without a decision. Returns { recommendation, confidence, expectedImpact, why }.

const { getValue } = require('./scoring');

function buildDecision(ctx) {
  const { nextAction, potentialValue, closeProbability, whyRecommended } = ctx;
  const offerConf = (potentialValue && potentialValue.confidence) || 0.5;
  const confidence = Math.round(((offerConf + closeProbability) / 2) * 100) / 100;
  return {
    recommendation: nextAction,
    confidence,
    expectedImpact: Math.round(getValue(potentialValue) * closeProbability),
    why: whyRecommended.slice(0, 3).join(' '),
  };
}

module.exports = { buildDecision };
