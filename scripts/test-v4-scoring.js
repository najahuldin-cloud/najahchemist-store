// scripts/test-v4-scoring.js — assertions for SCORER_VERSION 4 rules. No I/O.
// Run: node scripts/test-v4-scoring.js

const assert = require('assert');
const { buildIntelligence, baseScore, budgetBonus } = require('../functions/agents/lead-agent/score');
const { assessDataQuality } = require('../functions/agents/_shared/data-quality');
const { scoreLabel } = require('../functions/agents/_shared/scoring');

let n = 0;
const ok = (m) => { n++; console.log('  ✓', m); };

// ── Budget tiers (the bug + the fix) ──
assert.strictEqual(budgetBonus('$500–$1,000 USD'), 10, 'en-dash $500–$1,000 → mid +10'); ok('"$500–$1,000 USD" (en-dash) → +10 (mid, NOT top)');
assert.strictEqual(budgetBonus('$500-$1,000 USD'), 10, 'hyphen $500-$1,000 → mid +10');   ok('"$500-$1,000 USD" (hyphen) → +10 (mid)');
assert.strictEqual(budgetBonus('$1,000+ USD'), 12, '$1,000+ → top +12');                ok('"$1,000+ USD" → +12 (top, requires plus)');
assert.strictEqual(budgetBonus('$200–$500 USD'), 5, '$200–$500 → +5');                   ok('"$200–$500 USD" → +5');
assert.strictEqual(budgetBonus('Under $200 USD'), 3, 'Under $200 → +3');                 ok('"Under $200 USD" → +3');

// ── Base split: Contacted vs Interested ──
assert.strictEqual(baseScore('hot', 'Contacted'), 40, 'Contacted base 40');   ok('Contacted base = 40 (Warm on base alone)');
assert.strictEqual(baseScore('hot', 'Interested'), 55, 'Interested base 55'); ok('Interested base = 55 (Hot)');
assert.strictEqual(baseScore('overdue', 'Contacted'), 40, 'overdue Contacted 40'); ok('overdue+Contacted base = 40');
assert.strictEqual(baseScore('newlead', 'New'), 35, 'newlead 35');            ok('newlead base = 35');

// ── Label thresholds (Cold 0–30, Warm 31–54, Hot 55–74, Ready 75+) ──
assert.strictEqual(scoreLabel(30), 'Cold', '30 → Cold'); ok('score 30 → Cold');
assert.strictEqual(scoreLabel(31), 'Warm', '31 → Warm'); ok('score 31 → Warm');
assert.strictEqual(scoreLabel(54), 'Warm', '54 → Warm'); ok('score 54 → Warm');
assert.strictEqual(scoreLabel(55), 'Hot', '55 → Hot');   ok('score 55 → Hot (Interested base alone)');
assert.strictEqual(scoreLabel(74), 'Hot', '74 → Hot');   ok('score 74 → Hot');
assert.strictEqual(scoreLabel(75), 'Ready', '75 → Ready'); ok('score 75 → Ready');

// ── End-to-end label behaviour ──
const now = Date.parse('2026-06-11T12:00:00Z');
const recent = new Date(now - 2 * 86400000).toISOString();

// Contacted, no signals → base 40 → Warm
const cWarm = buildIntelligence({ name: 'C', brandType: 'Skincare', status: 'Contacted', createdAt: recent, lastContacted: recent }, 'c1', null, now);
assert.strictEqual(cWarm.scoreLabel, 'Warm', 'Contacted alone → Warm'); ok(`Contacted (no signals) → ${cWarm.scoreLabel} (score ${cWarm.score})`);

// Interested alone → base 55 → Hot (the explicit requirement)
const iHot = buildIntelligence({ name: 'I', brandType: 'Skincare', status: 'Interested', createdAt: recent, lastContacted: recent }, 'i1', null, now);
assert.strictEqual(iHot.score, 55, 'Interested base = 55');
assert.strictEqual(iHot.scoreLabel, 'Hot', 'Interested base alone → Hot'); ok(`Interested base alone → ${iHot.scoreLabel} (score ${iHot.score})`);

