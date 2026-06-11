// lead-agent/score.js — deterministic per-lead intelligence builder.
//
// buildIntelligence(lead, leadId, prevIntel, now) → the full intelligence object,
// WITHOUT lastScoredAt (the writer stamps that as a server timestamp). Pure & local:
// no Claude/Mem0/network calls, so it is fully unit-testable.

const RV = require('../_shared/rule-values');
const S  = require('../_shared/scoring');
const { recommendOffer } = require('../_shared/offers');
const LC = require('../_shared/lifecycle');
const { buildAttribution } = require('../_shared/attribution');
const { whyRecommended, executiveSummary } = require('../_shared/summary');
const { buildDecision } = require('../_shared/decision');

const PRODUCTS_BY_SEGMENT = {
  skincare: ['Turmeric Kojic Soap', 'Papaya Serum', 'HydraGlow Bundle'],
  feminine: ['Yoni Foaming Wash', 'Yoni Oil', 'Girls Night In Bundle'],
  mens:     ['Beard Oil', 'Ryfle Wash', 'Mencare Bundle'],
  haircare: ['Ayurvedic Hair Growth Oil', 'Hair Butter', 'Hair Mist'],
  general:  ['Starter Litre'],
};
const CONTENT_BY_SEGMENT = {
  skincare: ['skin-brightening', 'dark-spot-care'],
  feminine: ['feminine-wellness', 'yoni-care'],
  mens:     ['beard-grooming', 'mens-intimate-care'],
  haircare: ['natural-hair-growth', 'scalp-care'],
  general:  ['start-a-brand'],
};

function potentialValue(lead) {
  if (lead.budget && RV.BUDGET_VALUE[lead.budget]) return RV.BUDGET_VALUE[lead.budget];
  return RV.AOV;
}

function closeProbability(opportunitySource, lead, decay) {
  const base = (RV.CLOSE_PROB[opportunitySource] || RV.CLOSE_PROB.newlead).value;
  let p = base;
  const j = (lead.journey || '').toLowerCase();
  if (j.includes('ready')) p += 0.15;
  else if (j.includes('exploring')) p -= 0.10;
  if ((lead.budget || '').includes('1,000')) p += 0.05;
  p -= decay / 200;                       // -30 decay points → -0.15 probability
  return S.clamp(Math.round(p * 100) / 100, 0.01, 0.95);
}

function rawScore(lead, opportunitySource, decay) {
  const base = { reorder: 70, hot: 55, overdue: 50, newlead: 35, dormant: 20, lost: 5 }[opportunitySource];
  let s = base == null ? 35 : base;
  const j = (lead.journey || '').toLowerCase();
  if (j.includes('ready')) s += 15;
  else if (j.includes('smallest')) s += 5;
  else if (j.includes('exploring')) s -= 5;
  if ((lead.budget || '').includes('1,000')) s += 12;
  else if ((lead.budget || '').includes('500')) s += 8;
  else if ((lead.budget || '').includes('200')) s += 4;
  if (Array.isArray(lead.emailConversation) && lead.emailConversation.some(t => t.role === 'user')) s += 10;
  s -= decay;
  return S.clamp(Math.round(s), 0, 100);
}

function buildTimeline(lead) {
  const tl = [];
  const push = (at, type, detail) => {
    const d = S.toDate(at);
    if (d) tl.push({ at: d.toISOString(), type, detail, source: 'lead' });
  };
  push(lead.createdAt, 'created', 'Lead captured');
  push(lead.lastContacted, 'contacted', 'Owner marked contacted');
  push(lead.lastReplyAt, 'replied', 'Lead replied');
  if (lead.followUpDate) tl.push({ at: lead.followUpDate, type: 'follow-up-due', detail: 'Follow-up scheduled', source: 'lead' });
  return tl.sort((a, b) => (a.at < b.at ? -1 : 1));
}

