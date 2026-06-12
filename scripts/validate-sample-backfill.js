// scripts/validate-sample-backfill.js — READ-ONLY validation of the --limit 10 sample
// backfill. NO WRITES. Confirms (a) the backfill modified NO existing `leads` doc
// (the "changed updateTime" guard is explained by new leads only), and (b) each written
// lead_intelligence doc matches a fresh local recompute (score/label/isTest/dup fields).
// Run: node scripts/validate-sample-backfill.js

const os = require('os');
const fs = require('fs');
const path = require('path');
const { buildIntelligence } = require('../functions/agents/lead-agent/score');
const { buildDuplicateIndex } = require('../functions/agents/_shared/duplicates');
const { normEmail, normPhone } = require('../functions/agents/_shared/data-quality');
const { cleanName } = require('../functions/agents/_shared/names');

const PROJECT_ID = 'najah-chemist';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const SNAP_DIR = path.join(__dirname, '_snapshots');
const ALL = process.argv.includes('--all');
const LIMIT = ALL ? Infinity : 10;

function getToken() { return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')).tokens.access_token; }
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
  return null;
}
function fromFields(f) { const o = {}; for (const [k, val] of Object.entries(f)) o[k] = fromValue(val); return o; }
async function listCollection(token, c) {
  const docs = []; let pt = '';
  do {
    const url = `${BASE}/${c}?pageSize=300${pt ? `&pageToken=${encodeURIComponent(pt)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list ${c} ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const d of (data.documents || [])) docs.push({ id: d.name.split('/').pop(), data: fromFields(d.fields || {}), updateTime: d.updateTime });
    pt = data.nextPageToken || '';
  } while (pt);
  return docs;
}
function latestSnapshot() {
  const files = fs.readdirSync(SNAP_DIR).filter(f => /^lead-intelligence-snapshot-.*\.json$/.test(f)).sort();
  return path.join(SNAP_DIR, files[files.length - 1]);
}

(async () => {
  const token = getToken();
  const leads = await listCollection(token, 'leads');
  const intel = await listCollection(token, 'lead_intelligence');
  const intelById = new Map(intel.map(d => [d.id, d.data]));

  // ── A. Did the backfill modify any EXISTING lead? ──────────────────────────────
  const snapFile = latestSnapshot();
  const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  const snapLeads = ((snap.collections || {}).leads || {}).documents || [];
  const snapMap = new Map(snapLeads.map(d => [d.id, d.updateTime]));
  const newLeads = [], modifiedLeads = [];
  for (const l of leads) {
    if (!snapMap.has(l.id)) newLeads.push(l);                       // not in snapshot → new
    else if (snapMap.get(l.id) !== l.updateTime) modifiedLeads.push(l); // existing but changed
  }
  console.log('════ A. LEADS-UNTOUCHED CHECK (vs snapshot) ════');
  console.log(`  Snapshot leads: ${snapLeads.length} | current leads: ${leads.length}`);
  console.log(`  NEW leads since snapshot (organic): ${newLeads.length}  ${newLeads.map(l => l.id + ' (' + cleanName(l.data.name) + ')').join(', ')}`);
  console.log(`  MODIFIED existing leads: ${modifiedLeads.length}  ${modifiedLeads.map(l => l.id).join(', ')}`);
  console.log(`  VERDICT: ${modifiedLeads.length === 0 ? '✅ backfill modified NO existing lead — the guard count is explained by new organic leads only' : '⛔ EXISTING LEAD(S) MODIFIED — investigate'}`);

  // ── B. Validate the 10 written intel docs against a fresh local recompute ──────
  // Dup index across the FULL current base (same as the backfill did).
  const dupIdx = buildDuplicateIndex(leads.map(l => ({ id: l.id, lead: l.data })));
  const now = Date.now();
  // The backfill wrote allLeads.slice(0, LIMIT) in Firestore name order — replicate.
  const ordered = leads.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sample = ordered.slice(0, LIMIT);

  const CMP = ['score', 'scoreLabel', 'isTest', 'testReason', 'suspiciousLead', 'isPrimaryRecord', 'duplicateCount', 'expectedValue', 'recommendedOffer', 'recommendationVersion'];
  console.log('\n════ B. WRITTEN-RECORD VALIDATION (stored vs local recompute) ════');
  console.log('  ID                    Name               score label isTest  prim dupN  EV          v   match');
  const discrepancies = [];
  let writtenFound = 0;
  for (const l of sample) {
    const ctx = {
      dup: dupIdx.index.get(l.id),
      sharedEmail: dupIdx.sharedEmailKeys.has(normEmail(l.data.email)),
      sharedPhone: dupIdx.sharedPhoneKeys.has(normPhone(l.data.whatsapp)),
    };
    const local = buildIntelligence(l.data, l.id, null, now, ctx);
    const stored = intelById.get(l.id);
    if (!stored) { discrepancies.push(`${l.id}: NO stored intel doc found`); continue; }
    writtenFound++;
    const diffs = CMP.filter(k => JSON.stringify(stored[k]) !== JSON.stringify(local[k]));
    if (diffs.length) discrepancies.push(`${l.id} (${cleanName(l.data.name)}): ${diffs.map(k => `${k} stored=${JSON.stringify(stored[k])} local=${JSON.stringify(local[k])}`).join('; ')}`);
    const m = diffs.length ? '⚠ ' + diffs.join(',') : '✅';
    if (!ALL) console.log(`  ${l.id}  ${cleanName(l.data.name).slice(0,17).padEnd(17)} ${String(stored.score).padStart(5)} ${String(stored.scoreLabel).padEnd(5)} ${String(stored.isTest).padEnd(6)} ${String(stored.isPrimaryRecord).padEnd(4)} ${String(stored.duplicateCount).padStart(3)}  J$${Number(stored.expectedValue||0).toLocaleString('en-US').padStart(8)}  v${stored.recommendationVersion} ${m}`);
  }

  console.log('\n════ SUMMARY ════');
  console.log(`  Written intel docs found for sample: ${writtenFound}/${sample.length}`);
  console.log(`  isTest among sample: ${sample.filter(l => intelById.get(l.id) && intelById.get(l.id).isTest).length}`);
  console.log(`  Discrepancies: ${discrepancies.length}`);
  discrepancies.forEach(d => console.log('   ⚠ ' + d));
  if (!discrepancies.length && modifiedLeads.length === 0) console.log('  ✅ ALL CLEAR — 10 records match recompute; no existing lead modified.');
})().catch(e => { console.error('VALIDATION FAILED:', e.message); process.exit(1); });
