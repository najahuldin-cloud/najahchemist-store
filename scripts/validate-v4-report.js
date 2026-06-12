// scripts/validate-v4-report.js — READ-ONLY v4 validation report. No writes.
// Sections 1–5: distribution, Ready audit, false-positive check, top-20, pipeline impact.
// Run: node scripts/validate-v4-report.js

const os = require('os');
const fs = require('fs');
const path = require('path');
const { buildIntelligence, baseScore, journeyBonus, budgetBonus, replyBonus } = require('../functions/agents/lead-agent/score');
const { assessDataQuality, normEmail, normPhone } = require('../functions/agents/_shared/data-quality');
const { buildDuplicateIndex } = require('../functions/agents/_shared/duplicates');
const { cleanName } = require('../functions/agents/_shared/names');
const S = require('../functions/agents/_shared/scoring');
const LC = require('../functions/agents/_shared/lifecycle');

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

function reasons(lead, intel, now) {
  const status = lead.status || 'New';
  const stage = LC.lifecycleStage(lead, now);
  const opp = LC.opportunitySource(lead, now, stage);
  const b = baseScore(opp, status), jb = journeyBonus(lead.journey), bb = budgetBonus(lead.budget), rb = replyBonus(lead);
  const decay = S.decayPoints(S.daysSince(intel.lastMeaningfulActivity, now));
  const parts = [`base ${b}(${status})`];
  if (jb) parts.push(`journey ${jb >= 0 ? '+' : ''}${jb}`);
  if (bb) parts.push(`budget +${bb}`);
  if (rb) parts.push(`reply +${rb}`);
  if (decay) parts.push(`decay -${decay}`);
  return parts.join(', ');
}

(async () => {
  const token = getToken();
  const leads = await listCollection(token, 'leads');
  const intelDocs = await listCollection(token, 'lead_intelligence');
  const v3 = new Map(intelDocs.map(d => [d.id, d.data]));
  const now = Date.now();

  // Duplicate index + shared-contact sets across the FULL lead base, so isTest
  // (incl. shared_contact) matches the canonical audit and the backfill write.
  const dupIdx = buildDuplicateIndex(leads.map(l => ({ id: l.id, lead: l.data })));

  const rows = leads.map(l => {
    const ctx = {
      dup: dupIdx.index.get(l.id),
      sharedEmail: dupIdx.sharedEmailKeys.has(normEmail(l.data.email)),
      sharedPhone: dupIdx.sharedPhoneKeys.has(normPhone(l.data.whatsapp)),
    };
    const i = buildIntelligence(l.data, l.id, null, now, ctx);
    return { id: l.id, lead: l.data, i, isTest: i.isTest, name: cleanName(l.data.name) };
  });
  const total = rows.length;

  // 1. FINAL DISTRIBUTION (all analyzed)
  const dist = { Cold: 0, Warm: 0, Hot: 0, Ready: 0 };
  rows.forEach(r => dist[r.i.scoreLabel]++);
  console.log('### 1. FINAL DISTRIBUTION (total analyzed: ' + total + ')');
  LABELS.forEach(l => console.log(`  ${l.padEnd(6)} ${String(dist[l]).padStart(3)}  ${pct(dist[l], total)}`));
  const testN = rows.filter(r => r.isTest).length;
  console.log(`  (of which isTest: ${testN}; real: ${total - testN})`);

  // 2. READY AUDIT
  console.log('\n### 2. READY-TO-BUY AUDIT (top 10 by EV)');
  const ready = rows.filter(r => r.i.scoreLabel === 'Ready').sort((a, b) => b.i.expectedValue - a.i.expectedValue).slice(0, 10);
  if (!ready.length) {
    console.log('  0 Ready leads — none to display.');
    console.log('  Closest real leads (highest-scored, all Hot):');
    rows.filter(r => !r.isTest).sort((a, b) => b.i.score - a.i.score).slice(0, 5).forEach(r =>
      console.log(`    ${r.name.padEnd(18)} score ${r.i.score} ${r.i.scoreLabel}  EV J$${Number(r.i.expectedValue).toLocaleString('en-US')}  [${reasons(r.lead, r.i, now)}]`));
  } else {
    ready.forEach(r => console.log(`  ${r.name} | score ${r.i.score} | EV J$${Number(r.i.expectedValue).toLocaleString('en-US')} | ${r.i.recommendedOffer} | ${reasons(r.lead, r.i, now)} | isTest=${r.isTest}${r.i.dataQuality.testReason ? ' (' + r.i.dataQuality.testReason + ')' : ''}`));
  }

  // 3. FALSE-POSITIVE CHECK among Ready
  console.log('\n### 3. FALSE-POSITIVE CHECK (Ready leads that look test/owner/junk/placeholder/missing-data)');
  const fp = ready.filter(r => r.isTest || !r.i.dataQuality.hasName || r.i.dataQuality.missingContact);
  console.log(`  Ready leads total: ${ready.length}; flagged false-positive: ${fp.length}`);
  fp.slice(0, 10).forEach(r => console.log(`    ${r.name} — isTest=${r.isTest} reason=${r.i.dataQuality.testReason || '-'} hasName=${r.i.dataQuality.hasName} missingContact=${r.i.dataQuality.missingContact}`));

  // 4. TOP 20 BY EV
  console.log('\n### 4. TOP 20 OPPORTUNITIES BY EXPECTED VALUE');
  console.log('  Name               Score CloseProb  ExpectedValue  Offer          isTest');
  rows.slice().sort((a, b) => b.i.expectedValue - a.i.expectedValue).slice(0, 20).forEach(r =>
    console.log(`  ${r.name.padEnd(18)} ${String(r.i.score).padStart(4)}  ${String(r.i.closeProbability).padStart(6)}   J$${Number(r.i.expectedValue).toLocaleString('en-US').padStart(8)}  ${r.i.recommendedOffer.padEnd(13)} ${r.isTest}`));

  // 5. PIPELINE IMPACT (exclude test for both, apples-to-apples)
  const real = rows.filter(r => !r.isTest);
  let v4pot = 0, v4exp = 0, v4ready = 0, v4hot = 0;
  let v3pot = 0, v3exp = 0, v3ready = 0, v3hot = 0, v3missing = 0;
  for (const r of real) {
    v4pot += r.i.potentialValue.value; v4exp += r.i.expectedValue;
    if (r.i.scoreLabel === 'Ready') v4ready++; if (r.i.scoreLabel === 'Hot') v4hot++;
    const prev = v3.get(r.id);
    if (prev) {
      v3pot += (prev.potentialValue && prev.potentialValue.value) || 0;
      v3exp += prev.expectedValue || 0;
      if (prev.scoreLabel === 'Ready') v3ready++; if (prev.scoreLabel === 'Hot') v3hot++;
    } else v3missing++;
  }
  const J = n => 'J$' + Math.round(n).toLocaleString('en-US');
  console.log('\n### 5. PIPELINE IMPACT (real leads only, test excluded)');
  console.log('  metric                     before v3        after v4');
  console.log(`  Pipeline Potential Revenue ${J(v3pot).padEnd(16)} ${J(v4pot)}`);
  console.log(`  Pipeline Expected Revenue  ${J(v3exp).padEnd(16)} ${J(v4exp)}`);
  console.log(`  Ready To Buy count         ${String(v3ready).padEnd(16)} ${v4ready}`);
  console.log(`  Hot count                  ${String(v3hot).padEnd(16)} ${v4hot}`);
  if (v3missing) console.log(`  (note: ${v3missing} real leads had no stored v3 doc)`);
})().catch(e => { console.error('REPORT FAILED:', e.message); process.exit(1); });
