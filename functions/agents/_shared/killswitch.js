// Jarvis OS — Agent kill switch.
//
// Reads agent_controls/global.killSwitch. A value of `true` for an agent means it
// is DISABLED. Every agent entry point must check isKilled() first and short-circuit.
//
// Fail-safe: if agent_controls cannot be read, the agent is treated as KILLED so a
// controls outage can never let an autonomous agent run unsupervised.

const { getFirestore } = require('firebase-admin/firestore');

// 'lead-agent' -> 'leadAgent'
function agentKey(agent) {
  return String(agent).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

async function isKilled(agent) {
  try {
    const db = getFirestore();
    const snap = await db.collection('agent_controls').doc('global').get();
    if (!snap.exists) return false; // no controls doc yet → agents enabled by default
    const ks = (snap.data() || {}).killSwitch || {};
    return ks[agentKey(agent)] === true;
  } catch (e) {
    console.error(`[killswitch] could not read agent_controls — treating ${agent} as KILLED:`, e.message);
    return true;
  }
}

module.exports = { isKilled, agentKey };
