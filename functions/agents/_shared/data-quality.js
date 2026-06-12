// Jarvis OS — Shared lead classification (SINGLE SOURCE OF TRUTH).
// Used by: scorer, jarvis dashboard, and all future agents.
//
// Test/suspicious leads ARE scored and stored (never skipped). They are excluded
// DOWNSTREAM (rankings, pipeline, forecasts, campaigns, contact-guard). Normalized
// keys (emailKey/nameKey/phoneKey) + the duplicates module make dupes findable
// WITHOUT modifying the leads collection.

const OWNER_EMAILS = [
  'start@najahchemist.com',
  'najahuldin@gmail.com',
  'aiskintherapy@gmail.com',
];
const OWNER_PHONES = ['18768851099', '18763499729'];

// Test-name patterns: ^test, ^text, test<digits>, text<digits>.
const TEST_NAME = /^test|^text|test\d+|text\d+/i;
// Internal/QA records.
const INTERNAL_NAME = /\bqa\b|\binternal\b|\bstaff\b|\bdummy\b/i;
// Product/intent words that, with a comma, indicate a funnel answer pasted as a name.
const PRODUCT_WORDS = /(skincare|skin care|feminine|yoni|hair|soap|serum|product|products|make|making|doing|sell|selling|brand)/i;

function normEmail(e) { const v = (e || '').trim().toLowerCase(); return v || null; }
function normName(n)  { const v = (n || '').trim().toLowerCase().replace(/\s+/g, ' '); return v || null; }
function normPhone(p) { const v = (p || '').replace(/\D/g, ''); return v || null; }

// A name that is really an answer, not a name. Flagged suspicious — NOT auto-test.
function isSentenceName(nameRaw) {
  const n = (nameRaw || '').trim();
  if (!n) return false;
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length > 6) return true;
  if (n.includes(',') && PRODUCT_WORDS.test(n)) return true;
  return false;
}

// shared.sharedEmail / shared.sharedPhone are precomputed by the duplicates module
// (a contact appearing across >= threshold leads). Absent for single-lead callers.
function assessDataQuality(lead, shared) {
  shared = shared || {};
  const nameRaw = (lead.name || '').trim();
  const email = normEmail(lead.email);
  const phone = normPhone(lead.whatsapp);

  let isTest = false, testReason = null;
  if (lead.manualTestFlag === true || lead.isTest === true) { isTest = true; testReason = 'manual_flag'; }
  else if (email && OWNER_EMAILS.includes(email))           { isTest = true; testReason = 'owner_email'; }
  else if (phone && OWNER_PHONES.includes(phone))           { isTest = true; testReason = 'owner_phone'; }
  else if (TEST_NAME.test(nameRaw))                         { isTest = true; testReason = 'test_name'; }
  else if (INTERNAL_NAME.test(nameRaw))                     { isTest = true; testReason = 'internal_test'; }
  else if (shared.sharedEmail || shared.sharedPhone)        { isTest = true; testReason = 'shared_contact'; }

  let suspiciousLead = false, suspiciousReason = null;
  if (isSentenceName(nameRaw)) { suspiciousLead = true; suspiciousReason = 'sentence_name'; }

  return {
    isTest, testReason,
    suspiciousLead, suspiciousReason,
    hasName: !!nameRaw && /[a-z]/i.test(nameRaw),
    missingContact: !email && !phone,
    emailKey: email,
    nameKey: normName(lead.name),
    phoneKey: phone,
  };
}

module.exports = {
  assessDataQuality, isSentenceName,
  normEmail, normName, normPhone,
  OWNER_EMAILS, OWNER_PHONES,
};
