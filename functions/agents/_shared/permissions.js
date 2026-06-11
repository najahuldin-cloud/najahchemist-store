// Jarvis OS — Agent permission model + approval levels (security layer).
//
// Core rule: no agent ever holds "*". Every write an agent performs is checked
// against that agent's explicit permission list before it reaches Firestore.
//
// Approval levels:
//   L1 (auto)            — scoring, reminders, drafts. Agent executes directly.
//   L2 (approval needed) — broadcasts, campaigns, ad spend. Agent writes a
//                          pending_approvals row and STOPS until a human approves.
//   L3 (always human)    — pricing, refunds, contracts. Agent may only draft/
//                          recommend into pending_approvals; never auto-executes.

const AGENTS = {
  'lead-agent': {
    level: 1,
    permissions: [
      'read:leads',
      'write:lead_intelligence',
      'write:lead_recommendation_outcomes',
    ],
  },
  'reorder-agent':       { level: 1, permissions: [] },
  'book-agent':          { level: 1, permissions: [] },
  'coaching-agent':      { level: 1, permissions: [] },
  'marketing-commander': { level: 2, permissions: [] },
  'demand-hunter':       { level: 1, permissions: [] },
  'ad-commander':        { level: 2, permissions: [] },
  'content-commander':   { level: 2, permissions: [] },
};

const APPROVAL = { L1: 1, L2: 2, L3: 3 };

function _agent(agent) {
  const a = AGENTS[agent];
  if (!a) throw new Error(`[permissions] unknown agent: ${agent}`);
  return a;
}

function permissionsFor(agent) {
  return _agent(agent).permissions;
}

function levelFor(agent) {
  return _agent(agent).level;
}

// Throws unless `agent` explicitly holds `permission`. Wildcards are rejected.
function assertPermission(agent, permission) {
  const perms = permissionsFor(agent);
  if (perms.includes('*')) {
    throw new Error(`[permissions] wildcard "*" is never allowed (agent: ${agent})`);
  }
  if (!perms.includes(permission)) {
    throw new Error(`[permissions] ${agent} lacks permission: ${permission}`);
  }
  return true;
}

module.exports = { AGENTS, APPROVAL, permissionsFor, levelFor, assertPermission };
