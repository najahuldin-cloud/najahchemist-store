// Jarvis OS — Append-only audit writer → jarvis_audit_logs (immutable per rules).
//
// Every agent action touching money, pricing, customer data, inventory, campaigns,
// or external publishing MUST route through logAction(). The before/after snapshots
// make each action reversible by hand.

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

async function logAction({
  agent,
  action,
  leadId = null,
  before = null,
  after = null,
  level = 1,
  actor = 'system',
}) {
  if (!agent || !action) {
    throw new Error('[audit] logAction requires { agent, action }');
  }
  const db = getFirestore();
  await db.collection('jarvis_audit_logs').add({
    timestamp: FieldValue.serverTimestamp(),
    agent,
    action,
    leadId,
    before,
    after,
    level,
    actor,
  });
}

module.exports = { logAction };
