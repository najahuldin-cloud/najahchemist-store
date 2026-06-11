// Jarvis OS — Maps a lead's segment → recommendedOffer (rule-sourced), plus the
// reasons other offers were NOT recommended (whyNot). Offers are real Najah SKUs.

const { rule } = require('./rule-values');

// Canonical offer catalogue (J$). Values are rule-sourced first-order assumptions.
const OFFERS = {
  skincare: { name: 'HydraGlow Skincare Bundle',      value: rule(25200, 0.5) },
  feminine: { name: 'Feminine Care Starter Kit',      value: rule(12500, 0.5) },
  mens:     { name: 'Mencare Bundle',                 value: rule(11000, 0.5) },
  haircare: { name: '1L Ayurvedic Hair Growth Oil',   value: rule(7500, 0.5) },
  general:  { name: 'Starter Litre (single product)', value: rule(7500, 0.4) },
};

// Mirrors leadSegment() in admin-module.js / functions/index.js.
function segmentKey(brandType) {
  const b = (brandType || '').toLowerCase().trim();
  if (b.includes('hair')) return 'haircare';
  if (b.includes('feminine') || b.includes('yoni')) return 'feminine';
  if (b.includes('men')) return 'mens';
  if (b.includes('skin') || b.includes('body') || b.includes('face')) return 'skincare';
  return 'general';
}

function recommendOffer(brandType) {
  const key = segmentKey(brandType);
  const offer = OFFERS[key];
  const offered = { key, name: offer.name, value: offer.value };
  const whyNot = Object.entries(OFFERS)
    .filter(([k]) => k !== key)
    .map(([k, o]) => `${o.name} not recommended — lead segment is ${key}, not ${k}.`);
  return { offered, whyNot, segmentKey: key };
}

module.exports = { OFFERS, segmentKey, recommendOffer };
