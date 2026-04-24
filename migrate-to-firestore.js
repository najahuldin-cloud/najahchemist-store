#!/usr/bin/env node
// migrate-to-firestore.js
// One-time script: writes all 58 products to STAGING Firestore using the new variant schema.
//
// BEFORE RUNNING:
//   1. Download the staging Firebase service account key from:
//      Firebase Console → najah-chemist-staging → Project Settings → Service Accounts → Generate new private key
//   2. Save it as staging-service-account.json in this directory (it is gitignored)
//      OR set env var: FIREBASE_STAGING_SERVICE_ACCOUNT='{ ...json... }'
//
// RUN:
//   node migrate-to-firestore.js
//
// This script is safe to re-run — it uses setDoc (upsert), not addDoc.

import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';

// ── Staging Firebase config ────────────────────────────────────────────────
const STAGING_PROJECT_ID = 'najah-chemist-staging';

function getServiceAccount() {
  if (process.env.FIREBASE_STAGING_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_STAGING_SERVICE_ACCOUNT);
  }
  const localFile = new URL('./staging-service-account.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  if (existsSync(localFile)) {
    return JSON.parse(readFileSync(localFile, 'utf8'));
  }
  console.error('ERROR: No service account found.');
  console.error('  Option A: Set env var FIREBASE_STAGING_SERVICE_ACCOUNT with the full JSON');
  console.error('  Option B: Save staging-service-account.json in the repo root');
  console.error('  Get the key from: Firebase Console → najah-chemist-staging → Project Settings → Service Accounts');
  process.exit(1);
}

const serviceAccount = getServiceAccount();
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: STAGING_PROJECT_ID,
});
const db = admin.firestore();

// ── Helpers ────────────────────────────────────────────────────────────────

