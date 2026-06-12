// Jarvis OS — Duplicate intelligence (SHARED LOGIC). NEVER merges/deletes/modifies
// leads. Computes, across the full lead base, a cluster per lead linked by shared
// emailKey OR phoneKey (union-find / connected components), and the set of contacts
// shared across >= SHARED_CONTACT_THRESHOLD leads (for shared_contact test flagging).
//
// Phase 4 UI deduplicates rankings/pipeline by keeping only isPrimaryRecord per cluster.

const { normEmail, normPhone } = require('./data-quality');

const SHARED_CONTACT_THRESHOLD = 10;

// leads: [{ id, lead }]. Returns { index: Map(id -> {duplicateClusterId, duplicateCount,
// isPrimaryRecord}), sharedEmailKeys: Set, sharedPhoneKeys: Set }.
function buildDuplicateIndex(leads) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (const { id } of leads) parent.set(id, id);

  const emailFirst = new Map(), phoneFirst = new Map();
  const emailCount = new Map(), phoneCount = new Map();
  const leadById = new Map();
  for (const { id, lead } of leads) {
    leadById.set(id, lead);
    const ek = normEmail(lead.email), pk = normPhone(lead.whatsapp);
    if (ek) { emailCount.set(ek, (emailCount.get(ek) || 0) + 1); if (emailFirst.has(ek)) union(id, emailFirst.get(ek)); else emailFirst.set(ek, id); }
    if (pk) { phoneCount.set(pk, (phoneCount.get(pk) || 0) + 1); if (phoneFirst.has(pk)) union(id, phoneFirst.get(pk)); else phoneFirst.set(pk, id); }
  }

  const comps = new Map();
  for (const { id } of leads) { const r = find(id); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(id); }

  const index = new Map();
  for (const [root, ids] of comps) {
    const size = ids.length;
    // Primary = earliest createdAt, tie-break lowest id (stable original record).
    const primary = ids.slice().sort((a, b) => {
      const ta = +new Date(leadById.get(a).createdAt || 0) || 0;
      const tb = +new Date(leadById.get(b).createdAt || 0) || 0;
      return ta - tb || (a < b ? -1 : 1);
    })[0];
    for (const id of ids) {
      index.set(id, {
        duplicateClusterId: size > 1 ? root : null,
        duplicateCount: size,
        isPrimaryRecord: size > 1 ? id === primary : true,
      });
    }
  }

  const sharedEmailKeys = new Set([...emailCount].filter(([, c]) => c >= SHARED_CONTACT_THRESHOLD).map(([k]) => k));
  const sharedPhoneKeys = new Set([...phoneCount].filter(([, c]) => c >= SHARED_CONTACT_THRESHOLD).map(([k]) => k));
  return { index, sharedEmailKeys, sharedPhoneKeys, SHARED_CONTACT_THRESHOLD };
}

module.exports = { buildDuplicateIndex, SHARED_CONTACT_THRESHOLD };
