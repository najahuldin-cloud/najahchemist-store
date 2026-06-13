// One-time script: update ingredients + inci fields on 3 products in Firestore
// Uses Firebase CLI OAuth token — no service account needed locally
// Run: node scripts/update-product-inci-2.js

const os = require('os');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'najah-chemist';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

const UPDATES = {
  srem1: 'Aqua, Glycerin, Aloe Barbadensis Leaf Juice, Propylene Glycol, Stearic Acid, Cetearyl Alcohol, Cetyl Alcohol, Kojic Acid, Curcuma Longa Oil, Herbal Extract, Salicylic Acid, Lactic Acid, Alpha-Arbutin, Tocopherol, Parfum, Potassium Sorbate, Sodium Benzoate, Xanthan Gum',
  ybs1:  'Sucrose, Helianthus Annuus Seed Oil, Cocamidopropyl Betaine, Stearic Acid, Cocamide MEA, Cetearyl Alcohol, Cetyl Alcohol, Kojic Acid, Curcuma Longa Root Extract, Brightening Complex, Tocopherol, Parfum, Potassium Sorbate, Sodium Benzoate',
  slc1:  'Aqua, Glycerin, Aloe Barbadensis Leaf Juice, Propylene Glycol, Stearic Acid, Cetearyl Alcohol, Cetyl Alcohol, Citrus Limon Extract, Kojic Acid, Salicylic Acid, Tocopherol, Zinc, Allantoin, Parfum, Lactic Acid, Potassium Sorbate, Sodium Benzoate, Carbomer',
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
