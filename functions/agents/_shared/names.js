// Jarvis OS — Lead name sanitization.
//
// Funnel free-text often arrives as "My name is Martinez Brown", "i'm asha", or
// junk/numeric. cleanName() strips lead-in phrases, title-cases, and falls back to
// "this lead" when there's no usable alphabetic name. firstName() returns the first
// token (or "this lead").

const LEAD_IN = /^\s*(?:hi|hello|hey)?[,!.\s]*(?:my name is|name is|i am|i'?m|im|this is|it'?s|its|call me)\s+/i;

function cleanName(raw) {
  let n = (raw == null ? '' : String(raw)).trim();
  n = n.replace(LEAD_IN, '');          // strip "my name is " etc.
  n = n.replace(/[.,!?]+$/, '').trim(); // trailing punctuation
  if (!n || !/[a-z]/i.test(n)) return 'this lead'; // empty / numeric / symbols only
  return n
    .split(/\s+/)
    .map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function firstName(raw) {
  const full = cleanName(raw);
  if (full === 'this lead') return 'this lead';
  return full.split(' ')[0];
}

module.exports = { cleanName, firstName };
