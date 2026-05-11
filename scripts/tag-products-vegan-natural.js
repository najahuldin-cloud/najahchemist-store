// One-time script: add vegan/natural/naturalBased fields to Firestore products
// Uses Firebase CLI OAuth token — no service account needed locally
// Run: node scripts/tag-products-vegan-natural.js

const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ID = 'najah-chemist-362ad';
const COLLECTION = 'products';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

// ── product groups ────────────────────────────────────────────────────────────

const GROUPS = [
  {
    label: 'vegan:true, natural:true, naturalBased:false',
    ids: ['yo1', 'yop1', 'bo1', 'hgo1', 'ros1', 'gls1', 'kts1', 'tos1'],
    fields: { vegan: true, natural: true, naturalBased: false },
  },
  {
    label: 'vegan:true, natural:false, naturalBased:true',
    ids: ['bb1', 'bbal1', 'bsc1', 'bbb1', 'bbs1', 'hbu1', 'has1', 'tfc1', 'tfm1', 'tfs1', 'yw1', 'yfs1', 'vm1', 'rw1', 'vcs1', 'sas1', 'paps1'],
    fields: { vegan: true, natural: false, naturalBased: true },
  },
  {
    label: 'vegan:false, natural:true, naturalBased:false',
    ids: ['bac1'],
    fields: { vegan: false, natural: true, naturalBased: false },
  },
  {
    label: 'vegan:true, natural:false, naturalBased:true (charcoal soap)',
    ids: ['kcs1'],
    fields: { vegan: true, natural: false, naturalBased: true },
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function getToken() {
  const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const t = data.tokens;
  if (t.expires_at - Date.now() < 5 * 60 * 1000) {
    throw new Error('Token expired — run: firebase projects:list   to refresh it, then re-run this script');
  }
  return t.access_token;
}

function toFirestoreValue(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  throw new Error(`Unsupported value type: ${typeof v}`);
}

function request(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function patchProduct(token, docId, fields) {
  const fieldKeys = Object.keys(fields);
  const maskParams = fieldKeys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const url = `${FIRESTORE_BASE}/${COLLECTION}/${docId}?${maskParams}`;

  const firestoreFields = {};
  for (const [k, v] of Object.entries(fields)) {
    firestoreFields[k] = toFirestoreValue(v);
  }

  await request('PATCH', url, token, { fields: firestoreFields });
}

// ── main ──────────────────────────────────────────────────────────────────────

(async () => {
  const token = getToken();
  let updated = 0;
  let failed = 0;

  for (const group of GROUPS) {
    console.log(`\n── ${group.label} (${group.ids.length} products)`);
    for (const id of group.ids) {
      try {
        await patchProduct(token, id, group.fields);
        console.log(`  ✓ ${id}`);
        updated++;
      } catch (err) {
        console.error(`  ✗ ${id} — ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n── Done. Updated: ${updated}  Failed: ${failed}`);
})();
