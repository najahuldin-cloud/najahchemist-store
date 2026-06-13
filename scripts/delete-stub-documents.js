// Script: find and delete stub documents that have ONLY vegan/natural/naturalBased fields
// Safety: never deletes any document that has a name field
// Run: node scripts/delete-stub-documents.js

const os = require('os');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'najah-chemist';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

const TAG_ONLY_FIELDS = new Set(['vegan', 'natural', 'naturalBased']);

function getToken() {
  const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const t = data.tokens;
  if (t.expires_at - Date.now() < 5 * 60 * 1000) {
    throw new Error('Token expired — run: firebase projects:list   to refresh it, then re-run this script');
  }
  return t.access_token;
}

function isStub(fields) {
  // Must have NO name field
  if (fields.name) return false;
  // All present fields must be within the tag-only set
  return Object.keys(fields).every(k => TAG_ONLY_FIELDS.has(k));
}

async function fetchAllProducts(token) {
  const results = [];
  let pageToken = null;
  do {
    const url = `${FIRESTORE_BASE}/products?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (json.error) throw new Error(`Firestore error: ${JSON.stringify(json.error)}`);
    for (const doc of json.documents || []) {
      const docId = doc.name.split('/').pop();
      const fields = doc.fields || {};
      results.push({ docId, fields, fullPath: doc.name });
    }
    pageToken = json.nextPageToken || null;
  } while (pageToken);
  return results;
}

async function deleteDoc(token, fullPath) {
  const url = `https://firestore.googleapis.com/v1/${fullPath}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete failed (${res.status}): ${text}`);
  }
}

(async () => {
  try {
    const token = getToken();
    const products = await fetchAllProducts(token);

    console.log(`Total documents fetched: ${products.length}\n`);

    const stubs = products.filter(p => isStub(p.fields));
    const safe  = products.filter(p => !isStub(p.fields));

    console.log(`Full documents (have name or other fields): ${safe.length}`);
    console.log(`Stub documents (ONLY tag fields, no name):  ${stubs.length}\n`);

    if (stubs.length === 0) {
      console.log('No stubs found. Nothing to delete.');
      return;
    }

    console.log('Stubs to delete:');
    stubs.forEach(p => {
      const fieldList = Object.keys(p.fields).join(', ');
      console.log(`  ${p.docId.padEnd(12)}  fields: { ${fieldList} }`);
    });

    console.log('\nDeleting stubs...');
    let deleted = 0;
    for (const stub of stubs) {
      await deleteDoc(token, stub.fullPath);
      console.log(`  Deleted: ${stub.docId}`);
      deleted++;
    }

    console.log(`\nDone. ${deleted} stub document${deleted !== 1 ? 's' : ''} deleted.`);
  } catch (e) {
    console.error('Script failed:', e.message);
    process.exit(1);
  }
})();
