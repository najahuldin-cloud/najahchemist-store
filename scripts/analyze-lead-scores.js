// scripts/analyze-lead-scores.js — READ-ONLY analysis of the Phase 3 backfill.
// Reads `leads` + `lead_intelligence`, reconstructs each score's component
// breakdown (mirrors lead-agent/score.js rawScore exactly), cross-checks against
// the stored score, and reports decay/distribution/Ready audits. MAKES NO WRITES.
//
// Run: node scripts/analyze-lead-scores.js

const os = require('os');
const fs = require('fs');
const path = require('path');
const S = require('../functions/agents/_shared/scoring');
const { cleanName } = require('../functions/agents/_shared/names');

const PROJECT_ID = 'najah-chemist';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

const OWNER_EMAIL = 'start@najahchemist.com';
const OWNER_PHONES = ['18768851099', '18763499729'];

function getToken() {
  const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const t = data.tokens;
  if (!t || !t.access_token) throw new Error('No Firebase CLI token — run: firebase login');
  return t.access_token;
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
function fromFields(fields) {
  const o = {};
  for (const [k, val] of Object.entries(fields)) o[k] = fromValue(val);
  return o;
}
async function listCollection(token, collectionId) {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${BASE}/${collectionId}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list ${collectionId} ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const d of (data.documents || [])) docs.push({ id: d.name.split('/').pop(), data: fromFields(d.fields || {}) });
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

// ── Mirror of lead-agent/score.js rawScore components (read-only, for transparency) ──
const BASE_MAP = { reorder: 70, hot: 55, overdue: 50, newlead: 35, dormant: 20, lost: 5 };
function journeyBonus(j) { j = (j || '').toLowerCase(); if (j.includes('ready')) return 15; if (j.includes('smallest')) return 5; if (j.includes('exploring')) return -5; return 0; }
function budgetBonus(b) { b = b || ''; if (b.includes('1,000')) return 12; if (b.includes('500')) return 8; if (b.includes('200')) return 4; return 0; }
function replyBonus(lead) { return (Array.isArray(lead.emailConversation) && lead.emailConversation.some(t => t.role === 'user')) ? 10 : 0; }

function breakdown(lead, intel) {
  const oppSource = intel.opportunitySource;
  const base = BASE_MAP[oppSource] != null ? BASE_MAP[oppSource] : 35;
  const jb = journeyBonus(lead.journey);
  const bb = budgetBonus(lead.budget);
  const rb = replyBonus(lead);
  const nowMs = (intel.lastScoredAt instanceof Date) ? intel.lastScoredAt.getTime() : Date.now();
  const days = S.daysSince(intel.lastMeaningfulActivity, nowMs);
  const decay = S.decayPoints(days);
  const recon = Math.max(0, Math.min(100, Math.round(base + jb + bb + rb - decay)));
  return { oppSource, base, jb, bb, rb, decay, days, recon };
}

function isTestOrOwner(lead) {
  const name = (lead.name || '').toLowerCase();
  const email = (lead.email || '').toLowerCase();
  const phone = (lead.whatsapp || '').replace(/\D/g, '');
  return /test|demo|sample/.test(name) || email === OWNER_EMAIL || OWNER_PHONES.includes(phone);
}

(async () => {
  const token = getToken();
  const leads = await listCollection(token, 'leads');
  const intel = await listCollection(token, 'lead_intelligence');
  const leadMap = new Map(leads.map(l => [l.id, l.data]));
  const rows = intel.map(d => ({ id: d.id, intel: d.data, lead: leadMap.get(d.id) || {} }));

  // Faithfulness cross-check: reconstructed score vs stored score.
  let mismatch = 0;
  for (const r of rows) { if (breakdown(r.lead, r.intel).recon !== r.intel.score) mismatch++; }
  console.log(`Faithfulness: reconstructed score == stored score for ${rows.length - mismatch}/${rows.length} (mismatches: ${mismatch})\n`);

  // ── 1. DECAY CHECK — 10 March–April 2026 leads with no recent activity ──
  console.log('=== 1. DECAY CHECK (Mar–Apr 2026 leads, no lastReplyAt) ===');
  const old = rows.filter(r => {
    const c = S.toDate(r.lead.createdAt);
    if (!c) return false;
    const m = c.getUTCFullYear() === 2026 && (c.getUTCMonth() === 2 || c.getUTCMonth() === 3); // Mar=2, Apr=3
    return m && !r.lead.lastReplyAt;
  }).slice(0, 10);
  if (!old.length) console.log('  (none found)');
  for (const r of old) {
    const b = breakdown(r.lead, r.intel);
    const raw = b.base + b.jb + b.bb + b.rb;
    console.log(`  ${r.id} ${cleanName(r.lead.name).padEnd(16)} created ${S.toDate(r.lead.createdAt).toISOString().slice(0,10)} status=${(r.lead.status||'New')}`);
    console.log(`     oppSource=${b.oppSource} base=${b.base} +journey ${b.jb} +budget ${b.bb} +reply ${b.rb} = RAW ${raw} | inactive ${b.days}d → decay -${b.decay} | FINAL ${r.intel.score} ${r.intel.scoreLabel}`);
  }

  // ── 2. HOT BREAKDOWN — what's inflating the 305 Hot ──
  console.log('\n=== 2. HOT LEADS BREAKDOWN ===');
  const hot = rows.filter(r => r.intel.scoreLabel === 'Hot');
  const bySource = {};
  let hotFromBaseAlone = 0;   // base - decay >= 50 (no bonuses needed)
  let bonusDependent = 0;     // needed journey/budget/reply to reach 50
  let replyDecisive = 0;      // would drop below 50 if reply bonus removed
  let readyJourneyDecisive = 0; // would drop below 50 without journey "ready" bonus
  let withDecay = 0;
  for (const r of hot) {
    const b = breakdown(r.lead, r.intel);
    bySource[b.oppSource] = (bySource[b.oppSource] || 0) + 1;
    if (b.base - b.decay >= 50) hotFromBaseAlone++; else if (b.recon >= 50) bonusDependent++;
    if (b.recon >= 50 && (b.recon - b.rb) < 50) replyDecisive++;
    if (b.recon >= 50 && (b.recon - b.jb) < 50) readyJourneyDecisive++;
    if (b.decay > 0) withDecay++;
  }
  console.log(`  Total Hot: ${hot.length}`);
  console.log(`  By opportunitySource:`, JSON.stringify(bySource));
  console.log(`  Hot from source base alone (base−decay ≥ 50): ${hotFromBaseAlone}`);
  console.log(`  Hot only because of bonuses (journey/budget/reply): ${bonusDependent}`);
  console.log(`     ...of which reply/engagement was decisive: ${replyDecisive}`);
  console.log(`     ...of which journey "ready" bonus was decisive: ${readyJourneyDecisive}`);
  console.log(`  Hot leads that still had decay applied (>0): ${withDecay}`);

  // ── 3. READY TIER AUDIT — all Ready leads ──
  console.log('\n=== 3. READY TIER AUDIT (score ≥ 75) ===');
  const ready = rows.filter(r => r.intel.scoreLabel === 'Ready')
    .sort((a, b) => b.intel.score - a.intel.score);
  console.log(`  Total Ready: ${ready.length}`);
  let flagged = 0;
  for (const r of ready) {
    const b = breakdown(r.lead, r.intel);
    const flag = isTestOrOwner(r.lead) ? '  ⚠️ TEST/OWNER' : '';
    if (flag) flagged++;
    console.log(`  ${r.id} ${cleanName(r.lead.name).padEnd(16)} score=${r.intel.score} src=${b.oppSource} journey="${r.lead.journey||''}" budget="${r.lead.budget||''}" reply=${b.rb>0} decay=-${b.decay}${flag}`);
  }
  console.log(`  Flagged test/owner among Ready: ${flagged}`);
})().catch(e => { console.error('ANALYSIS FAILED:', e.message); process.exit(1); });
