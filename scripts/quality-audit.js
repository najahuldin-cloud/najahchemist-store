// scripts/quality-audit.js — READ-ONLY Lead Intelligence Quality Audit. NO WRITES.
// Parts 1–7. Uses the v4 engine in-memory; Part 1 additionally projects mid-budget +10.
// Run: node scripts/quality-audit.js

const os = require('os');
const fs = require('fs');
const path = require('path');
const { buildIntelligence, baseScore, journeyBonus, budgetBonus, replyBonus } = require('../functions/agents/lead-agent/score');
const { assessDataQuality, normEmail, normPhone } = require('../functions/agents/_shared/data-quality');
const { buildDuplicateIndex } = require('../functions/agents/_shared/duplicates');
const { cleanName } = require('../functions/agents/_shared/names');
const { segmentKey } = require('../functions/agents/_shared/offers');
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
const J = n => 'J$' + Math.round(n).toLocaleString('en-US');
function reasons(lead, i, now) {
  const status = lead.status || 'New';
  const opp = LC.opportunitySource(lead, now, LC.lifecycleStage(lead, now));
  const b = baseScore(opp, status), jb = journeyBonus(lead.journey), bb = budgetBonus(lead.budget), rb = replyBonus(lead);
  const decay = S.decayPoints(S.daysSince(i.lastMeaningfulActivity, now));
  const p = [`base ${b}(${status})`];
  if (jb) p.push(`journey ${jb >= 0 ? '+' : ''}${jb}`);
  if (bb) p.push(`budget +${bb}`);
  if (rb) p.push(`reply +${rb}`);
  if (decay) p.push(`decay -${decay}`);
  return p.join(', ');
}