// Contacted + "ready to start selling" (40 + 25) = 65 → Hot
const cReady = buildIntelligence({ name: 'C', brandType: 'Skincare', status: 'Contacted', journey: "I'm ready to start selling", createdAt: recent, lastContacted: recent }, 'c2', null, now);
assert.strictEqual(cReady.scoreLabel, 'Hot', 'Contacted + ready → Hot'); ok(`Contacted + ready journey → ${cReady.scoreLabel} (score ${cReady.score})`);

// Contacted + ready + top budget (40 + 25 + 12) = 77 → Ready
const cReadyTop = buildIntelligence({ name: 'C', brandType: 'Skincare', status: 'Contacted', journey: "I'm ready to start selling", budget: '$1,000+ USD', createdAt: recent, lastContacted: recent }, 'c3', null, now);
assert.strictEqual(cReadyTop.scoreLabel, 'Ready', 'Contacted + ready + top budget → Ready'); ok(`Contacted + ready + $1,000+ → ${cReadyTop.scoreLabel} (score ${cReadyTop.score})`);

// ── isTest / dataQuality ──
assert.strictEqual(assessDataQuality({ name: 'Test 3' }).testReason, 'test_name', 'Test 3 test_name'); ok('"Test 3" → test_name');
assert.strictEqual(assessDataQuality({ name: 'Text2' }).testReason, 'test_name', 'Text2 test_name'); ok('"Text2" → test_name (^text/text\\d)');
assert.strictEqual(assessDataQuality({ name: 'Testianna' }).isTest, true, 'Testianna isTest'); ok('"Testianna" → isTest true');
assert.strictEqual(assessDataQuality({ name: 'X', email: 'najahuldin@gmail.com' }).testReason, 'owner_email', 'owner gmail'); ok('najahuldin@gmail.com → owner_email');
assert.strictEqual(assessDataQuality({ name: 'X', email: 'aiskintherapy@gmail.com' }).testReason, 'owner_email', 'owner gmail2'); ok('aiskintherapy@gmail.com → owner_email');
assert.strictEqual(assessDataQuality({ name: 'X', whatsapp: '+1 876 885 1099' }).testReason, 'owner_phone', 'owner phone'); ok('owner phone 18768851099 → owner_phone');
assert.strictEqual(assessDataQuality({ name: 'QA Bot' }).testReason, 'internal_test', 'qa internal'); ok('"QA Bot" → internal_test');
assert.strictEqual(assessDataQuality({ name: 'Real Person', email: 'rp@x.com' }, { sharedPhone: true }).testReason, 'shared_contact', 'shared'); ok('shared-contact (via context) → shared_contact');
assert.strictEqual(assessDataQuality({ name: 'Ashley Williams', email: 'a@x.com' }).isTest, false, 'real lead not test'); ok('"Ashley Williams" → isTest false');

// Sentence-name → suspicious (NOT test)
const sn = assessDataQuality({ name: 'Kelia Cunningham And Im Doing Skincare , Feminine Amd Make Yoni Products', email: 'k@x.com' });
assert.strictEqual(sn.isTest, false, 'sentence name not test'); assert.strictEqual(sn.suspiciousReason, 'sentence_name', 'sentence suspicious');
ok('sentence-style name → suspiciousLead (sentence_name), isTest=false');

const dqA = assessDataQuality({ name: 'Natisha' });
const dqB = assessDataQuality({ name: 'natisha ' });
assert.strictEqual(dqA.nameKey, dqB.nameKey, 'duplicate Natisha share nameKey'); ok(`duplicate "Natisha" share nameKey="${dqA.nameKey}" (findable downstream)`);

console.log(`\nAll ${n} assertions passed.`);
