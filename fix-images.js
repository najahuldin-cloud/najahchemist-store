#!/usr/bin/env node
// fix-images.js
// One-time script: updates img field on all 58 products in najah-chemist-staging
// using Fygaro CDN URLs extracted from migrate-products.js.
// Matches documents by legacyId field.

import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';

const STAGING_PROJECT_ID = 'najah-chemist-staging';

const localFile = new URL('./staging-service-account.json', import.meta.url)
  .pathname.replace(/^\/([A-Z]:)/, '$1');

if (!existsSync(localFile)) {
  console.error('ERROR: staging-service-account.json not found.');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(localFile, 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: STAGING_PROJECT_ID,
});
const db = admin.firestore();

// ── img URLs extracted from migrate-products.js (58 products) ──────────────
const IMG_MAP = {
  yw1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/338703/t/14dbe12b-0de5-4f29-9405-231584401f03.png',
  yfs1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/376412/t/9d125b94-6f37-4e1a-96c5-cb0cbcbb93c4.png',
  ybs1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/376412/t/9d125b94-6f37-4e1a-96c5-cb0cbcbb93c4.png',
  yo1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/339002/t/547d1805-2623-4889-b140-330b25077236.png',
  yop1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/339002/t/547d1805-2623-4889-b140-330b25077236.png',
  vm1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345765/t/ab10dc7a-1117-40d1-b270-5ce41e9f08f4.png',
  bpw1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/346264/73454ae2-a5af-4290-a45b-f9a4f98c6a4d.png',
  yp1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/338704/5733fcb5-c9b7-4052-9a10-9c3adedc95ab.png',
  bac1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/282958/f297e311-1ee4-41b5-b388-8b89e013d5dd.png',
  itc1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359778/t/a322f6ef-de28-4a83-801b-73d80a00bde4.png',
  yaic1: 'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359776/t/bec7487b-e791-4f35-86dd-a5b150d73981.png',
  ybar1: 'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/338707/t/5d1ddb21-10b9-49c0-874d-472907de68c7.png',
  ysh1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345764/f3b89696-adac-4705-aede-79153962a433.png',
  fd1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/381469/t/6a59db10-8c36-4f15-b8fa-d86c2101f53a.png',
  mac1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345767/6c970dd0-6e2c-4799-817a-7b5804b74b1b.jpeg',
  srt1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359770/t/30073a64-2c40-4a81-aa0d-e525309c351b.png',
  gat1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359771/t/fcf449bf-9191-4574-a30d-4661eedb36d8.png',
  tfc1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359773/t/8d01327a-0f77-4d52-b149-546bbf500ec4.png',
  po1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/409753/t/1ca3dc5d-7a0e-4c76-8cbb-97a66e322c56.png',
  ls1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359775/t/c9bbf70b-d106-4a16-bea7-148de03cd387.png',
  has1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/338065/t/a121d985-547f-4cb0-8628-069376c29818.png',
  ros1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359777/t/efd64c0e-d6b7-433f-ae82-1060014f8203.png',
  pays1: 'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359777/t/4c201f72-7ddc-4aa0-b9b5-c05a5464fcd3.png',
  payo1: 'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359777/t/efd64c0e-d6b7-433f-ae82-1060014f8203.png',
  hmo1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359772/t/c68c5ddc-87d8-46af-b154-ce233ad4ffff.png',
  srem1: 'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359791/t/d2e40fb6-7d30-403b-8e56-be96623c475d.png',
  slc1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359776/t/77f214ad-93c5-453a-bc2a-97f8de3a5a20.png',
  tfs1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359780/t/efd31aca-3926-49d2-b110-9dd1fe2a7d1d.png',
  tfm1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/367919/t/77bb7ea0-d021-4e5c-acb9-bfc7cfc7eb22.png',
  bsc1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/338710/t/faf94a64-3f52-4b62-a014-0594be6e78fc.png',
  bbs1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/338710/t/b201b686-3c0a-4ae4-b5b7-02bde481ebed.png',
  bb1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/409754/t/8351e547-21a2-45ad-b265-5e1fc8d4e8b2.png',
  bbb1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/338897/t/1f777bad-2676-444a-9324-cd1b6aa90289.png',
  gls1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/338707/t/5d1ddb21-10b9-49c0-874d-472907de68c7.png',
  kts1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/339006/t/5dfcbc18-d76c-4588-8473-e27eb01b6675.jpeg',
  sas1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359792/t/e2e38ae4-ce04-454e-8956-7b739aaf1bb9.png',
  gas1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/409755/t/9505b613-2199-49fb-ab15-6b5fdb6ad905.png',
  vcs1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/339006/t/5dfcbc18-d76c-4588-8473-e27eb01b6675.jpeg',
  paps1: 'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/339006/t/5dfcbc18-d76c-4588-8473-e27eb01b6675.jpeg',
  tos1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/339006/t/5dfcbc18-d76c-4588-8473-e27eb01b6675.jpeg',
  kos1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/339006/t/5dfcbc18-d76c-4588-8473-e27eb01b6675.jpeg',
  kcs1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/339006/t/5dfcbc18-d76c-4588-8473-e27eb01b6675.jpeg',
  slbs1: 'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/442088/f8b57fd4-0a02-4b1d-806d-a236ca240c5f.jpg',
  bbal1: 'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345768/t/00fb8220-e417-4043-b3ad-c782aa4a9523.png',
  bsh1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345769/156ed3d1-f095-45ca-86ae-12eee756e874.png',
  bo1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345770/855cb420-3966-446f-89b9-dda58b73d690.png',
  rw1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/391658/4b63949c-1955-4a06-9e59-01b1faca3a39.png',
  jl1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/409725/t/e2523d13-5bf2-4f1d-9612-05a7ba73f22c.png',
  jm1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/409726/t/3a7fa0c0-5c2d-4359-acdf-f88b87cdf57c.png',
  ji1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359776/t/bec7487b-e791-4f35-86dd-a5b150d73981.png',
  hmi1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345768/t/00fb8220-e417-4043-b3ad-c782aa4a9523.png',
  hbu1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345768/t/00fb8220-e417-4043-b3ad-c782aa4a9523.png',
  hgo1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345768/t/00fb8220-e417-4043-b3ad-c782aa4a9523.png',
  skb1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/359546/t/d8a06754-f8cb-4676-9278-11940bc86e62.jpg',
  gni1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/374322/t/bf955751-057c-4d14-9061-2d9a6b8742b6.png',
  mcb1:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345768/1cea354e-4dd7-4d21-a521-fdb19711dcd8.png',
  skb2:  'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/345768/1cea354e-4dd7-4d21-a521-fdb19711dcd8.png',
  ld1:   'https://fygaro-subscribers.s3.amazonaws.com/40341bc0-0b62-4026-8b33-b7b7f2ee55a3/products/373598/t/51641546-95bb-4857-ba4b-7cccced40e93.png',
};

