// One-time script: update ingredients + inci fields on 17 products in Firestore
// Uses Firebase CLI OAuth token — no service account needed locally
// Run: node scripts/update-product-inci-3.js

const os = require('os');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'najah-chemist';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

const UPDATES = {
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
  yp1:   'Aloe Barbadensis Leaf Juice, Melissa Officinalis Leaf Extract, Bambusa Vulgaris Extract, Ulmus Rubra Bark Extract, Mineral Salts, Vegetable Capsule Shell',
  hmo1:  'Aqua, Stearic Acid, Cetyl Alcohol, Glycerin, Propanediol, Aloe Barbadensis Leaf Juice, Cyclopentasiloxane, Cucumis Sativus Fruit Extract, Hamamelis Virginiana Water, Herbal Extract Blend, Hydrolyzed Rice Protein, Carbomer, Allantoin, Potassium Sorbate, Tetrasodium EDTA',
  po1:   'Propylene Glycol, Lactic Acid, Salicylic Acid, Herbal Extract Blend',
  gat1:  'Aqua, Rosa Damascena Flower Water, Aloe Barbadensis Leaf Juice, Glycerin, Cucumis Sativus Fruit Extract, Glycolic Acid, Hamamelis Virginiana Water, Herbal Extract Blend, Hibiscus Sabdariffa Flower Extract, Rosa Damascena Flower Extract, Polysorbate 80, Potassium Sorbate',
  ysh1:  'Rosa Damascena Flower, Rosmarinus Officinalis Leaf, Mentha Piperita Leaf, Calendula Officinalis Flower, Lavandula Angustifolia Flower, Ocimum Basilicum Leaf',
};

function getToken() {
  const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const t = data.tokens;
  if (t.expires_at - Date.now() < 5 * 60 * 1000) {
    throw new Error('Token expired — run: firebase projects:list   to refresh it, then re-run this script');
  }
  return t.access_token;
}

async function updateProduct(token, docId, inci) {
  const url =
    `${FIRESTORE_BASE}/products/${docId}` +
    `?updateMask.fieldPaths=ingredients&updateMask.fieldPaths=inci`;

  const body = {
    fields: {
      ingredients: { stringValue: inci },
      inci:        { stringValue: inci },
    },
  };

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (json.error) throw new Error(`Firestore error for ${docId}: ${JSON.stringify(json.error)}`);
  console.log(`Updated: ${docId}`);
}

(async () => {
  try {
    const token = getToken();
    let count = 0;
    for (const [docId, inci] of Object.entries(UPDATES)) {
      await updateProduct(token, docId, inci);
      count++;
    }
    console.log(`\nDone. ${count} products updated.`);
  } catch (e) {
    console.error('Script failed:', e.message);
    process.exit(1);
  }
})();
