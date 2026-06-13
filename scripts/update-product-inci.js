// One-time script: update ingredients + inci fields on 6 products in Firestore
// Uses Firebase CLI OAuth token — no service account needed locally
// Run: node scripts/update-product-inci.js

const os = require('os');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'najah-chemist';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

const UPDATES = {
  kcs1:  'Cocos Nucifera Oil, Olea Europaea Fruit Oil, Helianthus Annuus Seed Oil, Kojic Acid, Charcoal Powder, Lavandula Angustifolia Oil',
  slbs1: 'Cocos Nucifera Oil, Olea Europaea Fruit Oil, Helianthus Annuus Seed Oil, Brightening Complex, Kojic Acid, Retinyl Palmitate, Charcoal Powder, Lavandula Angustifolia Oil',
  gas1:  'Cocos Nucifera Oil, Olea Europaea Fruit Oil, Helianthus Annuus Seed Oil, Glycolic Acid, Hibiscus Sabdariffa Flower Extract, Citrullus Lanatus Fruit Extract',
  bpw1:  'Aqua, Glycerin, Aloe Barbadensis Leaf Juice, Cocamidopropyl Betaine, Sodium Laureth Sulfate, Fragaria Ananassa Fruit Extract, Rosa Damascena Flower Water, Hibiscus Sabdariffa Flower Extract, Lactobacillus Ferment, Propylene Glycol, Citrus Sinensis Peel Extract, Boric Acid, Vaccinium Corymbosum Fruit Extract, Potassium Sorbate, Sodium Benzoate, Carbomer, Xanthan Gum',
  ls1:   'Aqua, Glycerin, Brightening Complex, Propylene Glycol, Carica Papaya Fruit Extract, Ananas Comosus Fruit Extract, Citrus Limon Fruit Extract, Calendula Officinalis Flower Extract, Tamarindus Indica Seed Extract, Alpha-Arbutin, Potassium Sorbate, Sodium Benzoate',
  yp1:   'Aloe Barbadensis Leaf Juice, Melissa Officinalis Leaf Extract, Bambusa Vulgaris Extract, Ulmus Rubra Bark Extract, Mineral Salts, Vegetable Capsule Shell',
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
