// recommendation-agent/index.js — Cloud Function triggers ONLY.
//
// The agents barrel (agents/index.js) spreads this module, so it must export nothing
// but deployable triggers. All logic lives in ./service.js (plain helpers), which
// functions/index.js also imports for the onOrderCreated hook.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');

const svc = require('./service');

// Persist-at-generation: keep canonical recommendations current (after the 2h rescore).
exports.syncRecommendations = onSchedule({ schedule: '30 */2 * * *', timeZone: svc.TZ }, async () => {
  const res = await svc.syncRecommendations(getFirestore(), { write: svc.SYNC_WRITE_ENABLED });
  console.log('[syncRecommendations]', JSON.stringify(res));
});

// Automatic order reconciliation sweep (shadow until RECONCILE_LIVE_ENABLED).
exports.reconcileRecommendations = onSchedule({ schedule: '15 * * * *', timeZone: svc.TZ }, async () => {
  const res = await svc.reconcileOnce(getFirestore(), { live: svc.RECONCILE_LIVE_ENABLED });
  console.log('[reconcileRecommendations]', JSON.stringify(res));
});

// Daily integrity scan → recommendation_integrity_reports.
exports.recommendationIntegrityScan = onSchedule({ schedule: '0 6 * * *', timeZone: svc.TZ }, async () => {
  const res = await svc.integrityScan(getFirestore());
  console.log('[recommendationIntegrityScan]', JSON.stringify({ total: res.total, summary: res.summary }));
});

// Admin-only manual trigger (dry-run friendly) for validating before flipping flags.
exports.recommendationOps = onCall(async (request) => {
  const email = request.auth && request.auth.token && request.auth.token.email;
  if (email !== svc.ADMIN_EMAIL) throw new HttpsError('permission-denied', 'admin only');
  const db = getFirestore();
  const op = (request.data && request.data.op) || '';
  const dryRun = !(request.data && request.data.dryRun === false);
  if (op === 'sync')      return await svc.syncRecommendations(db, { write: !dryRun });
  if (op === 'reconcile') return await svc.reconcileOnce(db, { live: !dryRun && svc.RECONCILE_LIVE_ENABLED });
  if (op === 'integrity') return await svc.integrityScan(db);
  if (op === 'backfill')  return await svc.backfillRecommendations(db, { write: !dryRun });
  throw new HttpsError('invalid-argument', 'op must be sync | reconcile | integrity | backfill');
});