function toKebab(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const CAT_DISPLAY = {
  yoni:     'Yoni Care',
  skincare: 'Skin Care',
  soap:     'Bar Soaps',
  mencare:  'Men Care',
  haircare: 'Hair Care',
  bundle:   'Bundles',
  label:    'Design Services',
};

const CAT_CODE = {
  yoni:     'YC',
  skincare: 'SK',
  soap:     'SP',
  mencare:  'MC',
  haircare: 'HC',
  bundle:   'BN',
  label:    'DS',
};

// Size key → { label, weightKg }
const SIZE_MAP = {
  litre:    { label: '1 Litre',        weightKg: 1    },
  gallon:   { label: '1 Gallon',       weightKg: 4    },
  '5gal':   { label: '5 Gallon',       weightKg: 20   },
  '2gal':   { label: '2 Gallon',       weightKg: 8    },
  '10gal':  { label: '10 Gallon',      weightKg: 40   },
  lb2:      { label: '2 lbs',          weightKg: 1    },
  lb8:      { label: '8 lbs',          weightKg: 4    },
  lb40:     { label: '40 lbs',         weightKg: 18   },
  bars10:   { label: '10 Bars',        weightKg: 2    },
  bars100:  { label: '100 Bars',       weightKg: 20   },
  caps100:  { label: '100 Capsules',   weightKg: 0.5  },
  caps1000: { label: '1000 Capsules',  weightKg: 2    },
  halfLb:   { label: '0.5 lb',         weightKg: 0.5  },
  lb1:      { label: '1 lb',           weightKg: 0.5  },
  kit:      { label: 'Bundle Kit',     weightKg: 1    },
  design:   { label: '1 Design',       weightKg: 0    },
};

// Size key → SKU suffix
const SKU_SUFFIX = {
  litre:    '1L',
  gallon:   '1G',
  '5gal':   '5G',
  '2gal':   '2G',
  '10gal':  '10G',
  lb2:      '2LB',
  lb8:      '8LB',
  lb40:     '40LB',
  bars10:   '10B',
  bars100:  '100B',
  caps100:  '100C',
  caps1000: '1KC',
  halfLb:   'HL',
  lb1:      '1LB',
  kit:      'KIT',
  design:   '1D',
};

// Products that have scent + mint selector
const MINT_SCENT_IDS = new Set(['yw1', 'vm1', 'yo1', 'yop1']);
// Products with scent-only selector
const SCENT_ONLY_IDS = new Set(['yfs1', 'ybs1', 'bsc1', 'bbs1', 'bb1', 'bbb1', 'ybar1']);
const ALL_SCENTS = ['Unscented', 'Strawberry', 'Watermelon', 'Coconut', 'Lavender', 'Pineapple'];

function getScents(oldId) {
  if (MINT_SCENT_IDS.has(oldId) || SCENT_ONLY_IDS.has(oldId)) return ALL_SCENTS;
  return [];
}

// Sequential SKU counters per category
const catCounters = {};
function nextSku(cat, sizeKey) {
  if (!catCounters[cat]) catCounters[cat] = 0;
  catCounters[cat]++;
  const code = CAT_CODE[cat] || 'XX';
  const num  = String(catCounters[cat]).padStart(2, '0');
  const suf  = SKU_SUFFIX[sizeKey] || sizeKey.toUpperCase();
  return `NC-${code}${num}-${suf}`;
}

// Build variants array from old pricing object
function buildVariants(pricing, cat, oldId, productName) {
  const sizeKeys = Object.keys(pricing);
  return sizeKeys.map((sizeKey) => {
    const sizeInfo = SIZE_MAP[sizeKey];
    if (!sizeInfo) {
      console.warn(`  ⚠  Unknown size key "${sizeKey}" on "${productName}" — using defaults`);
    }
    return {
      size:              sizeInfo ? sizeInfo.label : sizeKey,
      sku:               nextSku(cat, sizeKey),
      price:             pricing[sizeKey].price,
      shippingWeightKg:  sizeInfo ? sizeInfo.weightKg : 1,
      scents:            getScents(oldId),
    };
  });
}

// Transform old product → new Firestore document
function transform(p) {
  return {
    id:          toKebab(p.name),
    legacyId:    p.id,
    name:        p.name,
    category:    CAT_DISPLAY[p.cat] || p.cat,
    tagline:     p.tagline || '',
    description: p.tagline || '',
    emoji:       p.emoji || '',
    tag:         p.tag   || '',
    img:         p.img   || '',
    ingredients: p.ingredients || '',
    benefits:    p.benefits || [],
    warnings:    p.usage   || '',
    isActive:    true,
    isHidden:    p.hidden === true,
    variants:    buildVariants(p.pricing, p.cat, p.id, p.name),
  };
}

// ── Products (from migrate-products.js + scent config from storefront.js) ──

const PRODUCTS = [
  // ═══ YONI CARE (15) ═══
  {id:'yw1',  name:'Yoni Foaming Wash',              cat:'yoni',     hidden:false, tagline:'Gentle daily feminine wash — 6 scents available',            pricing:{litre:{price:3550},gallon:{price:12500},'5gal':{price:56250}}, ingredients:'Organic Herbal Blend, Mint Extract, Tea Tree Oil, Aloe Vera, Vitamin E',                        benefits:['Daily Freshness','pH Balance','Herbal Protection','6 Scents Available'], usage:'Apply externally during shower. Rinse thoroughly. Do not use internally.'},
  {id:'yfs1', name:'Yoni Foaming Scrub',             cat:'yoni',     hidden:false, tagline:'Exfoliating feminine scrub for smooth, fresh skin',           pricing:{lb2:{price:4000},lb8:{price:14500},lb40:{price:65250}},          ingredients:'Exfoliating Sugar Crystals, Herbal Blend, Aloe Vera, Vitamin E',                               benefits:['Exfoliation','Smooth Skin','Freshness','Effective Formulation'],         usage:'Apply to external areas, scrub gently, rinse. Use 2-3 times per week.'},
  {id:'ybs1', name:'Yoni Brightening Scrub',         cat:'yoni',     hidden:false, tagline:'Brightening exfoliant for intimate areas',                    pricing:{lb2:{price:5500},lb8:{price:20500},lb40:{price:92250}},          ingredients:'Kojic Acid, Sugar Crystals, Herbal Blend, Vitamin C, Aloe Vera',                               benefits:['Brightening','Exfoliation','Even Tone','Smooth Skin'],                   usage:'Apply to external areas, massage gently, rinse. Use 2-3 times per week.'},
  {id:'yo1',  name:'Yoni Oil (Without Petals)',       cat:'yoni',     hidden:false, tagline:'Nourishing botanical oil for intimate skin',                  pricing:{litre:{price:5500},gallon:{price:19500},'5gal':{price:87750}},  ingredients:'Jojoba Oil, Sweet Almond Oil, Lavender Essential Oil, Chamomile, Vitamin E',                    benefits:['Moisture','Skin Softening','Odour Control','Natural Scent'],             usage:'Apply externally. A few drops go a long way.'},
  {id:'yop1', name:'Yoni Oil (With Petals)',          cat:'yoni',     hidden:false, tagline:'Luxurious floral oil for intimate care',                      pricing:{litre:{price:6300},gallon:{price:24200},'5gal':{price:108900}}, ingredients:'Jojoba Oil, Rose Petals, Sweet Almond Oil, Chamomile, Vitamin E',                               benefits:['Luxury Feel','Moisture','Skin Softening','Floral Scent'],                usage:'Apply externally. A few drops go a long way.'},
  {id:'vm1',  name:'VagiMist',                        cat:'yoni',     hidden:false, tagline:'Refreshing intimate mist for on-the-go freshness',            pricing:{litre:{price:4600},gallon:{price:14500},'5gal':{price:65250}},  ingredients:'Rose Water, Aloe Vera, Chamomile, Witch Hazel, Essential Oils',                                 benefits:['Instant Freshness','pH Balance','Soothing','Travel Friendly'],           usage:'Spray externally as needed throughout the day.'},
  {id:'bpw1', name:'Boric Acid & Probiotics Gel Wash',cat:'yoni',    hidden:false, tagline:'pH-balancing gel wash with probiotics',                       pricing:{litre:{price:4200},gallon:{price:15000},'5gal':{price:67500}},  ingredients:'Boric Acid, Probiotic Complex, Aloe Vera, Chamomile, Lactic Acid',                             benefits:['pH Balance','Odour Control','Probiotic Protection','Irritation Relief'], usage:'Apply externally. Rinse thoroughly. Do not use internally.'},
  {id:'yp1',  name:'Yoni Pops Capsules',              cat:'yoni',     hidden:false, tagline:'Vaginal health capsules — 100 or 1000 count',                 pricing:{caps100:{price:8000},caps1000:{price:70000}},                    ingredients:'Boric Acid, Probiotic Blend, Herbal Extracts',                                                 benefits:['Vaginal pH','Odour Control','Infection Prevention','Wellness'],          usage:'Insert one capsule as directed. Consult a healthcare provider before use.'},
  {id:'bac1', name:'Boric Acid Capsules',             cat:'yoni',     hidden:false, tagline:'Vaginal health boric acid capsules',                          pricing:{caps100:{price:3750},caps1000:{price:26500}},                    ingredients:'Boric Acid, Vegetable Capsule',                                                                benefits:['pH Balance','Odour Control','Yeast Infection Relief','BV Support'],      usage:'Insert one capsule vaginally as directed. Not for oral use.'},
  {id:'itc1', name:'Inner Thigh Cream',               cat:'yoni',     hidden:true,  tagline:'Brightening cream for inner thighs and intimate areas',       pricing:{lb2:{price:16650},lb8:{price:60000},lb40:{price:270000}},        ingredients:'Alpha Arbutin, Kojic Acid, Niacinamide, Shea Butter, Vitamin C',                               benefits:['Brightening','Dark Spots','Even Tone','Moisturizing'],                   usage:'Apply to inner thighs and intimate areas twice daily.'},
  {id:'yaic1',name:'Yoni Anti-Itch Cream',            cat:'yoni',     hidden:false, tagline:'Fast relief from intimate itching and irritation',            pricing:{lb2:{price:9000},lb8:{price:32800},lb40:{price:147600}},         ingredients:'Aloe Vera, Tea Tree Oil, Calendula, Zinc Oxide, Chamomile',                                    benefits:['Itch Relief','Soothing','Anti-Inflammatory','Fast Acting'],              usage:'Apply a small amount to affected area as needed.'},
  {id:'ybar1',name:'Yoni Bar Soap',                   cat:'yoni',     hidden:false, tagline:'10 x 4oz handcrafted feminine bar soaps',                     pricing:{bars10:{price:6500},bars100:{price:63000}},                      ingredients:'Shea Butter, Coconut Oil, Herbal Blend, Tea Tree Oil, Aloe Vera',                               benefits:['Daily Cleanse','Herbal Protection','pH Safe','Effective Formulation'],   usage:'Lather onto wet skin, massage gently. Rinse well.'},
  {id:'ysh1', name:'Yoni Steam Herbs',                cat:'yoni',     hidden:false, tagline:'Traditional herbal blend for vaginal steaming',               pricing:{halfLb:{price:5600},lb1:{price:9800}},                           ingredients:'Mugwort, Lavender, Rose Petals, Chamomile, Oregano, Calendula',                                 benefits:['Uterine Health','Circulation','Cleansing','Relaxation'],                 usage:'Follow vaginal steam protocols. Steam for 15-20 minutes.'},
  {id:'fd1',  name:'Fertility Drops',                 cat:'yoni',     hidden:true,  tagline:'Herbal tincture to support reproductive wellness',            pricing:{litre:{price:12500},gallon:{price:48500},'5gal':{price:218250}},ingredients:'Maca Root, Vitex, Red Raspberry Leaf, Dong Quai, Herbal Extracts',                              benefits:['Hormonal Balance','Cycle Regulation','Reproductive Support','Natural Herbs'],usage:'Take as directed. Consult a healthcare provider before use.'},
  {id:'mac1', name:'Maca Root Capsules',              cat:'yoni',     hidden:false, tagline:'Energy, libido and hormonal balance support',                 pricing:{caps100:{price:4750},caps1000:{price:47500}},                    ingredients:'Organic Maca Root Powder, Vegetable Capsule',                                                  benefits:['Energy','Libido','Hormonal Balance','Fertility Support'],                usage:'Take 1-2 capsules daily with food.'},

  // ═══ SKIN CARE (14) ═══
  {id:'srt1', name:'Soothing Rose Toner',             cat:'skincare', hidden:false, tagline:'Calming rose toner for balanced, glowing skin',               pricing:{litre:{price:6000},gallon:{price:25000},'5gal':{price:112500}}, ingredients:'Rose Water, Aloe Vera, Hyaluronic Acid, Niacinamide, Glycerin',                                 benefits:['Soothing','Hydration','Pore Tightening','Glow'],                         usage:'Apply after cleansing with a cotton pad or spritz directly onto face.'},
  {id:'gat1', name:'Glycolic Acid AHA Toner',         cat:'skincare', hidden:false, tagline:'Exfoliating AHA toner for smooth, bright skin',               pricing:{litre:{price:7000},gallon:{price:27500},'5gal':{price:123750}}, ingredients:'Glycolic Acid (AHA), Lactic Acid, Aloe Vera, Rose Water, Panthenol',                            benefits:['Exfoliation','Brightening','Pore Minimizing','Texture'],                 usage:'Apply after cleansing. Use PM only. Always wear SPF in the AM.'},
  {id:'tfc1', name:'Turmeric Facial Cleanser',        cat:'skincare', hidden:false, tagline:'Brightening cleanser with anti-inflammatory turmeric',         pricing:{litre:{price:4200},gallon:{price:16000},'5gal':{price:72000}},  ingredients:'Turmeric Extract, Vitamin C, Honey, Coconut-Based Surfactant, Aloe Vera',                      benefits:['Brightening','Anti-Inflammatory','Deep Cleanse','Acne'],                 usage:'Massage onto wet face, rinse thoroughly. Use AM and PM.'},
  {id:'po1',  name:'Peeling Oil',                     cat:'skincare', hidden:false, tagline:'Powerful exfoliating oil for smooth, renewed skin',            pricing:{litre:{price:24500},gallon:{price:97000},'5gal':{price:436500}},ingredients:'AHA/BHA Complex, Jojoba Oil, Rosehip Oil, Papaya Enzyme, Vitamin C',                            benefits:['Deep Exfoliation','Skin Renewal','Brightening','Anti-Aging'],            usage:'Apply to dry skin, massage until it pills. Rinse. Use 2x weekly. Always use SPF after.'},
  {id:'ls1',  name:'Lightening Serum',                cat:'skincare', hidden:false, tagline:'Powerful brightening serum for dark spots',                    pricing:{litre:{price:17000},gallon:{price:58000},'5gal':{price:261000}},ingredients:'Alpha Arbutin, Kojic Acid, Niacinamide, Vitamin C, Hyaluronic Acid',                             benefits:['Dark Spots','Hyperpigmentation','Brightening','Even Tone'],              usage:'Apply 2-3 drops to clean skin. AM and PM. Use SPF in the morning.'},
  {id:'has1', name:'Hyaluronic Acid Serum',           cat:'skincare', hidden:false, tagline:'Intense hydration with multi-weight hyaluronic acid',           pricing:{litre:{price:13000},gallon:{price:50000},'5gal':{price:225000}},ingredients:'Hyaluronic Acid (Multi-Weight), Niacinamide 5%, Vitamin B5, Glycerin, Aloe Vera',               benefits:['Deep Hydration','Plumping','Pore Minimizing','Fine Lines'],              usage:'Apply 2-3 drops to clean skin. Pat gently. Follow with moisturizer.'},
  {id:'ros1', name:'Rose Oil Serum',                  cat:'skincare', hidden:false, tagline:'Luxurious rose oil serum for radiant, youthful skin',          pricing:{litre:{price:12500},gallon:{price:48000},'5gal':{price:216000}},ingredients:'Rose Hip Oil, Rose Essential Oil, Vitamin E, Jojoba Oil, Squalane',                             benefits:['Anti-Aging','Radiance','Hydration','Scar Fading'],                       usage:'Apply 2-3 drops to clean skin at night.'},
  {id:'pays1',name:'Papaya Serum',                    cat:'skincare', hidden:false, tagline:'Enzyme-rich papaya serum for bright, smooth skin',             pricing:{litre:{price:17000},gallon:{price:58000},'5gal':{price:261000}},ingredients:'Papaya Enzyme, Kojic Acid, Vitamin C, AHA Complex, Aloe Vera',                                  benefits:['Brightening','Exfoliation','Dark Spots','Enzyme Action'],                usage:'Apply to clean skin. AM and PM. Always use SPF in the morning.'},
  {id:'payo1',name:'Papaya Oil',                      cat:'skincare', hidden:false, tagline:'Nourishing papaya oil for glowing skin',                       pricing:{litre:{price:12500},gallon:{price:48000},'5gal':{price:216000}},ingredients:'Papaya Seed Oil, Vitamin E, Jojoba Oil, Rosehip Oil',                                          benefits:['Brightening','Nourishing','Anti-Aging','Radiance'],                     usage:'Apply a few drops to clean skin or mix with moisturizer.'},
  {id:'hmo1', name:'Hydrating Moisturiser',           cat:'skincare', hidden:false, tagline:'Rich daily moisturizer for plump, hydrated skin',              pricing:{lb2:{price:8300},lb8:{price:32000},lb40:{price:144000}},         ingredients:'Shea Butter, Hyaluronic Acid, Glycerin, Vitamin E, Aloe Vera, Ceramides',                      benefits:['Deep Hydration','Barrier Repair','Plumping','All Skin Types'],           usage:'Apply morning and night after serum.'},
  {id:'srem1',name:'Spot Remover',                    cat:'skincare', hidden:false, tagline:'Targeted treatment for dark spots and blemishes',              pricing:{lb2:{price:16650},lb8:{price:55000},lb40:{price:247500}},        ingredients:'Alpha Arbutin, Kojic Acid, Salicylic Acid, Niacinamide, Vitamin C',                            benefits:['Dark Spots','Blemishes','Post-Acne','Even Tone'],                        usage:'Apply directly to spots twice daily. Results in 4-6 weeks.'},
  {id:'slc1', name:'Strong Lightening Cream',         cat:'skincare', hidden:false, tagline:'Professional-grade brightening and lightening cream',           pricing:{lb2:{price:16650},lb8:{price:80000},lb40:{price:360000}},        ingredients:'Kojic Acid, Alpha Arbutin, Glutathione, Niacinamide, Retinol, Vitamin C',                      benefits:['Lightening','Brightening','Dark Spots','Hyperpigmentation'],             usage:'Apply at night. Start 2x per week, increase gradually. Always use SPF.'},
  {id:'tfs1', name:'Turmeric Facial Scrub',           cat:'skincare', hidden:false, tagline:'Brightening exfoliant with anti-inflammatory turmeric',         pricing:{lb2:{price:4400},lb8:{price:16500},lb40:{price:74250}},          ingredients:'Turmeric Powder, Sugar Crystals, Honey, Coconut Oil, Vitamin C',                               benefits:['Exfoliation','Brightening','Anti-Inflammatory','Glow'],                  usage:'Apply to wet face, scrub gently 1-2 mins. Rinse. Use 2-3x per week.'},
  {id:'tfm1', name:'Turmeric Facial Mask',            cat:'skincare', hidden:false, tagline:'Deep brightening mask with turmeric and botanicals',            pricing:{lb2:{price:4300},lb8:{price:16500},lb40:{price:74250}},          ingredients:'Turmeric, Kaolin Clay, Honey, Aloe Vera, Vitamin C, Rose Hip',                                 benefits:['Brightening','Deep Cleanse','Anti-Inflammatory','Glow'],                 usage:'Apply to clean face for 15-20 mins. Rinse. Use 1-2x per week.'},

  // ═══ BODY CARE (4) — cat is 'skincare' in source but body-oriented ═══
  {id:'bsc1', name:'Body Scrub',                      cat:'skincare', hidden:false, tagline:'Sugar body scrub for silky smooth skin',                       pricing:{lb2:{price:4000},lb8:{price:14000},lb40:{price:63000}},          ingredients:'Sugar Crystals, Coconut Oil, Shea Butter, Vitamin E, Essential Oils',                          benefits:['Exfoliation','Smooth Skin','Moisturizing','Full Body'],                  usage:'Massage onto wet skin in circular motions. Rinse. Use 2-3x per week.'},
  {id:'bbs1', name:'Brightening Body Scrub',          cat:'skincare', hidden:false, tagline:'Brightening body scrub for even, luminous skin',               pricing:{lb2:{price:5500},lb8:{price:21500},lb40:{price:96750}},          ingredients:'Kojic Acid, Sugar Crystals, Vitamin C, Niacinamide, Coconut Oil',                              benefits:['Brightening','Exfoliation','Even Tone','Luminous Skin'],                 usage:'Massage onto wet skin in circular motions. Rinse. Use 2-3x per week.'},
  {id:'bb1',  name:'Body Butter',                     cat:'skincare', hidden:false, tagline:'Rich whipped body butter for deep moisturization',              pricing:{lb2:{price:4000},lb8:{price:15000},lb40:{price:67500}},          ingredients:'Shea Butter, Mango Butter, Coconut Oil, Vitamin E, Essential Oils',                            benefits:['Deep Moisturizing','Soft Skin','Long-Lasting','Effective Formulation'],  usage:'Apply to skin after bath while slightly damp for best absorption.'},
  {id:'bbb1', name:'Brightening Body Butter',         cat:'skincare', hidden:false, tagline:'Brightening whipped butter for even, glowing skin',             pricing:{lb2:{price:6500},lb8:{price:25500},lb40:{price:114750}},         ingredients:'Shea Butter, Kojic Acid, Vitamin C, Alpha Arbutin, Coconut Oil',                               benefits:['Brightening','Deep Moisturizing','Even Tone','Glowing Skin'],            usage:'Apply to skin after bath. Use daily for best brightening results.'},

  // ═══ BAR SOAPS (10) ═══
  {id:'gls1', name:'Garlic & Lavender Soap',          cat:'soap',     hidden:false, tagline:'For eczema, psoriasis and liver spots — pack of 10',           pricing:{bars10:{price:6500}},                                            ingredients:'Garlic Extract, Lavender Essential Oil, Oat Bran, Shea Butter, Coconut Oil',                   benefits:['Eczema','Psoriasis','Liver Spots','Sensitive Skin'],                     usage:'Use on affected areas daily.'},
  {id:'kts1', name:'Kojic & Turmeric Soap',           cat:'soap',     hidden:false, tagline:'For acne, dark spots and uneven skin tone — pack of 10',        pricing:{bars10:{price:6500}},                                            ingredients:'Kojic Acid, Turmeric Extract, Shea Butter, Coconut Oil, Vitamin E',                           benefits:['Acne','Dark Spots','Brightening','Even Tone'],                           usage:'Use daily as a regular soap.'},
  {id:'sas1', name:'Salicylic Acid Soap',             cat:'soap',     hidden:false, tagline:'Deep pore cleansing BHA soap — pack of 10',                    pricing:{bars10:{price:7500}},                                            ingredients:'Salicylic Acid (BHA), Tea Tree Oil, Activated Charcoal, Coconut Oil',                          benefits:['Acne','Clogged Pores','Blackheads','Oily Skin'],                         usage:'Lather on damp skin 1-2 minutes. Use 2-3x weekly.'},
  {id:'gas1', name:'Glycolic Acid Soap',              cat:'soap',     hidden:false, tagline:'AHA exfoliating soap for smooth, bright skin — pack of 10',    pricing:{bars10:{price:7500}},                                            ingredients:'Glycolic Acid, AHA Complex, Shea Butter, Coconut Oil, Willow Bark',                            benefits:['Exfoliation','Brightening','Pore Minimizing','Fine Lines'],              usage:'Use 2-3 times per week. Follow with moisturizer.'},
  {id:'vcs1', name:'Vitamin C Soap',                  cat:'soap',     hidden:false, tagline:'Brightening antioxidant soap — pack of 10',                     pricing:{bars10:{price:7500}},                                            ingredients:'Vitamin C (Ascorbic Acid), Citrus Extract, Kojic Acid, Shea Butter',                           benefits:['Brightening','Antioxidant','Even Tone','Acne'],                          usage:'Use daily as a regular soap.'},
  {id:'paps1',name:'Papaya Soap',                     cat:'soap',     hidden:false, tagline:'Enzyme-rich papaya soap for bright skin — pack of 10',          pricing:{bars10:{price:7500}},                                            ingredients:'Papaya Enzyme, Kojic Acid, Vitamin C, Shea Butter, Coconut Oil',                               benefits:['Brightening','Enzyme Exfoliation','Even Tone','Glow'],                   usage:'Use daily as a regular soap.'},
  {id:'tos1', name:'Turmeric Only Soap',              cat:'soap',     hidden:false, tagline:'Pure turmeric brightening soap — pack of 10',                   pricing:{bars10:{price:6500}},                                            ingredients:'Turmeric Extract, Shea Butter, Coconut Oil, Castor Oil, Vitamin E',                            benefits:['Brightening','Anti-Inflammatory','Acne','Effective Formulation'],        usage:'Use daily as a regular soap.'},
  {id:'kos1', name:'Kojic Only Soap',                 cat:'soap',     hidden:false, tagline:'Pure kojic acid brightening soap — pack of 10',                 pricing:{bars10:{price:6500}},                                            ingredients:'Kojic Acid, Shea Butter, Coconut Oil, Castor Oil, Vitamin E',                                  benefits:['Brightening','Dark Spots','Even Tone','Hyperpigmentation'],              usage:'Use daily as a regular soap.'},
  {id:'kcs1', name:'Kojic & Charcoal Soap',           cat:'soap',     hidden:false, tagline:'Detoxifying brightening soap — pack of 10',                     pricing:{bars10:{price:7500}},                                            ingredients:'Kojic Acid, Activated Charcoal, Shea Butter, Coconut Oil, Tea Tree Oil',                       benefits:['Brightening','Detoxifying','Acne','Deep Cleanse'],                       usage:'Use daily as a regular soap.'},
  {id:'slbs1',name:'Skin Lightening Bar Soap',        cat:'soap',     hidden:false, tagline:'Professional skin lightening soap — pack of 10',                pricing:{bars10:{price:8000}},                                            ingredients:'Kojic Acid, Glutathione, Alpha Arbutin, Snow White Complex, Coconut Oil',                      benefits:['Lightening','Brightening','Dark Spots','Even Complexion'],               usage:'Use daily. Results visible in 4-6 weeks. Always apply SPF in the morning.'},

  // ═══ MEN CARE (7) ═══
  {id:'bbal1',name:'Beard Balm',                      cat:'mencare',  hidden:false, tagline:'Conditioning balm for styled, healthy beards',                 pricing:{lb2:{price:5500},lb8:{price:18500},lb40:{price:83250}},         ingredients:'Shea Butter, Beeswax, Coconut Oil, Argan Oil, Vitamin E, Essential Oils',                      benefits:['Beard Conditioning','Styling','Moisturizing','Itch Relief'],             usage:'Scoop a small amount, warm in palms, apply to beard and style.'},
  {id:'bsh1', name:'Beard Shampoo',                   cat:'mencare',  hidden:false, tagline:'Cleansing beard wash for healthy, soft facial hair',            pricing:{litre:{price:4700},gallon:{price:17600},'5gal':{price:79200}},  ingredients:'Coconut-Based Surfactant, Argan Oil, Tea Tree Oil, Aloe Vera, Panthenol',                       benefits:['Deep Cleanse','Softening','Dandruff Control','Refreshing'],              usage:'Wet beard, apply shampoo, massage, rinse. Use 2-3x per week.'},
  {id:'bo1',  name:'Beard Oil',                       cat:'mencare',  hidden:false, tagline:'Premium blend beard oil for growth and shine',                  pricing:{litre:{price:6750},gallon:{price:25500},'5gal':{price:114750}}, ingredients:'Argan Oil, Jojoba Oil, Castor Oil, Vitamin E, Essential Oils',                                  benefits:['Beard Growth','Shine','Softening','Moisturizing'],                       usage:'Apply 2-5 drops to palms, massage into beard and skin underneath daily.'},
  {id:'rw1',  name:'Ryfle Wash',                      cat:'mencare',  hidden:false, tagline:'Masculine intimate wash for men',                               pricing:{litre:{price:3750},gallon:{price:14000},'5gal':{price:63000}},  ingredients:'Herbal Blend, Tea Tree Oil, Aloe Vera, Menthol, Vitamin E',                                    benefits:['Daily Freshness','pH Balance','Cooling Effect','Masculine Scent'],       usage:'Apply externally during shower. Rinse thoroughly.'},
  {id:'jl1',  name:'Jock Lube',                       cat:'mencare',  hidden:true,  tagline:'Intimate lubricant for men — smooth and long-lasting',          pricing:{litre:{price:6550},gallon:{price:25500},'5gal':{price:114750}}, ingredients:'Aloe Vera, Glycerin, Hydroxyethylcellulose, Vitamin E',                                         benefits:['Lubrication','Comfort','Long-Lasting','Skin-Safe'],                      usage:'Apply as needed.'},
  {id:'jm1',  name:'Jock Mist',                       cat:'mencare',  hidden:true,  tagline:'Refreshing intimate mist for men',                              pricing:{litre:{price:4850},gallon:{price:18800},'5gal':{price:84600}},  ingredients:'Rose Water, Witch Hazel, Aloe Vera, Menthol, Tea Tree Oil',                                    benefits:['Instant Freshness','Cooling','Odour Control','pH Balance'],              usage:'Spray externally as needed throughout the day.'},
  {id:'ji1',  name:'Jock Itch Cream',                 cat:'mencare',  hidden:true,  tagline:'Fast relief from jock itch and intimate irritation',            pricing:{lb2:{price:9500},lb8:{price:32800},lb40:{price:147600}},         ingredients:'Tea Tree Oil, Zinc Oxide, Aloe Vera, Calendula, Chamomile Extract',                            benefits:['Itch Relief','Anti-Fungal','Soothing','Fast Acting'],                    usage:'Apply a small amount to affected area 2-3x daily.'},

  // ═══ HAIR CARE (3) ═══
  {id:'hmi1', name:'Hair Mist',                       cat:'haircare', hidden:false, tagline:'Hydrating hair mist for moisture and shine',                    pricing:{litre:{price:5500},gallon:{price:20000},'5gal':{price:90000}},  ingredients:'Rose Water, Aloe Vera, Glycerin, Argan Oil, Panthenol',                                         benefits:['Hydration','Shine','Frizz Control','Refreshing'],                        usage:'Spray onto hair as needed. Works on wet or dry hair.'},
  {id:'hbu1', name:'Hair Butter',                     cat:'haircare', hidden:false, tagline:'Nourishing hair butter for thick, strong hair',                 pricing:{lb2:{price:4600},lb8:{price:18500},lb40:{price:83250}},          ingredients:'Shea Butter, Castor Oil, Coconut Oil, Argan Oil, Vitamin E',                                   benefits:['Moisture','Strength','Growth','Thick Hair'],                             usage:'Apply to hair, focusing on ends and dry areas. Style as desired.'},
  {id:'hgo1', name:'Hair Growth Oil',                 cat:'haircare', hidden:false, tagline:'Stimulating oil blend for hair growth and strength',            pricing:{litre:{price:7500},gallon:{price:28000},'5gal':{price:126000}}, ingredients:'Castor Oil, Rosemary Essential Oil, Peppermint Oil, Argan Oil, Vitamin E',                      benefits:['Hair Growth','Scalp Stimulation','Strength','Thickness'],                usage:'Massage into scalp 2-3x per week. Leave in or rinse.'},

  // ═══ BUNDLES (4) ═══
  {id:'skb1', name:'Starter Kit Beginner Bundle',     cat:'bundle',   hidden:false, tagline:'Everything you need to start your yoni care journey',           pricing:{kit:{price:12500}},                                              ingredients:'Includes: Yoni Foaming Wash, Yoni Oil, Boric Acid Capsules and more',                          benefits:['Complete Kit','Best Value','Beginner Friendly','Full Routine'],          usage:'Follow individual product instructions included in kit.'},
  {id:'gni1', name:'Girls Night In Luxury Bundle',    cat:'bundle',   hidden:false, tagline:'Luxurious pampering bundle for the ultimate self-care night',   pricing:{kit:{price:13000}},                                              ingredients:'Includes: Premium skincare and yoni care products for a full pamper session',                   benefits:['Luxury Experience','Full Pamper','Great Gift','Premium Products'],       usage:'Follow individual product instructions.'},
  {id:'mcb1', name:'Mencare Bundle',                  cat:'bundle',   hidden:false, tagline:'Complete grooming kit for men',                                  pricing:{kit:{price:11000}},                                              ingredients:'Includes: Beard Balm, Beard Shampoo, Beard Oil, Ryfle Wash',                                   benefits:['Complete Grooming','Great Value','Beard Care','Intimate Care'],          usage:'Follow individual product instructions.'},
  {id:'skb2', name:'Skincare Bundle',                 cat:'bundle',   hidden:false, tagline:'Complete skincare routine in one bundle',                        pricing:{kit:{price:25500}},                                              ingredients:'Includes: Toner, Serum, Moisturiser, Facial Scrub and Mask',                                   benefits:['Full Routine','Great Value','All Skin Types','Premium Products'],        usage:'Follow individual product instructions for a complete skincare routine.'},

  // ═══ DESIGN SERVICES (1) ═══
  {id:'ld1',  name:'Label Design',                    cat:'label',    hidden:false, tagline:'Professional product label design — 1 product',                pricing:{design:{price:3000}},                                            ingredients:'Includes: Custom design, revisions, print-ready files',                                         benefits:['Professional Design','Custom Brand','Print Ready','Fast Turnaround'],    usage:'Contact us with your brand brief. Delivery via email.'},
];

// ── Main migration ──────────────────────────────────────────────────────────

async function migrate() {
  console.log(`\nNajah Chemist — Product Migration to Staging Firestore`);
  console.log(`Project: ${STAGING_PROJECT_ID}`);
  console.log(`Products: ${PRODUCTS.length}\n`);

  let ok = 0, fail = 0;

  for (const p of PRODUCTS) {
    try {
      const doc = transform(p);
      await db.collection('products').doc(doc.id).set(doc);
      const variantSummary = doc.variants.map(v => `${v.size} @ J$${v.price.toLocaleString()}`).join(', ');
      console.log(`  ✓ [${doc.id}]  ${doc.name}  (${doc.variants.length} variant${doc.variants.length !== 1 ? 's' : ''}: ${variantSummary})`);
      ok++;
    } catch (e) {
      console.error(`  ✗ [${p.id}]  ${p.name}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\n──────────────────────────────────────`);
  console.log(`Done: ${ok} saved, ${fail} failed.`);
  if (fail > 0) process.exit(1);
  console.log(`\nVerify in Firebase Console:`);
  console.log(`https://console.firebase.google.com/project/${STAGING_PROJECT_ID}/firestore/data/products`);
  process.exit(0);
}

migrate().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