(async () => {
  const token = getToken();
  const leads = await listCollection(token, 'leads');
  const now = Date.now();
  // Shared-contact / duplicate context across the FULL lead base, so i.isTest
  // (incl. shared_contact) matches the canonical audit. Parts 2 & 7 keep their own
  // independent exact-dupe grouping — this only affects isTest classification.
  const dupIdx = buildDuplicateIndex(leads.map(l => ({ id: l.id, lead: l.data })));
  const R = leads.map(l => {
    const ctx = {
      dup: dupIdx.index.get(l.id),
      sharedEmail: dupIdx.sharedEmailKeys.has(normEmail(l.data.email)),
      sharedPhone: dupIdx.sharedPhoneKeys.has(normPhone(l.data.whatsapp)),
    };
    const i = buildIntelligence(l.data, l.id, null, now, ctx);
    const midBudget = budgetBonus(l.data.budget) === 8;
    const scoreAdj = S.clamp(i.score + (midBudget ? 2 : 0), 0, 100);
    return {
      id: l.id, lead: l.data, i, dq: i.dataQuality, isTest: i.isTest,
      name: cleanName(l.data.name), scoreAdj, labelAdj: S.scoreLabel(scoreAdj),
      ev: i.expectedValue, pot: i.potentialValue.value,
    };
  });
  const total = R.length;
  const real = R.filter(r => !r.isTest);
  const realN = real.length;

  // ════ PART 1 — READY TIER TUNING ($500–$1,000 +8 → +10) ════
  console.log('════ PART 1 — READY TIER TUNING (mid-budget +8 → +10, projection only) ════');
  const prev = { Cold: 0, Warm: 0, Hot: 0, Ready: 0 }, next = { Cold: 0, Warm: 0, Hot: 0, Ready: 0 };
  real.forEach(r => { prev[r.i.scoreLabel]++; next[r.labelAdj]++; });
  console.log(`Real leads: ${realN}  (test excluded; total ${total})`);
  console.log('  label   prev(+8)            new(+10)            delta');
  LABELS.forEach(l => console.log(`  ${l.padEnd(6)} ${(prev[l] + ' (' + pct(prev[l], realN) + ')').padEnd(18)} ${(next[l] + ' (' + pct(next[l], realN) + ')').padEnd(18)} ${(next[l] - prev[l] >= 0 ? '+' : '') + (next[l] - prev[l])}`));
  const readyPct = 100 * next.Ready / realN;
  console.log(`  → Ready (real) new = ${next.Ready}/${realN} = ${readyPct.toFixed(1)}%  [target 1–5%; >8% stop; 0 stop]`);

  // ════ PART 2 — DUPLICATE AUDIT ════
  console.log('\n════ PART 2 — DUPLICATE LEAD AUDIT ════');
  const groupBy = (keyFn) => { const m = new Map(); for (const r of R) { const k = keyFn(r); if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(r); } return m; };
  const emailG = [...groupBy(r => r.dq.emailKey)].filter(([, v]) => v.length > 1);
  const phoneG = [...groupBy(r => r.dq.phoneKey)].filter(([, v]) => v.length > 1);
  const npG = [...groupBy(r => (r.dq.nameKey && r.dq.phoneKey) ? r.dq.nameKey + '|' + r.dq.phoneKey : null)].filter(([, v]) => v.length > 1);

  console.log(`A. EXACT EMAIL DUPLICATES: ${emailG.length} emails`);
  emailG.sort((a, b) => b[1].length - a[1].length).slice(0, 12).forEach(([e, v]) => console.log(`   ${e}  x${v.length}  [${v.map(r => r.id).join(', ')}]`));
  console.log(`B. EXACT PHONE DUPLICATES: ${phoneG.length} phones`);
  phoneG.sort((a, b) => b[1].length - a[1].length).slice(0, 12).forEach(([p, v]) => console.log(`   ${p}  x${v.length}  [${v.map(r => r.id).join(', ')}]`));
  console.log(`C. NAME + PHONE DUPLICATES: ${npG.length} pairs`);
  npG.sort((a, b) => b[1].length - a[1].length).slice(0, 12).forEach(([k, v]) => { const [n, p] = k.split('|'); console.log(`   ${n} | ${p}  x${v.length}`); });

  // D. potential name dups: same first token, ≥2 distinct nameKeys, with prefix/bare-first-name signal
  const tokG = new Map();
  for (const r of R) { const nk = r.dq.nameKey; if (!nk) continue; const t = nk.split(' ')[0]; (tokG.get(t) || tokG.set(t, []).get(t)).push(r); }
  const nameDup = [];
  for (const [t, v] of tokG) {
    const names = [...new Set(v.map(r => r.dq.nameKey))];
    if (names.length < 2) continue;
    const bare = names.some(n => n === t);
    const prefix = names.some(a => names.some(b => a !== b && b.startsWith(a + ' ')));
    if (bare || prefix) nameDup.push({ token: t, variants: names, count: v.length });
  }
  console.log(`D. POTENTIAL NAME DUPLICATES (likely): ${nameDup.length} first-name clusters`);
  nameDup.sort((a, b) => b.count - a.count).slice(0, 12).forEach(g => console.log(`   "${g.token}" x${g.count}: ${g.variants.join(' / ')}`));

  // E. inflation from EXACT dupes (email||phone key), keep highest-EV per group
  const exactKey = r => r.dq.emailKey || r.dq.phoneKey || null;
  const exactG = [...groupBy(exactKey)].filter(([, v]) => v.length > 1);
  let dupCount = 0, dupEV = 0, dupPot = 0;
  for (const [, v] of exactG) {
    const sorted = v.slice().sort((a, b) => b.ev - a.ev);
    for (const r of sorted.slice(1)) { dupCount++; dupEV += r.ev; dupPot += r.pot; }
  }
  const totEV = R.reduce((s, r) => s + r.ev, 0), totPot = R.reduce((s, r) => s + r.pot, 0);
  console.log('E. PIPELINE INFLATION (exact email/phone dupes; keep highest-EV per group):');
  console.log(`   duplicate (extra) leads: ${dupCount}`);
  console.log(`   duplicate expected value: ${J(dupEV)}  (${pct(dupEV, totEV)} of expected)`);
  console.log(`   duplicate potential value: ${J(dupPot)}  (${pct(dupPot, totPot)} of potential)`);

  // ════ PART 3 — DATA QUALITY ════
  console.log('\n════ PART 3 — DATA QUALITY AUDIT ════');
  const miss = { email: 0, phone: 0, segment: 0, name: 0, source: 0, status: 0 };
  for (const r of R) {
    if (!r.dq.emailKey) miss.email++;
    if (!r.dq.phoneKey) miss.phone++;
    if (segmentKey(r.lead.brandType) === 'general') miss.segment++;
    if (!r.dq.hasName) miss.name++;
    if (!r.lead.hearAboutUs && !r.lead.page && !r.lead.source) miss.source++;
    if (!r.lead.status) miss.status++;
  }
  for (const k of Object.keys(miss)) console.log(`  missing ${k.padEnd(8)}: ${String(miss[k]).padStart(3)}  ${pct(miss[k], total)}`);
  console.log('  Top 20 highest-EV leads with NO contact info (no email & no phone):');
  R.filter(r => r.dq.missingContact).sort((a, b) => b.ev - a.ev).slice(0, 20)
    .forEach(r => console.log(`    ${r.name.padEnd(18)} score ${r.i.score} ${r.i.scoreLabel} EV ${J(r.ev)}${r.isTest ? ' [isTest]' : ''}`));

  // ════ PART 4 — CONTACTABILITY ════
  console.log('\n════ PART 4 — CONTACTABILITY (simulation) ════');
  let eOnly = 0, pOnly = 0, both = 0, none = 0, contactableEV = 0;
  for (const r of real) {
    const e = !!r.dq.emailKey, p = !!r.dq.phoneKey;
    if (e && p) both++; else if (e) eOnly++; else if (p) pOnly++; else none++;
    if (e || p) contactableEV += r.ev;
  }
  const realEV = real.reduce((s, r) => s + r.ev, 0);
  console.log(`  (real leads ${realN})  Email only: ${eOnly} | Phone only: ${pOnly} | Email+Phone: ${both} | No contact: ${none}`);
  console.log(`  Contactable pipeline (EV with email or phone): ${J(contactableEV)} of ${J(realEV)} = ${pct(contactableEV, realEV)}`);

  // ════ PART 5 — TEST LEAD AUDIT ════
  console.log('\n════ PART 5 — TEST LEAD AUDIT ════');
  const tests = R.filter(r => r.isTest).sort((a, b) => b.ev - a.ev);
  console.log('  Name               Score  EV          testReason');
  tests.forEach(r => console.log(`  ${r.name.padEnd(18)} ${String(r.i.score).padStart(4)}  ${J(r.ev).padEnd(10)} ${r.dq.testReason}`));
  console.log(`  Total test leads: ${tests.length} | test EV: ${J(tests.reduce((s, r) => s + r.ev, 0))} | test potential: ${J(tests.reduce((s, r) => s + r.pot, 0))}`);
  const top20all = R.slice().sort((a, b) => b.ev - a.ev).slice(0, 20);
  console.log(`  Test leads in raw top-20 by EV: ${top20all.filter(r => r.isTest).length} → removed after isTest exclusion (Part 6 is real-only).`);

  // ════ PART 6 — TOP 30 REAL OPPORTUNITIES ════
  console.log('\n════ PART 6 — TOP 30 REAL OPPORTUNITIES (isTest excluded) ════');
  console.log('  #  Name               Score CloseP  EV          Offer          Reason / ⚠flags');
  real.slice().sort((a, b) => b.ev - a.ev).slice(0, 30).forEach((r, idx) => {
    const flags = [];
    if (r.dq.missingContact) flags.push('⚠no-contact');
    if (!r.dq.hasName) flags.push('⚠no-name');
    console.log(`  ${String(idx + 1).padStart(2)} ${r.name.padEnd(18)} ${String(r.i.score).padStart(4)} ${String(r.i.closeProbability).padStart(5)}  ${J(r.ev).padEnd(10)} ${r.i.recommendedOffer.padEnd(13)} ${reasons(r.lead, r.i, now)}${flags.length ? ' ' + flags.join(' ') : ''}`);
  });

  // ════ PART 7 — PIPELINE HONESTY ════
  console.log('\n════ PART 7 — PIPELINE HONESTY ════');
  const testIds = new Set(tests.map(r => r.id));
  const dupExtraIds = new Set();
  for (const [, v] of exactG) { const s = v.slice().sort((a, b) => b.ev - a.ev); s.slice(1).forEach(r => { if (!testIds.has(r.id)) dupExtraIds.add(r.id); }); }
  let pot = 0, ev = 0, afterTestP = 0, afterTestE = 0, afterDupP = 0, afterDupE = 0, finalP = 0, finalE = 0;
  for (const r of R) {
    pot += r.pot; ev += r.ev;
    if (testIds.has(r.id)) continue;
    afterTestP += r.pot; afterTestE += r.ev;
    if (dupExtraIds.has(r.id)) continue;
    afterDupP += r.pot; afterDupE += r.ev;
    if (r.dq.missingContact) continue;
    finalP += r.pot; finalE += r.ev;
  }
  console.log(`  RAW pipeline           potential ${J(pot).padEnd(14)} expected ${J(ev)}`);
  console.log(`  − test leads           potential ${J(afterTestP).padEnd(14)} expected ${J(afterTestE)}`);
  console.log(`  − duplicate extras     potential ${J(afterDupP).padEnd(14)} expected ${J(afterDupE)}`);
  console.log(`  − uncontactable        potential ${J(finalP).padEnd(14)} expected ${J(finalE)}   ← HONEST PIPELINE`);
  console.log(`  Honest expected = ${pct(finalE, ev)} of raw expected; honest potential = ${pct(finalP, pot)} of raw potential.`);
})().catch(e => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
