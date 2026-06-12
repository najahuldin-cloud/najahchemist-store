// scripts/backfill-lead-scores.js
// Scores leads with the deterministic engine (functions/agents/lead-agent/score.js)
// and writes one lead_intelligence/{leadId} doc per lead. Writes ONLY
// lead_intelligence — never `leads`.
//
// Safety:
//   * ABORTS unless a snapshot exists in scripts/_snapshots/ (backup-first gate).
//   * Idempotent — keyed by leadId; deterministic scoring overwrites cleanly on re-run.
//   * --limit N processes only the first N leads (for a gated trial).
//   * After writing, re-lists `leads` and confirms 0 updateTimes changed.
//
// Run:  node scripts/backfill-lead-scores.js --limit 10
//       node scripts/backfill-lead-scores.js                (full)

const os = require('os');
const fs = require('fs');
const path = require('path');
const { buildIntelligence } = require('../functions/agents/lead-agent/score');
const { cleanName } = require('../functions/agents/_shared/names');
const { buildDuplicateIndex } = require('../functions/agents/_shared/duplicates');
const { normEmail, normPhone } = require('../functions/agents/_shared/data-quality');

const PROJECT_ID = 'najah-chemist';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const SNAP_DIR = path.join(__dirname, '_snapshots');

const args = process.argv.slice(2);
let LIMIT = 0;
const li = args.indexOf('--limit');
if (li !== -1 && args[li + 1]) LIMIT = parseInt(args[li + 1], 10);
const eq = (args.find(a => a.startsWith('--limit=')) || '').split('=')[1];
if (eq) LIMIT = parseInt(eq, 10);

function getToken() {
  const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const t = data.tokens;
  if (!t || !t.access_token) throw new Error('No Firebase CLI token — run: firebase login');
  if (t.expires_at - Date.now() < 5 * 60 * 1000) {
    throw new Error('Token near expiry — run: firebase projects:list  to refresh, then re-run');
  }
  return t.access_token;
}

function latestSnapshotFile() {
  if (!fs.existsSync(SNAP_DIR)) return null;
  const files = fs.readdirSync(SNAP_DIR)
    .filter(f => /^lead-intelligence-snapshot-.*\.json$/.test(f)).sort();
  return files.length ? path.join(SNAP_DIR, files[files.length - 1]) : null;
}

// ── Firestore <-> JS conversion ───────────────────────────────────────────────
function fromValue(v) {
  if (!v || typeof v !== 'object') return v;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}
function fromFields(fields) {
  const o = {};
  for (const [k, val] of Object.entries(fields)) o[k] = fromValue(val);
  return o;
}
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toValue(v);
  return fields;
}

async function listCollection(token, collectionId) {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${BASE}/${collectionId}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list ${collectionId} ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const d of (data.documents || [])) {
      docs.push({ id: d.name.split('/').pop(), data: fromFields(d.fields || {}), updateTime: d.updateTime });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function writeIntel(token, id, obj) {
  const res = await fetch(`${BASE}/lead_intelligence/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(obj) }),
  });
  if (!res.ok) throw new Error(`write ${id} ${res.status}: ${await res.text()}`);
}

(async () => {
  const snapFile = latestSnapshotFile();
  if (!snapFile) {
    console.error('ABORT: no snapshot in scripts/_snapshots/. Run backup-lead-intelligence.js first.');
    process.exit(1);
  }

  const token = getToken();

  // Existing intel (for scoreTrend + idempotent re-runs).
  const existing = await listCollection(token, 'lead_intelligence');
  const prevMap = new Map(existing.map(d => [d.id, d.data]));

  // Source leads (never modified).
  const allLeads = await listCollection(token, 'leads');
  const total = allLeads.length;

  // Duplicate index + shared-contact sets are computed across the FULL lead base
  // (NOT the limited batch) — identical to the audit and the scoreLeads Cloud
  // Function. Without this, every lead is written as a unique primary record and
  // shared_contact test detection never fires.
  const dupIdx = buildDuplicateIndex(allLeads.map(l => ({ id: l.id, lead: l.data })));

  const batch = LIMIT > 0 ? allLeads.slice(0, LIMIT) : allLeads;

  const now = Date.now();
  const dist = { Cold: 0, Warm: 0, Hot: 0, Ready: 0 };
  const rows = [];
  const failures = [];
  for (const l of batch) {
    try {
      const ctx = {
        dup: dupIdx.index.get(l.id),
        sharedEmail: dupIdx.sharedEmailKeys.has(normEmail(l.data.email)),
        sharedPhone: dupIdx.sharedPhoneKeys.has(normPhone(l.data.whatsapp)),
      };
      const intel = buildIntelligence(l.data, l.id, prevMap.get(l.id), now, ctx);
      await writeIntel(token, l.id, { ...intel, lastScoredAt: new Date(now) });
      dist[intel.scoreLabel] = (dist[intel.scoreLabel] || 0) + 1;
      rows.push({
        id: l.id, name: cleanName(l.data.name), score: intel.score, label: intel.scoreLabel,
        offer: intel.recommendedOffer, downsell: intel.downsellCandidate, EV: intel.expectedValue,
      });
    } catch (e) {
      // One failure must not abort the batch — record and continue.
      failures.push({ id: l.id, name: (l.data && l.data.name) || '(none)', error: e.message });
    }
  }
  const top5 = rows.slice().sort((a, b) => b.EV - a.EV).slice(0, 5);

  // Verify `leads` untouched: compare updateTimes against the snapshot baseline.
  const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  const snapLeads = ((snap.collections || {}).leads || {}).documents || [];
  const snapMap = new Map(snapLeads.map(d => [d.id, d.updateTime]));
  const after = await listCollection(token, 'leads');
  let changed = 0;
  for (const l of after) if (snapMap.get(l.id) !== l.updateTime) changed++;

  console.log('=== BACKFILL COMPLETE ===');
  console.log('Snapshot gate              :', path.basename(snapFile));
  console.log('Total leads                :', total);
  console.log('Limit                      :', LIMIT > 0 ? LIMIT : '(none — full)');
  console.log('lead_intelligence written  :', rows.length);
  console.log('Failed / skipped           :', failures.length);
  console.log('Score-label distribution   : Cold', dist.Cold, '| Warm', dist.Warm, '| Hot', dist.Hot, '| Ready', dist.Ready);
  console.log('');
  console.log('leads count (snapshot/now) :', snapLeads.length, '/', after.length);
  console.log('leads w/ changed updateTime:', changed, changed === 0 ? '✅ source leads NOT modified' : '⚠️ CHANGED');
  console.log('');
  console.log('Top 5 leads by expectedValue:');
  for (const r of top5) {
    console.log(`  ${r.id}  ${r.label.padEnd(5)} ${r.offer.padEnd(18)} EV J$${Number(r.EV).toLocaleString('en-US').padStart(9)}  ${r.name}`);
  }
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f.id}  ${f.name}  — ${f.error}`);
  } else {
    console.log('\nNo failures or skips — every lead scored and written.');
  }
})().catch(e => { console.error('BACKFILL FAILED:', e.message); process.exit(1); });
