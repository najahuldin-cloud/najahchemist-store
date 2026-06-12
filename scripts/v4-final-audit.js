// scripts/v4-final-audit.js — READ-ONLY. Parts C/D/E of the Constitution audit.
// Current engine = v4 (mid-budget +10, ready +25). Part C also projects ready +27.
// Builds the duplicate index across the full base; excludes isTest + non-primary
// duplicates + suspicious from the Honest Pipeline. NO WRITES.
// Run: node scripts/v4-final-audit.js

const os = require('os');
const fs = require('fs');
const path = require('path');
const { buildIntelligence } = require('../functions/agents/lead-agent/score');
const { buildDuplicateIndex } = require('../functions/agents/_shared/duplicates');
const { normEmail, normPhone } = require('../functions/agents/_shared/data-quality');
const { cleanName } = require('../functions/agents/_shared/names');
const S = require('../functions/agents/_shared/scoring');

const PROJECT_ID = 'najah-chemist';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const LABELS = ['Cold', 'Warm', 'Hot', 'Ready'];

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
    for (const d of (data.documents || [])) docs.push({ id: d.name.split('/').pop(), data: fromFields(d.fields || {}) });
    pt = data.nextPageToken || '';
  } while (pt);
  return docs;
}
const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '0.0%';
const J = n => 'J$' + Math.round(n).toLocaleString('en-US');
function contactability(dq) {
  if (dq.emailKey && dq.phoneKey) return 'email+phone';
  if (dq.emailKey) return 'email';
  if (dq.phoneKey) return 'phone';
  return 'none';
}

(async () => {
  const token = getToken();
  const leads = await listCollection(token, 'leads');
  const dup = buildDuplicateIndex(leads.map(l => ({ id: l.id, lead: l.data })));
  const now = Date.now();

  const R = leads.map(l => {
    const ctx = {
      dup: dup.index.get(l.id),
      sharedEmail: dup.sharedEmailKeys.has(normEmail(l.data.email)),
      sharedPhone: dup.sharedPhoneKeys.has(normPhone(l.data.whatsapp)),
    };
    const i = buildIntelligence(l.data, l.id, null, now, ctx);
    const readyJourney = (l.data.journey || '').toLowerCase().includes('ready');
    const scoreP27 = S.clamp(i.score + (readyJourney ? 2 : 0), 0, 100); // project ready +27
    return { id: l.id, lead: l.data, i, name: cleanName(l.data.name), labelP27: S.scoreLabel(scoreP27) };
  });
  const total = R.length;
  const real = R.filter(r => !r.i.isTest);
  const realN = real.length;
  const testN = total - realN;

  // ════ PART C — READY TIER (current mid+10/ready+25  vs  projected ready+27) ════
  const cur = { Cold: 0, Warm: 0, Hot: 0, Ready: 0 }, p27 = { Cold: 0, Warm: 0, Hot: 0, Ready: 0 };
  real.forEach(r => { cur[r.i.scoreLabel]++; p27[r.labelP27]++; });
  console.log('════ PART C — READY TIER TUNING ════  (real leads: ' + realN + ')');
  console.log('  label   current(ready+25)    projected(ready+27)   delta');
  LABELS.forEach(l => console.log(`  ${l.padEnd(6)} ${(cur[l] + ' (' + pct(cur[l], realN) + ')').padEnd(20)} ${(p27[l] + ' (' + pct(p27[l], realN) + ')').padEnd(20)} ${(p27[l] - cur[l] >= 0 ? '+' : '') + (p27[l] - cur[l])}`));
  const readyPctCur = 100 * cur.Ready / realN, readyPct27 = 100 * p27.Ready / realN;
  console.log(`  Ready current = ${cur.Ready} (${readyPctCur.toFixed(1)}%) | projected +27 = ${p27.Ready} (${readyPct27.toFixed(1)}%)  [target 1–3%; stop if >5%]`);
  console.log(`  GATE: ${readyPct27 > 5 ? '⛔ >5% STOP' : (readyPct27 >= 1 ? '✅ in 1–3% band' : '⚠️ below 1% floor')}`);

  // ════ test + duplicate inflation ════
  const dupExtras = R.filter(r => !r.i.isPrimaryRecord);            // non-primary cluster members
  const dupExtraEV = dupExtras.reduce((s, r) => s + r.i.expectedValue, 0);
  const dupExtraPot = dupExtras.reduce((s, r) => s + r.i.potentialValue.value, 0);
  const totEV = R.reduce((s, r) => s + r.i.expectedValue, 0);
  const totPot = R.reduce((s, r) => s + r.i.potentialValue.value, 0);
  console.log('\n════ TEST + DUPLICATE SUMMARY ════');
  console.log(`  Test leads (isTest): ${testN}`);
  console.log(`  Duplicate extra records (non-primary): ${dupExtras.length}`);
  console.log(`  Suspicious (sentence_name etc.): ${R.filter(r => r.i.suspiciousLead).length}`);
  console.log(`  Duplicate inflation: ${J(dupExtraEV)} expected (${pct(dupExtraEV, totEV)}), ${J(dupExtraPot)} potential (${pct(dupExtraPot, totPot)})`);

  // ════ PART D — PIPELINE HONESTY ════
  const testIds = new Set(R.filter(r => r.i.isTest).map(r => r.id));
  let rawP = 0, rawE = 0, adjP = 0, adjE = 0;
  for (const r of R) {
    rawP += r.i.potentialValue.value; rawE += r.i.expectedValue;
    if (r.i.isTest) continue;                 // remove test
    if (!r.i.isPrimaryRecord) continue;        // remove duplicate inflation (keep primary only)
    if (r.i.suspiciousLead) continue;          // remove suspicious records
    adjP += r.i.potentialValue.value; adjE += r.i.expectedValue;
  }
  console.log('\n════ PART D — PIPELINE HONESTY ════');
  console.log(`  RAW       potential ${J(rawP).padEnd(14)} expected ${J(rawE)}`);
  console.log(`  ADJUSTED  potential ${J(adjP).padEnd(14)} expected ${J(adjE)}   ← removes test + duplicate-extras + suspicious`);
  console.log(`  Honest expected = ${pct(adjE, rawE)} of raw; inflation removed = ${J(rawE - adjE)} expected.`);

  // ════ PART E — TOP 20 (exclude isTest) ════
  console.log('\n════ PART E — TOP 20 OPPORTUNITIES (isTest excluded) ════');
  console.log('  #  Name               Score CloseP  ExpectedValue  Offer          Dup  Contact        Flags');
  real.slice().sort((a, b) => b.i.expectedValue - a.i.expectedValue).slice(0, 20).forEach((r, idx) => {
    const flags = [];
    if (!r.i.isPrimaryRecord) flags.push('⚠dup-extra');
    if (r.i.duplicateCount > 1) flags.push(`cluster×${r.i.duplicateCount}`);
    if (r.i.suspiciousLead) flags.push('⚠' + r.i.suspiciousReason);
    if (r.i.dataQuality.missingContact) flags.push('⚠no-contact');
    console.log(`  ${String(idx + 1).padStart(2)} ${r.name.slice(0, 18).padEnd(18)} ${String(r.i.score).padStart(4)} ${String(r.i.closeProbability).padStart(5)}  ${J(r.i.expectedValue).padEnd(10)} ${r.i.recommendedOffer.padEnd(13)} ${String(r.i.duplicateCount).padStart(3)}  ${contactability(r.i.dataQuality).padEnd(12)} ${flags.join(' ')}`);
  });
})().catch(e => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
