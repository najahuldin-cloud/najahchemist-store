// scripts/project-v4-distribution.js — READ-ONLY v4 projection. Loads `leads` +
// current `lead_intelligence` (v3), recomputes every lead with the local v4 engine
// IN MEMORY, and reports the projected distribution + the v3→v4 shift. NO WRITES.
//
// Run: node scripts/project-v4-distribution.js

const os = require('os');
const fs = require('fs');
const path = require('path');
const { buildIntelligence } = require('../functions/agents/lead-agent/score');
const { cleanName } = require('../functions/agents/_shared/names');
const { buildDuplicateIndex } = require('../functions/agents/_shared/duplicates');
const { normEmail, normPhone } = require('../functions/agents/_shared/data-quality');
const S = require('../functions/agents/_shared/scoring');

const PROJECT_ID = 'najah-chemist';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const LABELS = ['Cold', 'Warm', 'Hot', 'Ready'];

function getToken() {
  const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  return data.tokens.access_token;
}
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
    for (const d of (data.documents || [])) docs.push({ id: d.name.split('/').pop(), data: fromFields(d.fields || {}) });
    pt = data.nextPageToken || '';
  } while (pt);
  return docs;
}
const emptyDist = () => ({ Cold: 0, Warm: 0, Hot: 0, Ready: 0 });

(async () => {
  const token = getToken();
  const leads = await listCollection(token, 'leads');
  const intel = await listCollection(token, 'lead_intelligence');   // current v3 labels
  const v3Label = new Map(intel.map(d => [d.id, d.data.scoreLabel]));

  // Duplicate index + shared-contact sets across the FULL lead base — matches the
  // canonical audit, the Cloud Function, and the backfill (so isTest/shared_contact
  // and the Ready≤8% gate are computed on the same test-set the backfill will write).
  const dupIdx = buildDuplicateIndex(leads.map(l => ({ id: l.id, lead: l.data })));

  const now = Date.now();
  const realDist = emptyDist();
  const testDist = emptyDist();
  const v4 = emptyDist();
  let isTestCount = 0;
  const all = [];
  for (const l of leads) {
    const ctx = {
      dup: dupIdx.index.get(l.id),
      sharedEmail: dupIdx.sharedEmailKeys.has(normEmail(l.data.email)),
      sharedPhone: dupIdx.sharedPhoneKeys.has(normPhone(l.data.whatsapp)),
    };
    const i = buildIntelligence(l.data, l.id, null, now, ctx);
    v4[i.scoreLabel]++;
    if (i.isTest) { isTestCount++; testDist[i.scoreLabel]++; }
    else realDist[i.scoreLabel]++;
    all.push({ id: l.id, lead: l.data, i });
  }
  const realTotal = leads.length - isTestCount;
  const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '0%';

  console.log('=== v4 PROJECTED DISTRIBUTION (in-memory, NO writes) — total', leads.length, 'leads ===');
  console.log('  ALL  :', LABELS.map(l => `${l} ${v4[l]}`).join(' | '));
  console.log('');
  console.log('  REAL leads (', realTotal, ') — counts and % of real:');
  console.log('    ', LABELS.map(l => `${l} ${realDist[l]} (${pct(realDist[l], realTotal)})`).join(' | '));
  console.log('  TEST leads (', isTestCount, ') — broken out separately:');
  console.log('    ', LABELS.map(l => `${l} ${testDist[l]}`).join(' | '));

  // Top 10 by expectedValue EXCLUDING isTest
  console.log('\n=== TOP 10 BY expectedValue (excluding isTest) ===');
  const top10 = all.filter(r => !r.i.isTest).sort((a, b) => b.i.expectedValue - a.i.expectedValue).slice(0, 10);
  for (const r of top10) {
    console.log(`  ${cleanName(r.lead.name).padEnd(18)} ${r.i.scoreLabel.padEnd(5)} score ${String(r.i.score).padStart(3)}  ${r.i.recommendedOffer.padEnd(13)} EV J$${Number(r.i.expectedValue).toLocaleString('en-US').padStart(8)}`);
  }

  // ── Decision gate: Ready (excluding test) ≤ 8% of real leads ──
  const readyPctReal = realTotal ? (100 * realDist.Ready / realTotal) : 0;
  console.log('\n=== DECISION GATE ===');
  console.log(`  Ready (real): ${realDist.Ready}/${realTotal} = ${readyPctReal.toFixed(1)}%  (threshold ≤ 8%)`);
  if (readyPctReal <= 8) {
    // Snapshot-currency check
    const SNAP_DIR = path.join(__dirname, '_snapshots');
    const snaps = fs.existsSync(SNAP_DIR) ? fs.readdirSync(SNAP_DIR).filter(f => /^lead-intelligence-snapshot-.*\.json$/.test(f)).sort() : [];
    if (!snaps.length) { console.log('  ⚠️ No snapshot present — backup-lead-intelligence.js must run before backfill.'); }
    else {
      const snap = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, snaps[snaps.length - 1]), 'utf8'));
      const snapLeadCount = ((snap.collections || {}).leads || {}).count;
      const current = leads.length;
      const currentSnap = snapLeadCount === current;
      console.log(`  Snapshot: ${snaps[snaps.length - 1]}`);
      console.log(`  Snapshot leads = ${snapLeadCount}, current leads = ${current} → ${currentSnap ? '✅ CURRENT' : '⚠️ STALE (re-snapshot before backfill)'}`);
    }
    console.log('  ✅ PROCEED — Ready ≤ 8%. Stop for backfill approval.');
  } else {
    console.log('  ⛔ Ready EXCEEDS 8% — stop and report, no further action.');
  }

  // 20-lead sample (first 20 in list order — same as the dry-run button limit:20)
  console.log('\n=== 20-LEAD SAMPLE (v4) ===');
  for (const r of all.slice(0, 20)) {
    const v3l = v3Label.get(r.id) || '—';
    console.log(`  ${r.id} ${cleanName(r.lead.name).padEnd(16)} ${String(r.i.score).padStart(3)} ${r.i.scoreLabel.padEnd(5)} (v3:${v3l}) ${r.i.recommendedOffer.padEnd(13)} EV J$${Number(r.i.expectedValue).toLocaleString('en-US').padStart(8)}${r.i.isTest ? '  ⚠️isTest' : ''}`);
  }

  // 10 March–April 2026 stale leads (no lastReplyAt)
  console.log('\n=== 10 MAR–APR 2026 STALE LEADS (v4) ===');
  const stale = all.filter(r => {
    const c = S.toDate(r.lead.createdAt);
    return c && c.getUTCFullYear() === 2026 && (c.getUTCMonth() === 2 || c.getUTCMonth() === 3) && !r.lead.lastReplyAt;
  }).slice(0, 10);
  for (const r of stale) {
    const v3l = v3Label.get(r.id) || '—';
    console.log(`  ${r.id} ${cleanName(r.lead.name).padEnd(16)} created ${S.toDate(r.lead.createdAt).toISOString().slice(0,10)} status=${(r.lead.status||'New').padEnd(10)} ${String(r.i.score).padStart(3)} ${r.i.scoreLabel.padEnd(5)} (v3:${v3l})`);
  }
})().catch(e => { console.error('PROJECTION FAILED:', e.message); process.exit(1); });
