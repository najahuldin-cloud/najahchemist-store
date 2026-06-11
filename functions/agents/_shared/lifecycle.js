// Jarvis OS — Maps status + activity → lifecycleStage, opportunitySource,
// urgencyScore, intentSignals, objections, revenueRoute, lossReason. Deterministic.

const { daysSince, clamp } = require('./scoring');

function isoDate(now) {
  return new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD (matches followUpDate format)
}

function lifecycleStage(lead, now) {
  const status = lead.status || 'New';
  if (lead.converted === true || status === 'Ordered') return 'Won';
  if (lead.unsubscribed === true || status === 'Cold') return 'Lost';
  const inactive = daysSince(lead.lastReplyAt || lead.lastContacted || lead.createdAt, now);
  if (inactive != null && inactive >= 90) return 'Dormant';
  if (status === 'Interested') return 'Negotiating';
  const replied = Array.isArray(lead.emailConversation) && lead.emailConversation.some(t => t.role === 'user');
  if (status === 'Contacted') return replied ? 'Qualified' : 'Engaged';
  return 'New';
}

function opportunitySource(lead, now, stage) {
  const status = lead.status || 'New';
  if (stage === 'Lost') return 'lost';
  if (stage === 'Dormant') return 'dormant';
  const followDue = lead.followUpDate && lead.followUpDate <= isoDate(now);
  if (followDue && (status === 'Contacted' || status === 'Interested')) return 'overdue';
  if (status === 'Contacted' || status === 'Interested') return 'hot';
  return 'newlead';
}

function urgencyScore(lead, now, stage) {
  if (stage === 'Lost' || stage === 'Won') return 0;
  let u = 30;
  const status = lead.status || 'New';
  if (status === 'Interested') u += 40;
  else if (status === 'Contacted') u += 20;
  if (lead.followUpDate && lead.followUpDate <= isoDate(now)) u += 25; // overdue follow-up
  if ((lead.journey || '').toLowerCase().includes('ready')) u += 20;
  if (stage === 'Dormant') u -= 20;
  return clamp(Math.round(u), 0, 100);
}

function intentSignals(lead) {
  const sig = [];
  const j = (lead.journey || '').toLowerCase();
  if (j.includes('ready')) sig.push('ready-to-sell');
  if (j.includes('smallest')) sig.push('wants-to-sample');
  if (j.includes('exploring')) sig.push('early-exploration');
  if ((lead.budget || '').includes('1,000')) sig.push('high-budget');
  if (Array.isArray(lead.emailConversation) && lead.emailConversation.some(t => t.role === 'user')) sig.push('replied');
  if ((lead.emailCount || 0) > 1) sig.push('engaged-multi-touch');
  if (lead.status === 'Interested') sig.push('expressed-interest');
  return sig;
}

function objections(lead) {
  const obj = [];
  const j = (lead.journey || '').toLowerCase();
  const b = (lead.budget || '').toLowerCase();
  if (j.includes('exploring')) obj.push('not-ready-to-commit');
  if (b.includes('under $200')) obj.push('budget-constrained');
  if (!lead.lastReplyAt && (lead.emailCount || 0) >= 1) obj.push('unresponsive-so-far');
  return obj;
}

function revenueRoute(lead, stage) {
  if (stage === 'Lost' || stage === 'Dormant') return 'Reactivation';
  const j = (lead.journey || '').toLowerCase();
  if (j.includes('exploring') || j.includes('smallest')) return 'Lead→Sample→Order';
  return 'Lead→Order';
}

function lossReason(lead, stage) {
  if (stage !== 'Lost') return null;
  if (lead.unsubscribed) return 'unsubscribed';
  if ((lead.emailCount || 0) >= 7) return 'no-conversion-after-7-emails';
  return 'marked-cold';
}

module.exports = {
  isoDate, lifecycleStage, opportunitySource, urgencyScore,
  intentSignals, objections, revenueRoute, lossReason,
};
