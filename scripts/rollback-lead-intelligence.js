// scripts/rollback-lead-intelligence.js
// Restores `lead_intelligence` to a snapshot's state (default: latest in
// scripts/_snapshots/). DELETES any lead_intelligence doc not present in the
// snapshot (everything the backfill created — the pre-write snapshot is empty) and
// re-writes any doc that WAS in the snapshot. NEVER touches `leads`.
//
// SAFE BY DEFAULT: dry-run unless --commit is passed.
//   node scripts/rollback-lead-intelligence.js            (dry-run)
//   node scripts/rollback-lead-intelligence.js --commit   (execute)
//   node scripts/rollback-lead-intelligence.js --file=<snapshot path>

const os = require('os');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'najah-chemist';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const SNAP_DIR = path.join(__dirname, '_snapshots');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const fileArg = (args.find(a => a.startsWith('--file=')) || '').split('=')[1];

function getToken() {
  const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const t = data.tokens;
  if (!t || !t.access_token) throw new Error('No Firebase CLI token — run: firebase login');
  if (t.expires_at - Date.now() < 5 * 60 * 1000) {
    throw new Error('Token near expiry — run: firebase projects:list  to refresh, then re-run');
  }
  return t.access_token;
}

function latestSnapshot() {
  if (fileArg) return fileArg;
  if (!fs.existsSync(SNAP_DIR)) throw new Error(`No snapshot dir: ${SNAP_DIR}`);
  const files = fs.readdirSync(SNAP_DIR)
    .filter(f => /^lead-intelligence-snapshot-.*\.json$/.test(f)).sort();
  if (!files.length) throw new Error('No snapshot found — run backup-lead-intelligence.js first');
  return path.join(SNAP_DIR, files[files.length - 1]);
}

async function listIntelIds(token) {
  const ids = [];
  let pageToken = '';
  do {
    const url = `${BASE}/lead_intelligence?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list lead_intelligence ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const d of (data.documents || [])) ids.push(d.name.split('/').pop());
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return ids;
}

async function del(token, id) {
  const res = await fetch(`${BASE}/lead_intelligence/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`delete ${id} ${res.status}: ${await res.text()}`);
}

async function restore(token, id, fields) {
  const res = await fetch(`${BASE}/lead_intelligence/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`restore ${id} ${res.status}: ${await res.text()}`);
}

(async () => {
  const token = getToken();
  const snapFile = latestSnapshot();
  const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  const snapIntel = ((snap.collections || {}).lead_intelligence || {}).documents || [];
  const snapIds = new Set(snapIntel.map(d => d.id));

  const currentIds = await listIntelIds(token);
  const toDelete = currentIds.filter(id => !snapIds.has(id));

  console.log('=== ROLLBACK', COMMIT ? '(COMMIT)' : '(DRY-RUN)', '===');
  console.log('Snapshot file          :', snapFile);
  console.log('Snapshot intel docs    :', snapIntel.length);
  console.log('Current intel docs     :', currentIds.length);
  console.log('Will DELETE            :', toDelete.length, toDelete.slice(0, 10));
  console.log('Will RESTORE           :', snapIntel.length);
  console.log('leads collection       : NOT TOUCHED');

  if (!COMMIT) {
    console.log('\nDRY-RUN only — no writes. Re-run with --commit to execute the rollback.');
    return;
  }

  let nd = 0, nr = 0;
  for (const id of toDelete) { await del(token, id); nd++; }
  for (const d of snapIntel) { await restore(token, d.id, d.fields); nr++; }
  console.log(`\nDONE — deleted ${nd}, restored ${nr}. lead_intelligence rolled back to snapshot.`);
})().catch(e => { console.error('ROLLBACK FAILED:', e.message); process.exit(1); });
