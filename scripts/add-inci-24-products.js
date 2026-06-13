// One-time script: write `inci` field on the 24 cosmetic formula products
// missing it in the live `najah-chemist` project.
//
// Connects via firebase-admin using prod-service-account.json.
// INCI strings for 20 products lifted from scripts/update-product-inci-4.js
// (which targeted the dead `-362ad` project). The 4 marked TODO need values
// from the user before this script will run end-to-end.
//
// Run: node scripts/add-inci-24-products.js
// Dry-run preview only: node scripts/add-inci-24-products.js --dry-run

const path = require('path');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'prod-service-account.json');
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// INCI strings in descending concentration order.
const INCI = {
  // ── 20 lifted from update-product-inci-4.js (already written, never reached live project) ──
  jm1:   'Aqua, Citrus Sinensis Flower Water, Aloe Barbadensis Leaf Juice, Herbal Extract Blend, Glycerin, Hamamelis Virginiana Water, Polysorbate 20, Mentha Piperita Oil, Parfum, Lactic Acid, Sodium Lactate, Potassium Sorbate, Sodium Benzoate, Tetrasodium EDTA',
  hmi1:  'Aqua, Aloe Barbadensis Leaf Juice, Linum Usitatissimum Seed Extract, Glycerin, Fragaria Ananassa Fruit Extract, Polysorbate 20, Sodium Lactate, Herbal Extract Blend, Polyquaternium-7, Herbal Oil, Tocopherol, Chondrus Crispus Extract, Potassium Sorbate, Tetrasodium EDTA',
  payo1: 'Helianthus Annuus Seed Oil, Carica Papaya Seed Oil, Tocopherol',
  srt1:  'Aqua, Rosa Damascena Flower Water, Aloe Barbadensis Leaf Juice, Lactic Acid, Propylene Glycol, Glycerin, Cucumis Sativus Fruit Extract, Hamamelis Virginiana Water, Polysorbate 20, Herbal Extract Blend, Panax Ginseng Root Extract, Rosa Damascena Flower Oil, Hibiscus Sabdariffa Flower Extract, Rosa Damascena Flower, Potassium Sorbate',
  srem1: 'Aqua, Glycerin, Aloe Barbadensis Leaf Juice, Propylene Glycol, Stearic Acid, Cetearyl Alcohol, Cetyl Alcohol, Kojic Acid, Curcuma Longa Oil, Herbal Extract, Salicylic Acid, Lactic Acid, Alpha-Arbutin, Tocopherol, Parfum, Potassium Sorbate, Sodium Benzoate, Xanthan Gum',
  ybs1:  'Sucrose, Helianthus Annuus Seed Oil, Cocamidopropyl Betaine, Stearic Acid, Cocamide MEA, Cetearyl Alcohol, Cetyl Alcohol, Kojic Acid, Curcuma Longa Root Extract, Brightening Complex, Tocopherol, Parfum, Potassium Sorbate, Sodium Benzoate',
  slc1:  'Aqua, Glycerin, Aloe Barbadensis Leaf Juice, Propylene Glycol, Stearic Acid, Cetearyl Alcohol, Cetyl Alcohol, Citrus Limon Extract, Kojic Acid, Salicylic Acid, Tocopherol, Zinc, Allantoin, Parfum, Lactic Acid, Potassium Sorbate, Sodium Benzoate, Carbomer',
  kcs1:  'Cocos Nucifera Oil, Olea Europaea Fruit Oil, Helianthus Annuus Seed Oil, Kojic Acid, Charcoal Powder, Lavandula Angustifolia Oil',
  slbs1: 'Cocos Nucifera Oil, Olea Europaea Fruit Oil, Helianthus Annuus Seed Oil, Brightening Complex, Kojic Acid, Retinyl Palmitate, Charcoal Powder, Lavandula Angustifolia Oil',
  gas1:  'Cocos Nucifera Oil, Olea Europaea Fruit Oil, Helianthus Annuus Seed Oil, Glycolic Acid, Hibiscus Sabdariffa Flower Extract, Citrullus Lanatus Fruit Extract',
  bpw1:  'Aqua, Glycerin, Aloe Barbadensis Leaf Juice, Cocamidopropyl Betaine, Sodium Laureth Sulfate, Fragaria Ananassa Fruit Extract, Rosa Damascena Flower Water, Hibiscus Sabdariffa Flower Extract, Lactobacillus Ferment, Propylene Glycol, Citrus Sinensis Peel Extract, Boric Acid, Vaccinium Corymbosum Fruit Extract, Potassium Sorbate, Sodium Benzoate, Carbomer, Xanthan Gum',
  ls1:   'Aqua, Glycerin, Brightening Complex, Propylene Glycol, Carica Papaya Fruit Extract, Ananas Comosus Fruit Extract, Citrus Limon Fruit Extract, Calendula Officinalis Flower Extract, Tamarindus Indica Seed Extract, Alpha-Arbutin, Potassium Sorbate, Sodium Benzoate',
  hmo1:  'Aqua, Stearic Acid, Cetyl Alcohol, Glycerin, Propanediol, Aloe Barbadensis Leaf Juice, Cyclopentasiloxane, Cucumis Sativus Fruit Extract, Hamamelis Virginiana Water, Herbal Extract Blend, Hydrolyzed Rice Protein, Carbomer, Allantoin, Potassium Sorbate, Tetrasodium EDTA',
  po1:   'Propylene Glycol, Lactic Acid, Salicylic Acid, Herbal Extract Blend',
  gat1:  'Aqua, Rosa Damascena Flower Water, Aloe Barbadensis Leaf Juice, Glycerin, Cucumis Sativus Fruit Extract, Glycolic Acid, Hamamelis Virginiana Water, Herbal Extract Blend, Hibiscus Sabdariffa Flower Extract, Rosa Damascena Flower Extract, Polysorbate 80, Potassium Sorbate',
  ysh1:  'Rosa Damascena Flower, Rosmarinus Officinalis Leaf, Mentha Piperita Leaf, Calendula Officinalis Flower, Lavandula Angustifolia Flower, Ocimum Basilicum Leaf',
  ybar1: 'Cocos Nucifera Oil, Elaeis Guineensis Oil, Aqua, Sodium Hydroxide, Rosa Damascena Flower, Citrullus Lanatus Fruit Extract, Parfum',
  pays1: 'Aqua, Glycerin, Brightening Complex, Propylene Glycol, Carica Papaya Fruit Extract, Ananas Comosus Fruit Extract, Citrus Limon Fruit Extract, Calendula Officinalis Flower Extract, Tamarindus Indica Seed Extract, Alpha-Arbutin, Parfum, Potassium Sorbate, Sodium Benzoate',
  bo2:   'Helianthus Annuus Seed Oil, Prunus Amygdalus Dulcis Oil, Paraffinum Liquidum, Carica Papaya Seed Oil, Simmondsia Chinensis Seed Oil, Tocopherol, Parfum',
  yaic1: 'Aqua, Glyceryl Stearate SE, Helianthus Annuus Seed Oil, Glycerin, Cetyl Alcohol, Aloe Barbadensis Leaf Juice, Stearic Acid, Paraffinum Liquidum, Mangifera Indica Seed Butter, Butyrospermum Parkii Butter, Dimethicone, Potassium Sorbate, Parfum, Sodium Benzoate, Tocopherol, Tetrasodium EDTA, Allantoin, Xanthan Gum',

  // ── 4 added 2026-05-27 ──
  // itc1 ← copy of srem1 (per user direction)
  itc1:  'Aqua, Glycerin, Aloe Barbadensis Leaf Juice, Propylene Glycol, Stearic Acid, Cetearyl Alcohol, Cetyl Alcohol, Kojic Acid, Curcuma Longa Oil, Herbal Extract, Salicylic Acid, Lactic Acid, Alpha-Arbutin, Tocopherol, Parfum, Potassium Sorbate, Sodium Benzoate, Xanthan Gum',
  // ji1 ← copy of yaic1 (per user direction)
  ji1:   'Aqua, Glyceryl Stearate SE, Helianthus Annuus Seed Oil, Glycerin, Cetyl Alcohol, Aloe Barbadensis Leaf Juice, Stearic Acid, Paraffinum Liquidum, Mangifera Indica Seed Butter, Butyrospermum Parkii Butter, Dimethicone, Potassium Sorbate, Parfum, Sodium Benzoate, Tocopherol, Tetrasodium EDTA, Allantoin, Xanthan Gum',
  // jl1 ← copy of yo1.inci read from live Firestore on 2026-05-27
  jl1:   'Helianthus Annuus Seed Oil, Cocos Nucifera Oil, Lavandula Angustifolia Oil, Mentha Piperita Oil, Tocopherol, Cymbopogon Citratus Leaf Extract, Mentha Piperita Leaf Extract, Ocimum Basilicum Leaf Extract, Azadirachta Indica Leaf Extract, Myristica Fragrans Seed Extract, Zingiber Officinale Root Extract, Curcuma Longa Root Extract, Origanum Vulgare Leaf Extract, Rosa Damascena Flower Extract, Lavandula Angustifolia Flower Extract, Calendula Officinalis Flower Extract, Rosmarinus Officinalis Leaf Extract',
  // kos1 ← kcs1 minus Charcoal Powder and Lavandula Angustifolia Oil
  kos1:  'Cocos Nucifera Oil, Olea Europaea Fruit Oil, Helianthus Annuus Seed Oil, Kojic Acid',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const entries = Object.entries(INCI);

  console.log(`\n[add-inci] Project: ${serviceAccount.project_id}`);
  console.log(`[add-inci] Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE WRITE'}`);
  console.log(`[add-inci] Products to update: ${entries.length}\n`);

  let ok = 0, fail = 0, skipped = 0;

  for (const [docId, inci] of entries) {
    try {
      const ref = db.collection('products').doc(docId);
      const snap = await ref.get();
      if (!snap.exists) {
        console.warn(`  [SKIP]   ${docId.padEnd(8)} — doc does not exist`);
        skipped++;
        continue;
      }
      const existing = snap.data().inci;
      if (existing && String(existing).trim()) {
        console.warn(`  [SKIP]   ${docId.padEnd(8)} — inci already populated: "${String(existing).slice(0, 60)}..."`);
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  [WOULD]  ${docId.padEnd(8)} ← ${inci.slice(0, 80)}${inci.length > 80 ? '…' : ''}`);
      } else {
        await ref.update({ inci });
        console.log(`  [OK]     ${docId.padEnd(8)} ← ${inci.slice(0, 80)}${inci.length > 80 ? '…' : ''}`);
      }
      ok++;
    } catch (err) {
      console.error(`  [FAIL]   ${docId.padEnd(8)} — ${err.message}`);
      fail++;
    }
  }

  console.log(`\n[add-inci] Done. ok=${ok}  skipped=${skipped}  failed=${fail}`);
  await admin.app().delete();
}

main().catch(e => {
  console.error('[add-inci] Fatal:', e);
  process.exit(1);
});
