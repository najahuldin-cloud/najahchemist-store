// lead-agent — owns lead scoring & the Lead Intelligence Engine.
// Owned collections: lead_intelligence, lead_recommendation_outcomes.
//
// Exports two Cloud Functions:
//   scoreLeadsDaily    — scheduled (07:00 Jamaica). Phase 2 ships in DRY-RUN
//                        (computes + logs, does NOT write). Phase 3 flips
//                        DAILY_WRITE_ENABLED to true after a backup snapshot.
//   scoreLeadsBackfill — admin-only onCall; defaults to dry-run. Writes only when
//                        called with { dryRun: false }. Used for the gated backfill.
//
// Deterministic scoring only — NO Claude/Mem0 calls.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const { buildIntelligence } = require('./score');
const { assertPermission } = require('../_shared/permissions');
const { isKilled } = require('../_shared/killswitch');
const { logAction } = require('../_shared/audit');

const AGENT = 'lead-agent';
const ADMIN_EMAIL = 'start@najahchemist.com';

// Phase 2: dry-run. Phase 3 flips this to true (after a backup snapshot exists).
const DAILY_WRITE_ENABLED = false;

async function loadPrevIntel(db) {
  const snap = await db.collection('lead_intelligence').get();
  const map = new Map();
  snap.forEach(d => map.set(d.id, d.data()));
  return map;
}

// Scores every lead. Writes only when `write` is true; otherwise computes + samples.
async function scoreAll(db, { write, limit }) {
  if (await isKilled(AGENT)) {
    console.warn('[lead-agent] kill switch ON — skipping');
    return { killed: true, scored: 0, written: 0 };
  }

  const prev = await loadPrevIntel(db);
  const leadsSnap = await db.collection('leads').get();
  let docs = leadsSnap.docs;
  if (limit && limit > 0) docs = docs.slice(0, limit);

  const now = Date.now();
  let written = 0;
  const sample = [];

  for (const doc of docs) {
    const lead = doc.data();
    const intel = buildIntelligence(lead, doc.id, prev.get(doc.id), now);

    if (sample.length < 5) {
      sample.push({
        leadId: doc.id,
        score: intel.score,
        label: intel.scoreLabel,
        expectedValue: intel.expectedValue,
        offer: intel.recommendedOffer.name,
        nextAction: intel.nextAction,
      });
    }

    if (write) {
      assertPermission(AGENT, 'write:lead_intelligence');
      await db.collection('lead_intelligence').doc(doc.id).set(
        { ...intel, lastScoredAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      written++;
    }
  }

  return { killed: false, scored: docs.length, written, dryRun: !write, sample };
}

exports.scoreLeadsDaily = onSchedule(
  { schedule: '0 7 * * *', timeZone: 'America/Jamaica' },
  async () => {
    const db = getFirestore();
    const res = await scoreAll(db, { write: DAILY_WRITE_ENABLED, limit: 0 });
    console.log('[scoreLeadsDaily]', JSON.stringify({ ...res, sample: undefined }));
    if (DAILY_WRITE_ENABLED && !res.killed) {
      await logAction({
        agent: AGENT, action: 'scoreLeadsDaily',
        after: { scored: res.scored, written: res.written }, level: 1, actor: 'scheduler',
      });
    }
  }
);

exports.scoreLeadsBackfill = onCall(async (request) => {
  const email = request.auth && request.auth.token && request.auth.token.email;
  if (email !== ADMIN_EMAIL) {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  // Default to dry-run; only a live write when explicitly { dryRun: false }.
  const dryRun = !(request.data && request.data.dryRun === false);
  const limit = (request.data && Number(request.data.limit)) || 0;

  const db = getFirestore();
  const res = await scoreAll(db, { write: !dryRun, limit });

  if (!dryRun && !res.killed) {
    await logAction({
      agent: AGENT, action: 'scoreLeadsBackfill',
      after: { scored: res.scored, written: res.written }, level: 1, actor: email,
    });
  }
  return res;
});