async function fixImages() {
  console.log(`\nNajah Chemist — Fix img fields in najah-chemist-staging`);
  console.log(`Products in IMG_MAP: ${Object.keys(IMG_MAP).length}\n`);

  const snap = await db.collection('products').get();
  console.log(`Firestore documents found: ${snap.size}\n`);

  let updated = 0, skipped = 0, noMatch = 0;
  const unmatched = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const legacyId = data.legacyId || docSnap.id;
    const img = IMG_MAP[legacyId];

    if (!img) {
      console.log(`  ⚠  no img mapping for legacyId="${legacyId}" (doc: ${docSnap.id}, name: ${data.name})`);
      unmatched.push(legacyId);
      noMatch++;
      continue;
    }

    if (data.img === img) {
      console.log(`  –  ${data.name || docSnap.id}  (already correct, skipping)`);
      skipped++;
      continue;
    }

    await docSnap.ref.update({ img });
    console.log(`  ✓  ${data.name || docSnap.id}  →  ${img}`);
    updated++;
  }

  console.log(`\n──────────────────────────────────────`);
  console.log(`Updated : ${updated}`);
  console.log(`Skipped : ${skipped} (already had correct img)`);
  console.log(`No match: ${noMatch}`);
  if (unmatched.length) console.log(`Unmatched legacyIds: ${unmatched.join(', ')}`);
  console.log(`\nVerify: https://console.firebase.google.com/project/najah-chemist-staging/firestore/data/products`);
  process.exit(noMatch > 0 ? 1 : 0);
}

fixImages().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
