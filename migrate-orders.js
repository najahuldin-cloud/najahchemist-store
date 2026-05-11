import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const prodCreds = JSON.parse(readFileSync('./prod-service-account.json', 'utf8'));
const stagingCreds = JSON.parse(readFileSync('./staging-service-account.json', 'utf8'));

const prodApp = admin.initializeApp({ credential: admin.credential.cert(prodCreds) }, 'prod');
const stagingApp = admin.initializeApp({ credential: admin.credential.cert(stagingCreds) }, 'staging');

const prodDb = admin.firestore(prodApp);
const stagingDb = admin.firestore(stagingApp);

const PAGE_SIZE = 100;

async function fetchAllDocs(collectionRef) {
  const allDocs = [];
  let lastDoc = null;

  while (true) {
    let query = collectionRef.limit(PAGE_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.empty) break;

    allDocs.push(...snap.docs);
    console.log(`  Fetched page: ${snap.docs.length} docs (running total: ${allDocs.length})`);

    if (snap.docs.length < PAGE_SIZE) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  return allDocs;
}

async function migrateOrders() {
  console.log('Fetching ALL orders from production (najah-chemist-362ad)...');
  const snapshot = await prodDb.collection('orders').get();
  console.log('Total found in production:', snapshot.size);
  const prodDocs = snapshot.docs;

  if (prodDocs.length === 0) {
    console.log('No orders found. Nothing to migrate.');
    await Promise.all([prodApp.delete(), stagingApp.delete()]);
    return;
  }

  let copied = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of prodDocs) {
    const stagingRef = stagingDb.collection('orders').doc(doc.id);
    try {
      const existing = await stagingRef.get();
      if (existing.exists) {
        const data = doc.data();
        console.log(`  SKIP  ${doc.id} | ${data.client || data.clientName || '(no name)'}`);
        skipped++;
        continue;
      }
      await stagingRef.set(doc.data());
      const data = doc.data();
      console.log(`  COPY  ${doc.id} | ${data.client || data.clientName || '(no name)'} | J$${data.total || '—'}`);
      copied++;
    } catch (err) {
      console.error(`  ERROR ${doc.id}: ${err.message}`);
      errors++;
    }
  }

  console.log('\n=== MIGRATION COMPLETE ===');
  console.log(`  Total found in production : ${prodDocs.length}`);
  console.log(`  Copied to staging         : ${copied}`);
  console.log(`  Skipped (already existed) : ${skipped}`);
  console.log(`  Errors                    : ${errors}`);

  await Promise.all([prodApp.delete(), stagingApp.delete()]);
}

migrateOrders().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
