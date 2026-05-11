// Read-only script: list products where ingredients is empty, null, or missing
// Run: node scripts/check-missing-ingredients.js

const os = require('os');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'najah-chemist-362ad';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

function getToken() {
  const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const t = data.tokens;
  if (t.expires_at - Date.now() < 5 * 60 * 1000) {
    throw new Error('Token expired — run: firebase projects:list   to refresh it, then re-run this script');
  }
  return t.access_token;
}

function getString(fields, key) {
  return fields?.[key]?.stringValue ?? null;
}

async function fetchAllProducts(token) {
  const results = [];
  let pageToken = null;

  do {
    const url = `${FIRESTORE_BASE}/products?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (json.error) throw new Error(`Firestore error: ${JSON.stringify(json.error)}`);

    for (const doc of json.documents || []) {
      const docId = doc.name.split('/').pop();
      const fields = doc.fields || {};
      const name = getString(fields, 'name') || getString(fields, 'title') || getString(fields, 'productName') || getString(fields, 'displayName') || Object.keys(fields).join(', ') || '—';
      const ingredients = getString(fields, 'ingredients');
      results.push({ docId, name, ingredients });
    }

    pageToken = json.nextPageToken || null;
  } while (pageToken);

  return results;
}

(async () => {
  try {
    const token = getToken();
    const products = await fetchAllProducts(token);

    const missing = products.filter(p => !p.ingredients || p.ingredients.trim() === '');

    console.log(`Total products fetched: ${products.length}`);
    console.log(`Products with missing/empty ingredients: ${missing.length}\n`);

    if (missing.length === 0) {
      console.log('All products have ingredients. ✓');
    } else {
      missing.forEach(p => {
        const status = p.ingredients === null ? 'MISSING' : 'EMPTY';
        console.log(`[${status}]  ${p.docId.padEnd(12)}  ${p.name}`);
      });
    }
  } catch (e) {
    console.error('Script failed:', e.message);
    process.exit(1);
  }
})();