function nextActionFor(opportunitySource, lead, offer) {
  const channel = lead.whatsapp ? 'WhatsApp' : 'Email';
  const first = (lead.name || 'lead').split(' ')[0];
  switch (opportunitySource) {
    case 'overdue': return `${channel} now — follow-up is overdue. Pitch ${offer.offered.name}.`;
    case 'hot':     return `${channel} ${first} — warm lead. Offer ${offer.offered.name}.`;
    case 'dormant': return `Reactivation ${channel.toLowerCase()} — dormant lead.`;
    case 'lost':    return `No outbound — lead is lost. Eligible for win-back campaign only.`;
    default:        return `${channel} first outreach — introduce ${offer.offered.name}.`;
  }
}

function buildIntelligence(lead, leadId, prevIntel, now) {
  now = now || Date.now();

  const stage     = LC.lifecycleStage(lead, now);
  const oppSource = LC.opportunitySource(lead, now, stage);
  const lastActivity = lead.lastReplyAt || lead.lastContacted || lead.createdAt;
  const inactiveDays = S.daysSince(lastActivity, now);
  const decay     = S.decayPoints(inactiveDays);

  const score = rawScore(lead, oppSource, decay);
  const label = S.scoreLabel(score);
  const offer = recommendOffer(lead.brandType);
  const segKey = offer.offered.key;
  const pv = potentialValue(lead);
  const cp = closeProbability(oppSource, lead, decay);
  const ev = Math.round(S.getValue(pv) * cp);

  const urgency = LC.urgencyScore(lead, now, stage);
  const nextAction = nextActionFor(oppSource, lead, offer);

  let trend = 'new';
  if (prevIntel && typeof prevIntel.score === 'number') {
    trend = score > prevIntel.score ? 'up' : score < prevIntel.score ? 'down' : 'flat';
  }

  const pltv = {
    value: Math.round(S.getValue(pv) * RV.REORDER_MULTIPLIER.value),
    source: 'rule',
    confidence: RV.REORDER_MULTIPLIER.confidence,
  };

  const ctx = {
    lead, offer, score, scoreLabel: label, closeProbability: cp,
    potentialValue: pv, opportunitySource: oppSource, urgency, nextAction,
  };
  const why = whyRecommended(ctx);
  const summary = executiveSummary(ctx);
  const decision = buildDecision({ nextAction, offer, closeProbability: cp, potentialValue: pv, whyRecommended: why });

  const lastMeaningful = S.toDate(lastActivity);

  return {
    leadId,
    score,
    scoreLabel: label,
    scoreTrend: trend,
    closeProbability: cp,
    recommendedOffer: { name: offer.offered.name, ...offer.offered.value }, // {name, value, source, confidence}
    offerConfidence: offer.offered.value.confidence,
    potentialValue: pv,                    // { value, source, confidence }
    expectedValue: ev,                     // potentialValue.value × closeProbability
    predictedLifetimeValue: pltv,          // { value, source, confidence }
    urgencyScore: urgency,
    nextAction,
    whyRecommended: why,
    whyNot: offer.whyNot,
    revenueRoute: LC.revenueRoute(lead, stage),
    agentOwner: 'lead-agent',
    lifecycleStage: stage,
    intentSignals: LC.intentSignals(lead),
    objections: LC.objections(lead),
    productsInterestedIn: PRODUCTS_BY_SEGMENT[segKey] || [],
    contentInterests: CONTENT_BY_SEGMENT[segKey] || [],
    executiveSummary: summary,
    attribution: buildAttribution(lead),
    preferredChannel: lead.whatsapp ? 'whatsapp' : 'email',
    opportunitySource: oppSource,
    lossReason: LC.lossReason(lead, stage),
    activityTimeline: buildTimeline(lead),
    decisionEngine: decision,
    recommendationVersion: RV.SCORER_VERSION,
    lastMeaningfulActivity: lastMeaningful ? lastMeaningful.toISOString() : null,
    scoredBy: `lead-agent@v${RV.SCORER_VERSION}`,
    // lastScoredAt is stamped by the writer (FieldValue.serverTimestamp()).
  };
}

module.exports = { buildIntelligence };
