// scripts/backup-lead-intelligence.js
// READ-ONLY pre-backfill snapshot. Captures `leads` (reference) and
// `lead_intelligence` (the backfill write target) to scripts/_snapshots/<ts>.json
// so the backfill can be rolled back. Makes NO writes.
//
// Auth: Firebase CLI OAuth token (same pattern as insert-missing-orders.js).
// Run:  node scripts/backup-lead-intelligence.js

const os = require('os');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'najah-chemist';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const SNAP_DIR = path.join(__dirname, '_snapshots');

function getToken() {
  const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const t = data.tokens;
  if (!t || !t.access_token) throw new Error('No Firebase CLI token — run: firebase login');
  if (t.expires_at - Date.now() < 5 * 60 * 1000) {
    throw new Error('Token near expiry — run: firebase projects:list  to refresh, then re-run');
  }
  return t.access_token;
}

// Lists every document in a collection, following nextPageToken (handles 561+ leads).
async function listCollection(token, collectionId) {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${BASE}/${collectionId}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list ${collectionId} ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const d of (data.documents || [])) {
      docs.push({ id: d.name.split('/').pop(), fields: d.fields || {}, updateTime: d.updateTime });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

(async () => {
  const token = getToken();
  const leads = await listCollection(token, 'leads');
  const intel = await listCollection(token, 'lead_intelligence');

  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SNAP_DIR, `lead-intelligence-snapshot-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({
    project: PROJECT_ID,
    takenAt: new Date().toISOString(),
    collections: {
      leads:             { count: leads.length, documents: leads },
      lead_intelligence: { count: intel.length, documents: intel },
    },
  }, null, 2));

  console.log('=== BACKUP SNAPSHOT COMPLETE (read-only, no writes) ===');
  console.log('Snapshot file          :', file);
  console.log('leads documents        :', leads.length);
  console.log('lead_intelligence docs :', intel.length);
  console.log('Snapshot size (bytes)  :', fs.statSync(file).size);
})().catch(e => { console.error('BACKUP FAILED:', e.message); process.exit(1); });
