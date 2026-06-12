// lead-agent/score.js — deterministic per-lead intelligence builder.
//
// buildIntelligence(lead, leadId, prevIntel, now) → the full intelligence object,
// WITHOUT lastScoredAt (the writer stamps that as a server timestamp). Pure & local:
// no Claude/Mem0/network calls, so it is fully unit-testable.
//
// Valuation is driven by the OFFER-LEVEL revenue model (Manufacturing | First Sale
// System | Coaching) — never retail product AOV. The catalogue product is a separate
// `suggestedProduct` used only in the outreach copy.

const RV = require('../_shared/rule-values');
const S  = require('../_shared/scoring');
const { recommendOffer, segmentKey } = require('../_shared/offers');
const { firstName } = require('../_shared/names');
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

function isEngaged(lead) {
  return lead.status === 'Interested'
    || (lead.emailCount || 0) > 1
    || (Array.isArray(lead.emailConversation) && lead.emailConversation.some(t => t.role === 'user'));
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

// Copy matches scoreLabel (no more "warm lead" for a Hot-labeled lead) and uses a
// sanitized first name. suggestedProduct (catalogue) is named alongside the offer.
function nextActionFor(opportunitySource, lead, scoreLabel, offer, suggestedProduct) {
  const channel = lead.whatsapp ? 'WhatsApp' : 'Email';
  const first = firstName(lead.name);
  const prod = suggestedProduct ? ` (suggest ${suggestedProduct})` : '';
  switch (opportunitySource) {
    case 'overdue': return `${channel} ${first} now — follow-up overdue. Pitch ${offer}${prod}.`;
    case 'hot':     return `${channel} ${first} — ${scoreLabel} lead. Offer ${offer}${prod}.`;
    case 'dormant': return `Reactivation ${channel.toLowerCase()} — dormant ${first}. Offer ${offer}.`;
    case 'lost':    return `No outbound — lead is lost. Win-back campaign only.`;
    default:        return `${channel} ${first} — first outreach. Introduce ${offer}${prod}.`;
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

  const segKey = segmentKey(lead.brandType);
  const premiumNiche = RV.PREMIUM_SEGMENTS.includes(segKey);
  const engaged = isEngaged(lead);

  // Offer-level revenue model drives valuation (NOT retail AOV).
  const rec = recommendOffer(lead, label, { premiumNiche, engaged });
  const pv = rec.potentialValue;          // { value, source, confidence }
  const cp = closeProbability(oppSource, lead, decay);
  const ev = Math.round(S.getValue(pv) * cp);

  const urgency = LC.urgencyScore(lead, now, stage);
  const nextAction = nextActionFor(oppSource, lead, label, rec.offer, rec.suggestedProduct);

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
    lead, offer: rec.offer, suggestedProduct: rec.suggestedProduct,
    score, scoreLabel: label, closeProbability: cp, potentialValue: pv,
    opportunitySource: oppSource, urgency, nextAction,
  };
  const why = whyRecommended(ctx);
  if (rec.downsellCandidate) {
    why.push('💡 Downsell candidate — offer First Sale System (J$3,999) first if they hesitate.');
  }
  const summary = executiveSummary(ctx);
  const decision = buildDecision({ nextAction, potentialValue: pv, closeProbability: cp, whyRecommended: why });

  const lastMeaningful = S.toDate(lastActivity);

  return {
    leadId,
    score,
    scoreLabel: label,
    scoreTrend: trend,
    closeProbability: cp,
    recommendedOffer: rec.offer,           // exactly one of Manufacturing | First Sale System | Coaching
    downsellCandidate: rec.downsellCandidate, // FSS downsell flag (offer stays Manufacturing)
    suggestedProduct: rec.suggestedProduct, // public catalogue product (copy only, not valuation)
    offerConfidence: pv.confidence,
    potentialValue: pv,                    // { value, source, confidence } — offer-level
    expectedValue: ev,                     // potentialValue.value × closeProbability
    predictedLifetimeValue: pltv,          // { value, source, confidence }
    urgencyScore: urgency,
    nextAction,
    whyRecommended: why,
    whyNot: rec.whyNot,                    // offer-level reasons the other two were not chosen
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
