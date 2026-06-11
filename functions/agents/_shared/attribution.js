// Jarvis OS — Resolves attribution { source, campaignId, contentId, agent } from
// lead fields so realized revenue can later be traced back to its origin.

function buildAttribution(lead) {
  return {
    source: lead.hearAboutUs || lead.page || lead.source || 'unknown',
    campaignId: lead.campaignId || null,
    contentId: lead.contentId || null,
    agent: 'lead-agent',
  };
}

module.exports = { buildAttribution };
