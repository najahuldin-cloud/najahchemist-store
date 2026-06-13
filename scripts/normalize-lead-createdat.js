/**
 * One-off migration: normalize `createdAt` in the `leads` collection.
 *
 * Some lead docs stored `createdAt` as an ISO STRING instead of a Firestore
 * Timestamp. Firestore sorts all strings above all timestamps, so `orderBy(createdAt)`
 * gives wrong chronological order. This converts string values to Timestamps in place.
 *
 * Safety:
 *   - Only touches docs where typeof createdAt === 'string'.
 *   - Uses .update({ createdAt }) — merges, leaves every other field untouched.
 *   - Never deletes anything.
 *   - DRY RUN by default. Pass --commit to actually write.
 *
 * Target: prod project `najah-chemist` (via prod-service-account.json).
 * Usage:  node scripts/normalize-lead-createdat.js          (dry run)
 *         node scripts/normalize-lead-createdat.js --commit (live writes)
 */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('../prod-service-account.json')) });
const db = admin.firestore();

const COMMIT = process.argv.includes('--commit');

(async () => {
  const snap = await db.collection('leads').get();

  let scanned = 0;
  let stringDated = 0;
  let updated = 0;
  let skippedUnparseable = 0;
  const unparseable = [];

  for (const doc of snap.docs) {
    scanned++;
    const v = doc.data().createdAt;
    if (typeof v !== 'string') continue;   // only string-typed createdAt
    stringDated++;

    const parsed = new Date(v);
    if (isNaN(parsed.getTime())) {
      skippedUnparseable++;
      unparseable.push({ id: doc.id, value: v });
      console.warn(`SKIP  ${doc.id}  (unparseable) createdAt="${v}"`);
      continue;
    }

    const ts = admin.firestore.Timestamp.fromDate(parsed);
    const after = ts.toDate().toISOString();

    if (COMMIT) {
      await doc.ref.update({ createdAt: ts });   // only this field is written
      updated++;
      console.log(`UPDATE  ${doc.id}  before="${v}"  ->  after=Timestamp(${after})`);
    } else {
      console.log(`DRY     ${doc.id}  before="${v}"  ->  after=Timestamp(${after})`);
    }
  }

  console.log('\n===== SUMMARY =====');
  console.log(`Mode:                  ${COMMIT ? 'COMMIT (live writes)' : 'DRY RUN (no writes made)'}`);
  console.log(`Total leads scanned:   ${scanned}`);
  console.log(`String createdAt found:${' '}${stringDated}`);
  console.log(`Unparseable (skipped): ${skippedUnparseable}`);
  if (COMMIT) {
    console.log(`Documents updated:     ${updated}`);
  } else {
    console.log(`Would update:          ${stringDated - skippedUnparseable}`);
  }
  if (unparseable.length) {
    console.log('\nUnparseable docs (left untouched):');
    unparseable.forEach(u => console.log(`  - ${u.id}: "${u.value}"`));
  }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
