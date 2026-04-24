
// ── Scent & Mint config ──────────────────────────────
// Products with SCENT + MINT option
const MINT_SCENT_IDS = ['yw1','vm1','yo1','yop1'];
// Products with SCENT ONLY (no mint)
const SCENT_ONLY_IDS = ['yfs1','ybs1','bsc1','bbs1','bb1','bbb1','ybar1','bo2'];
// Products that must NEVER show the scent selector (match by name, case-insensitive)
const NO_SCENT_NAMES = ['Brightening Body Scrub','Dark Spot Remover','Skin Lightening Cream'];
// Scent options
const SCENTS = ['Unscented','Strawberry','Watermelon','Coconut','Lavender','Pineapple'];

// ── Caribbean Shipping Rates (USD) ───────────────────
// Brackets: ≤1kg, ≤2kg, ≤3kg, ≤5kg, ≤10kg. Over 10kg: ceil(kg/10) parcels at ≤10kg rate each.
const CARIBBEAN_RATES = {
  'Antigua & Barbuda': [42, 68, 95, 130, 170],
  'Bahamas':           [40, 65, 90, 120, 160],
  'Barbados':          [38, 60, 85, 115, 155],
  'Cayman Islands':    [35, 55, 78, 108, 145],
  'Grenada':           [40, 62, 88, 118, 158],
  'Guyana':            [50, 78, 108, 145, 195],
  'St. Lucia':         [40, 62, 88, 118, 158],
  'Trinidad & Tobago': [35, 55, 80, 110, 148],
};
const CARIB_KG_BRACKETS = [1, 2, 3, 5, 10];
const CARIB_USD_TO_JMD = 157;

// ── State ────────────────────────────────────────────
let sfCart = [];
let sfCurrentProd = null;
let sfCurrentSize = null;
let sfCurrentModalQty = 1;
let sfCurrentModalScent = null;
let sfCurrentModalMint = null;
let sfSelectedShip = null;
let sfCaribbeanCountry = '';
let sfSelectedPayment = 'wa'; // 'wa' = bank/lynk, 'card' = Fygaro
let sfTermsChecked = false;
let sfDiscountApplied = false;
let sfDiscountAmount = 0;
let sfDiscountLabel = '';
let sfCartStep = 'cart';
let sfSearchQuery = '';

// ── Helpers ──────────────────────────────────────────
function sfSizeLabel(k) {
  const m = {litre:'1 Litre',gallon:'1 Gallon','5gal':'5 Gallon',lb2:'2 lbs',lb8:'8 lbs',lb40:'40 lbs',bars10:'10 Bars',bars100:'100 Bars',caps100:'100 Caps',caps1000:'1000 Caps',halfLb:'½ lb',lb1:'1 lb',kit:'Per Unit',unit:'Per Unit',design:'Per Design',bar:'Per Bar'};
  return m[k] || k.charAt(0).toUpperCase()+k.slice(1);
}
// Tier order — ensures cards always show the minimum (smallest) order price, not a bulk tier
const SF_SIZE_ORDER = {halfLb:0,lb1:1,lb2:2,lb8:3,lb40:4,bar:0,bars10:0,bars100:1,litre:0,gallon:1,'5gal':2,caps100:0,caps1000:1,unit:0,kit:0,design:0};
function sfMinKey(pricing) {
  var keys = Object.keys(pricing || {});
  if (!keys.length) return '';
  return keys.sort(function(a,b){ return ((SF_SIZE_ORDER[a]??99)-(SF_SIZE_ORDER[b]??99)); })[0];
}
function sfGetPrice(p) {
  const keys = Object.keys(p.pricing);
  if (!keys.length) return {price:'Contact us',moq:''};
  const k = sfMinKey(p.pricing) || keys[0];
  const entry = p.pricing[k];
  const isUnit=['kit','unit','design'].includes(k);
  const moqLabel = isUnit&&p.unitDesc ? 'Per Unit · '+p.unitDesc : sfSizeLabel(k);
  return {price:'From J$'+(entry.price||0).toLocaleString(), moq:moqLabel};
}
const SF_IMG_CLASS = {yoni:'img-wash',skin:'img-cream',soap:'img-soap',hair:'img-serum',pl:'img-label',containers:'img-cream'};
const SF_CAT_LABEL = {yoni:'Yoni Care',skin:'Skin Care',soap:'Bar Soap',hair:'Hair Care',pl:'Private Label',containers:'Containers'};

function sfScroll(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({behavior:'smooth',block:'start'});
}
window.sfScroll = sfScroll;

function sfShowToast(msg) {
  let t = document.getElementById('sf-toast');
  if (!t) {
    t = document.createElement('div'); t.id='sf-toast';
    t.style.cssText='position:fixed;bottom:5rem;left:50%;transform:translateX(-50%) translateY(10px);background:#0F0E0D;color:white;padding:0.55rem 1.1rem;border-radius:20px;font-size:0.76rem;font-weight:600;z-index:9999;opacity:0;transition:all 0.3s;white-space:nowrap;font-family:Outfit,sans-serif;pointer-events:none;';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)';
  setTimeout(()=>{t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(10px)';},2200);
}

// ── Firestore product loader ─────────────────────────
// Reverse maps: Firestore label → storefront size key / category code
const _SF_SIZE_KEY = {
  '1 Litre':'litre','1 Gallon':'gallon','5 Gallon':'5gal',
  '2 lbs':'lb2','8 lbs':'lb8','40 lbs':'lb40',
  '10 Bars':'bars10','100 Bars':'bars100',
  '100 Capsules':'caps100','1000 Capsules':'caps1000',
  '0.5 lb':'halfLb','1 lb':'lb1','Bundle Kit':'kit','1 Design':'design',
};
const _SF_CAT_CODE = {
  'Yoni Care':'yoni','Skin Care':'skincare','Bar Soaps':'soap',
  'Men Care':'mencare','Hair Care':'haircare','Body Care':'bodycare','Bundles':'bundle','Design Services':'label',
};

async function sfLoadProductsFromFirestore() {
  try {
    const [fbApp, fbFs] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js'),
    ]);
    const SF_FB_CONFIG = { apiKey: 'AIzaSyCHSSW0hZldMIjhCTdSN27wgxxtcCMXlSE', projectId: 'najah-chemist-staging' };
    const appName = 'sf-products';
    const existing = fbApp.getApps().find(a => a.name === appName);
    const app = existing || fbApp.initializeApp(SF_FB_CONFIG, appName);
    const db = fbFs.getFirestore(app);
    const q = fbFs.query(
      fbFs.collection(db, 'products'),
      fbFs.where('isActive', '==', true),
      fbFs.where('isHidden', '==', false)
    );
    const snap = await fbFs.getDocs(q);
    if (snap.empty) { sfRenderProducts('all'); return; }

    const loaded = [];
    snap.forEach(docSnap => {
      const d = docSnap.data();
      const pricing = {};
      (d.variants || []).forEach(v => {
        const k = _SF_SIZE_KEY[v.size] || v.size;
        pricing[k] = { price: v.price, moq: 1 };
      });
      loaded.push({
        id:         d.legacyId || docSnap.id,
        firestoreId: docSnap.id,
        name:       d.name,
        cat:        _SF_CAT_CODE[d.category] || d.category,
        tagline:    d.tagline || d.description || '',
        emoji:      d.emoji || '🧴',
        img:        d.img   || '',
        tag:        d.tag   || '',
        sku:        d.sku   || '',
        pricing,
        outOfStock: d.outOfStock || false,
        hidden:     d.isHidden   || false,
      });
    });

    const containers = (window.PRODUCTS || []).filter(p => p.id.startsWith('con'));
    window.PRODUCTS  = [...loaded, ...containers];
    sfRenderProducts('all');
    sfRenderHeroCards();
  } catch (err) {
    console.warn('[storefront] Firestore product load failed, using fallback:', err);
    sfRenderProducts('all');
  }
}

// ── Product grid & filters ───────────────────────────
// Map of product IDs → dedicated product page URLs (only where a page exists)
const SF_PRODUCT_PAGES = {
  'yw1':   '/products/yoni-foaming-wash-jamaica',
  'bpw1':  '/products/boric-acid-probiotics-cleanser',
  'yp1':   '/products/yoni-pops-boric-acid-jamaica',
  'ls1':   '/products/lightening-serum',
  'pays1': '/products/papaya-serum',
  'slc1':  '/products/strong-lightening-cream',
  'bsc1':  '/products/foaming-scrub-jamaica',
  'bb1':   '/products/body-butter-wholesale-jamaica',
  'gls1':  '/products/garlic-lavender-soap-jamaica',
  'sas1':  '/products/salicylic-acid-soap-jamaica',
  'vcs1':  '/products/vitamin-c-soap-jamaica',
  'kts1':  '/products/turmeric-kojic-soap-jamaica',
  'hgo1':  '/products/ayurvedic-growth-oil',
  'bo2':   '/products/luxury-body-oil',
  'bbal1': '/products/beard-balm',
  'hmi1':  '/products/hair-mist',
  'tkbs1': '/products/turmeric-kojic-brightening-scrub',
  'yc1':   '/products/yoni-cleanser',
  'vm1':   '/products/vagimist',
  'yo1':   '/products/yoni-oil',
  'bbs1':  '/products/brightening-body-scrub',
  'bo1':   '/products/beard-oil',
  'bsh1':  '/products/beard-shampoo',
  'hmo1':  '/products/hydrating-moisturiser',
  'bbb1':  '/products/brightening-body-butter',
  'has1':  '/products/niacinamide-hyaluronic-serum',
  'rw1':   '/products/ryfle-wash',
  'ros1':  '/products/rose-facial-serum',
  'po1':   '/products/peeling-oil',
  'paps1': '/products/papaya-soap',
  'payo1': '/products/papaya-oil',
  'hbu1':  '/products/hair-butter',
  'gas1':  '/products/glycolic-acid-soap',
  'gat1':  '/products/glycolic-acid-toner',
  'bac1':  '/products/boric-acid-capsules',
  'yaic1': '/products/yoni-anti-itch-cream',
  'tfs1':  '/products/turmeric-facial-scrub',
  'srem1': '/products/spot-remover',
  'slbs1': '/products/skin-lightening-bar-soap',
  'srt1':  '/products/soothing-rose-toner',
  'tfc1':  '/products/turmeric-facial-cleanser',
  'tfm1':  '/products/turmeric-facial-mask',
  'tos1':  '/products/turmeric-only-soap',
  'yfs1':  '/products/yoni-foaming-scrub',
  'ysh1':  '/products/yoni-steam-herbs',
  'yop1':  '/products/yoni-oil',
};

function sfRenderProducts(filter) {
  const grid = document.getElementById('sf-products-grid');
  if (!grid) return;
  const prods = window.PRODUCTS || [];
  let list = filter === 'all' ? prods.filter(p => !p.hidden) : prods.filter(p => p.cat === filter && !p.hidden);
  if (sfSearchQuery) {
    const q = sfSearchQuery.toLowerCase();
    list = list.filter(p => (p.name||'').toLowerCase().includes(q) || (p.tagline||'').toLowerCase().includes(q));
  }
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:#8A8480;font-size:0.88rem;">${sfSearchQuery ? `No products found for "<strong style="color:#1C1A18;">${sfSearchQuery}</strong>".` : 'No products found.'}</div>`;
    return;
  }
  grid.innerHTML = list.map(p => {
    const {price, moq} = sfGetPrice(p);
    const imgHtml = p.img ? `<img src="${p.img}" alt="${p.name}">` : `<span style="font-size:3rem;">${p.emoji}</span>`;
    const revs = (window.REVIEWS || {})[p.id] || [];
    const starHtml = revs.length
      ? `<span style="font-size:0.68rem;color:#B45309;font-weight:600;">⭐ ${(revs.reduce((s,r)=>s+r.stars,0)/revs.length).toFixed(1)} (${revs.length})</span>`
      : '';
    const learnMoreUrl = SF_PRODUCT_PAGES[p.id] || '';
    const learnMoreHtml = learnMoreUrl
      ? `<a href="${learnMoreUrl}" target="_blank" onclick="event.stopPropagation()" style="display:inline-block;font-size:0.68rem;color:#8A8480;text-decoration:none;margin-top:0.2rem;margin-bottom:0.9rem;letter-spacing:0.01em;" onmouseover="this.style.color='#B45309'" onmouseout="this.style.color='#8A8480'">Learn More →</a>`
      : '';
    const oos = !!p.outOfStock;
    return `<div class="sf-card" onclick="sfOpenProduct('${p.id}')">
      <div class="sf-card-img ${SF_IMG_CLASS[p.cat]||'img-cream'}">${imgHtml}${p.tag&&!oos?`<span class="sf-card-badge">${p.tag}</span>`:''}${oos?'<span class="sf-card-badge" style="background:#DC2626;">Out of Stock</span>':''}</div>
      <div class="sf-card-body">
        <div class="sf-card-cat" style="display:flex;justify-content:space-between;align-items:center;">${SF_CAT_LABEL[p.cat]||p.cat}${starHtml}</div>
        <div class="sf-card-name">${p.name}</div>
        <div style="font-size:0.78rem;font-weight:700;color:#B45309;margin-bottom:0.25rem;">${price}</div>
        <div class="sf-card-tl" ${learnMoreUrl ? 'style="margin-bottom:0.2rem;"' : ''}>${p.tagline}</div>
        ${learnMoreHtml}
        <div class="sf-card-footer">
          <div class="sf-card-moq">${moq}</div>
          <button class="sf-card-btn" onclick="event.stopPropagation();sfOpenProduct('${p.id}')" ${oos?'disabled style="background:#9CA3AF;cursor:not-allowed;opacity:0.75;"':''}>${oos?'Out of Stock':'Details'}</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
window.sfRenderProducts = sfRenderProducts;

// ── Hero best sellers panel ───────────────────────────
function sfRenderHeroCards() {
  const el = document.getElementById('sf-hero-cards');
  if (!el) return;
  const ids = window._bestSellerIds || [];
  const prods = window.PRODUCTS || [];
  const list = ids.map(id => prods.find(p => p.id === id)).filter(Boolean).slice(0, 3);
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.18em;color:#c9a84c;margin-bottom:0.5rem;">⭐ Best Sellers</div>` +
    list.map(p => {
      const {price, moq} = sfGetPrice(p);
      return `<div class="sf-hero-card" onclick="sfOpenProduct('${p.id}')">
        <div class="sf-hero-card-top">
          <span class="sf-hero-card-emoji">${p.emoji || '🧴'}</span>
          <div>
            <div class="sf-hero-card-name">${p.name}</div>
            ${p.tag ? `<span class="sf-hero-card-tag">${p.tag}</span>` : ''}
          </div>
        </div>
        <div class="sf-hero-card-tl">${p.tagline || ''}</div>
        <div style="margin-top:0.45rem;font-size:0.78rem;font-weight:700;color:#c9a84c;">${price}</div>
        <div style="font-size:0.65rem;color:#6B7280;margin-top:0.1rem;">${moq}</div>
      </div>`;
    }).join('');
}
window.sfRenderHeroCards = sfRenderHeroCards;

// ── Product modal reviews ─────────────────────────────
let _sfrStars = 0;

function sfRenderModalReviews(id) {
  const revs = (window.REVIEWS || {})[id] || [];
  const listEl = document.getElementById('sf-modal-revs');
  const avgEl  = document.getElementById('sf-modal-avg');
  if (!listEl) return;
  if (avgEl) avgEl.textContent = revs.length
    ? '⭐ ' + (revs.reduce((s,r)=>s+r.stars,0)/revs.length).toFixed(1) + ' (' + revs.length + ')'
    : '';
  listEl.innerHTML = revs.length === 0
    ? '<p style="font-size:0.78rem;color:#8A8480;margin:0.4rem 0 0.6rem;">No reviews yet — be the first!</p>'
    : revs.map(r =>
        '<div style="padding:0.65rem 0;border-bottom:1px solid #F0EDE8;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.18rem;">' +
        '<span style="font-weight:600;font-size:0.82rem;color:#0F0E0D;">' + r.name + '</span>' +
        '<span style="font-size:0.8rem;color:#B45309;">' + '⭐'.repeat(r.stars) + '</span></div>' +
        '<div style="font-size:0.79rem;color:#4B4846;line-height:1.5;margin-bottom:0.18rem;">' + r.text + '</div>' +
        '<div style="font-size:0.67rem;color:#8A8480;">' + r.date + '</div></div>'
      ).join('');
}

window.sfOpenReviewForm = function() {
  const f = document.getElementById('sf-modal-rev-form');
  if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
};

window.sfSetStars = function(n) {
  _sfrStars = n;
  document.querySelectorAll('#sfr-stars span').forEach((s,i) => s.textContent = i < n ? '⭐' : '☆');
};

window.sfSubmitReview = async function() {
  const name = (document.getElementById('sfr-name')?.value || '').trim();
  const text = (document.getElementById('sfr-text')?.value || '').trim();
  const id   = window.sfCurrentReviewProduct;
  if (!name || !text || !_sfrStars) { sfShowToast('Please fill in your name, rating, and review'); return; }
  const review = {
    name, stars: _sfrStars, text, productId: id,
    date: new Date().toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})
  };
  if (!window.REVIEWS[id]) window.REVIEWS[id] = [];
  window.REVIEWS[id].unshift(review);
  if (typeof window.saveReviewToDB === 'function') await window.saveReviewToDB(review);
  document.getElementById('sfr-name').value = '';
  document.getElementById('sfr-text').value = '';
  sfSetStars(0);
  document.getElementById('sf-modal-rev-form').style.display = 'none';
  sfRenderModalReviews(id);
  sfRenderProducts('all'); // refresh card ratings
  sfShowToast('Review submitted — thank you!');
};

// ── Starter Kit checkbox selector ────────────────────
const SK_EXCLUDED_CATS = ['containers', 'soap', 'bundle', 'label'];
// Name keywords that disqualify a product from the bundle builder
const SK_EXCLUDED_KEYWORDS = ['bundle', 'kit', 'capsule', 'capsules', 'herb', 'herbs', 'steam', 'boric acid'];
var skChecked = {};

function sfRenderStarterKit() {
  skBuildChecklist();
  skUpdateSummary();
}
window.sfRenderStarterKit = sfRenderStarterKit;

function skGetEligible() {
  return (window.PRODUCTS || []).filter(function(p) {
    if (p.hidden) return false;
    if (SK_EXCLUDED_CATS.includes(p.cat)) return false;
    var nameLower = (p.name || '').toLowerCase();
    if (SK_EXCLUDED_KEYWORDS.some(function(kw){ return nameLower.includes(kw); })) return false;
    return true;
  });
}

window.skTogglePanel = function() {
  var panel = document.getElementById('sk-panel');
  var arrow = document.getElementById('sk-toggle-arrow');
  if (!panel) return;
  var open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '\u25bc' : '\u25b2';
  if (!open) { skBuildChecklist(); skUpdateSummary(); }
};

function skBuildChecklist() {
  var list = document.getElementById('sk-checklist');
  if (!list) return;
  var prods = skGetEligible();
  list.innerHTML = prods.map(function(p) {
    var keys = Object.keys(p.pricing || {});
    var k = sfMinKey(p.pricing) || keys[0] || '';
    var price = k ? (p.pricing[k].price || 0) : 0;
    var sLabel = sfSizeLabel(k);
    var sel = skChecked[p.id];
    var bc = sel ? '#0F0E0D' : '#E8E4DE';
    var bg = sel ? '#F5F2ED' : 'white';
    return '<label id="sk-lbl-' + p.id + '" style="display:flex;align-items:flex-start;gap:0.65rem;padding:0.7rem 0.9rem;border:1.5px solid ' + bc + ';border-radius:10px;cursor:pointer;background:' + bg + ';transition:border-color 0.15s,background 0.15s;">' +
      '<input type="checkbox" value="' + p.id + '" onchange="skOnCheck(this)"' + (sel ? ' checked' : '') + ' style="margin-top:0.2rem;width:16px;height:16px;accent-color:#0F0E0D;cursor:pointer;flex-shrink:0;">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:0.84rem;font-weight:600;color:#0F0E0D;line-height:1.35;">' + p.name + '</div>' +
        '<div style="font-size:0.75rem;color:#B45309;font-weight:700;margin-top:0.1rem;">J$' + price.toLocaleString() + ' \u00b7 ' + sLabel + '</div>' +
      '</div>' +
    '</label>';
  }).join('');
}

window.skOnCheck = function(cb) {
  var limitMsg = document.getElementById('sk-limit-msg');
  var count = Object.keys(skChecked).length;
  if (cb.checked) {
    if (count >= 3) {
      cb.checked = false;
      if (limitMsg) { limitMsg.style.display = 'block'; setTimeout(function(){ if (limitMsg) limitMsg.style.display = 'none'; }, 3000); }
      return;
    }
    var p = (window.PRODUCTS || []).find(function(pr){ return pr.id === cb.value; });
    if (p) {
      var keys = Object.keys(p.pricing || {});
      var k = sfMinKey(p.pricing) || keys[0] || '';
      var price = k ? (p.pricing[k].price || 0) : 0;
      skChecked[cb.value] = { p: p, k: k, price: price };
    }
  } else {
    delete skChecked[cb.value];
    if (limitMsg) limitMsg.style.display = 'none';
  }
  var lbl = document.getElementById('sk-lbl-' + cb.value);
  if (lbl) {
    lbl.style.borderColor = cb.checked ? '#0F0E0D' : '#E8E4DE';
    lbl.style.background = cb.checked ? '#F5F2ED' : 'white';
  }
  skUpdateSummary();
};

function skUpdateSummary() {
  var summary = document.getElementById('sk-summary');
  var body = document.getElementById('sk-summary-body');
  if (!summary || !body) return;
  var selections = Object.values(skChecked);
  var count = selections.length;
  if (!count) { summary.style.display = 'none'; return; }
  var runningTotal = selections.reduce(function(s, x){ return s + x.price; }, 0);
  var allPicked = count === 3;
  var discount = allPicked ? Math.round(runningTotal * 0.05) : 0;
  var finalTotal = runningTotal - discount;
  var rows = selections.map(function(x) {
    return '<div style="display:flex;justify-content:space-between;font-size:0.82rem;color:#4B4846;margin-bottom:0.3rem;">' +
      '<span>' + x.p.name + ' (' + sfSizeLabel(x.k) + ')</span>' +
      '<span style="font-weight:600;">J$' + x.price.toLocaleString() + '</span></div>';
  }).join('');
  var subtotalRow = '<div style="display:flex;justify-content:space-between;font-size:0.82rem;color:#4B4846;padding-top:0.5rem;border-top:1px solid #d1fae5;margin-top:0.4rem;margin-bottom:0.3rem;"><span>Subtotal</span><span style="font-weight:600;">J$' + runningTotal.toLocaleString() + '</span></div>';
  var discountRow = allPicked
    ? '<div style="display:flex;justify-content:space-between;font-size:0.82rem;color:#059669;margin-bottom:0.3rem;"><span>Kit discount (5%)</span><span style="font-weight:600;">\u2212J$' + discount.toLocaleString() + '</span></div>'
    : '<div style="font-size:0.78rem;color:#8A8480;margin-bottom:0.4rem;">Select ' + (3 - count) + ' more product' + ((3 - count) !== 1 ? 's' : '') + ' to unlock 5% discount</div>';
  var totalRow = allPicked
    ? '<div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:800;border-top:1px solid #bbf7d0;padding-top:0.6rem;margin-top:0.4rem;"><span>Total (after 5% off)</span><span style="color:#0F0E0D;">J$' + finalTotal.toLocaleString() + '</span></div>'
    : '';
  var addBtn = allPicked
    ? '<button onclick="skAddToCart()" style="margin-top:1rem;width:100%;padding:0.9rem;background:#0F0E0D;color:white;border:none;border-radius:10px;font-family:\'Outfit\',sans-serif;font-size:0.92rem;font-weight:700;cursor:pointer;letter-spacing:0.02em;">\uD83D\uDED2 Add Kit to Cart</button>'
    : '<button disabled style="margin-top:1rem;width:100%;padding:0.9rem;background:#E8E4DE;color:#8A8480;border:none;border-radius:10px;font-family:\'Outfit\',sans-serif;font-size:0.92rem;font-weight:700;cursor:not-allowed;letter-spacing:0.02em;">\uD83D\uDED2 Add Kit to Cart (' + count + '/3 selected)</button>';
  body.innerHTML = rows + subtotalRow + discountRow + totalRow + addBtn;
  summary.style.display = 'block';
}

window.skAddToCart = function() {
  var selections = Object.values(skChecked);
  if (selections.length < 3) { sfShowToast('Please select all 3 products'); return; }
  var kitTotal = selections.reduce(function(s, x){ return s + x.price; }, 0);
  selections.forEach(function(x) {
    var sizeLabel = sfSizeLabel(x.k);
    var key = x.p.id + '|' + sizeLabel + '||';
    var ex = sfCart.find(function(i){ return i._key === key; });
    if (ex) { ex.qty += 1; }
    else { sfCart.push({_key:key, id:x.p.id, name:x.p.name, size:sizeLabel, price:x.price, qty:1, emoji:x.p.emoji||'\uD83E\uDDF4', cat:x.p.cat}); }
  });
  sfDiscountApplied = true;
  sfDiscountAmount = Math.round(kitTotal * 0.05);
  sfDiscountLabel = 'Starter Kit \u22125%';
  sfUpdateCartBtn();
  sfOpenCart();
  sfShowToast('\u2713 Starter kit added to cart');
  skChecked = {};
  skBuildChecklist();
  skUpdateSummary();
};

function sfFilter(cat, btn) {
  // Clear search when a category tab is clicked
  sfSearchQuery = '';
  const inp = document.getElementById('sf-search');
  if (inp) inp.value = '';
  const clr = document.getElementById('sf-search-clear');
  if (clr) clr.style.display = 'none';
  document.querySelectorAll('.sf-cat').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  sfRenderProducts(cat);
}
window.sfFilter = sfFilter;

window.sfSearch = function(val) {
  sfSearchQuery = val.trim();
  const clr = document.getElementById('sf-search-clear');
  if (clr) clr.style.display = sfSearchQuery ? 'block' : 'none';
  // Activate All tab so search runs across every category
  document.querySelectorAll('.sf-cat').forEach(b => b.classList.remove('on'));
  const allBtn = document.querySelector('#sf-cat-btns .sf-cat');
  if (allBtn) allBtn.classList.add('on');
  sfRenderProducts('all');
};

window.sfSearchClear = function() {
  sfSearchQuery = '';
  const inp = document.getElementById('sf-search');
  if (inp) inp.value = '';
  const clr = document.getElementById('sf-search-clear');
  if (clr) clr.style.display = 'none';
  sfRenderProducts('all');
};

// ── Product modal ────────────────────────────────────
function sfOpenProduct(id) {
  const prods = window.PRODUCTS || [];
  const p = prods.find(x => x.id === id);
  if (!p) return;
  sfCurrentProd = p;
  sfCurrentModalQty = 1;
  sfCurrentModalScent = null;
  sfCurrentModalMint = null;

  // Image
  const imgEl = document.getElementById('sf-modal-img');
  if (imgEl) {
    imgEl.className = 'sf-modal-img ' + (SF_IMG_CLASS[p.cat]||'img-cream');
    imgEl.innerHTML = p.img
      ? `<img src="${p.img}" alt="${p.name}"><button class="sf-modal-close" onclick="closeSfModal()">×</button>`
      : `<span style="font-size:5rem;">${p.emoji}</span><button class="sf-modal-close" onclick="closeSfModal()">×</button>`;
  }

  const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  const setHTML = (id, val) => { const el=document.getElementById(id); if(el) el.innerHTML=val; };

  set('sf-modal-cat', SF_CAT_LABEL[p.cat]||p.cat);
  set('sf-modal-name', p.name);
  set('sf-modal-tl', p.tagline);
  window.sfCurrentProductId = p.id;
  window.sfCurrentProductName = p.name;
  set('sf-modal-ing', p.ingredients||'');
  set('sf-modal-use', p.usage||'');
  setHTML('sf-modal-benefits', (Array.isArray(p.benefits)?p.benefits:[p.benefits||'']).map(b=>`<span class="sf-modal-benefit">${b}</span>`).join(''));

  // Hide Best For / Key Ingredients for container products
  const isContainer = p.cat === 'containers';
  ['sf-modal-benefits','sf-modal-ing'].forEach(id => {
    const sec = document.getElementById(id);
    if(sec && sec.closest('.sf-modal-section')) sec.closest('.sf-modal-section').style.display = isContainer ? 'none' : '';
  });

  // Size buttons
  const keys = Object.keys(p.pricing);
  sfCurrentSize = keys[0];
  const sizesWrap = document.getElementById('sf-modal-sizes-wrap');
  if (sizesWrap) {
    sizesWrap.style.display = keys.length > 1 ? 'block' : 'none';
    setHTML('sf-modal-sizes', keys.map((k,i)=>{
      const isUnit=['kit','unit','design'].includes(k);
      const lbl=isUnit&&p.unitDesc?p.unitDesc:sfSizeLabel(k);
      return `<button class="sf-modal-sz${i===0?' on':''}" onclick="sfSelectSize('${p.id}','${k}',this)">${lbl}</button>`;
    }).join(''));
  }

  // Price
  const firstEntry = p.pricing[keys[0]];
  setHTML('sf-modal-price-row', `<div class="sf-modal-price-item"><div class="sf-modal-price-lbl">Price</div><div class="sf-modal-price-val" id="sf-m-price">J$${firstEntry.price.toLocaleString()}</div></div><div class="sf-modal-price-item"><div class="sf-modal-price-lbl">Size</div><div class="sf-modal-price-val" id="sf-m-moq">${sfSizeLabel(keys[0])}</div></div>`);

  // Qty
  set('sf-modal-qty-val', '1');
  set('sf-modal-moq-note', sfSizeLabel(keys[0]));
  set('sf-modal-subtotal', 'J$'+firstEntry.price.toLocaleString());

  // Scent pills — show for scent+mint products AND scent-only products,
  // but never for products explicitly listed in NO_SCENT_NAMES
  const hasScentMint = MINT_SCENT_IDS.includes(p.id);
  const hasScentOnly = SCENT_ONLY_IDS.includes(p.id);
  const scentBlocked = NO_SCENT_NAMES.some(n => (p.name||'').toLowerCase().includes(n.toLowerCase()));
  const showScent = (hasScentMint || hasScentOnly) && !scentBlocked;
  const scentWrap = document.getElementById('sf-scent-wrap');
  if (scentWrap) {
    if (showScent) {
      scentWrap.style.display = 'block';
      setHTML('sf-scent-pills', SCENTS.map((s,i)=>`<button class="sf-modal-scent-pill${i===0?' on':''}" onclick="sfPickScent('${s}',this)">${s}</button>`).join(''));
      sfCurrentModalScent = SCENTS[0];
    } else {
      scentWrap.style.display = 'none';
    }
  }

  // Mint — only for specific products (Yoni Foaming Wash, VagiMist, Yoni Oil)
  const mintWrap = document.getElementById('sf-mint-wrap');
  if (mintWrap) {
    if (hasScentMint) {
      mintWrap.style.display = 'block';
      const yes = document.getElementById('sf-mint-yes');
      const no = document.getElementById('sf-mint-no');
      if (yes) yes.classList.add('on');
      if (no) no.classList.remove('on');
      sfCurrentModalMint = 'With Mint';
    } else {
      mintWrap.style.display = 'none';
      sfCurrentModalMint = null;
    }
  }

  // WA button
  const waBtn = document.getElementById('sf-modal-wa-btn');
  if (waBtn) waBtn.onclick = () => {
    const WA = window.WA_NUMBER || '18768851099';
    const msg = `Hi Najah Chemist! I'd like to order: *${p.name}*. Can you help me?`;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
  };

  // Reviews
  window.sfCurrentReviewProduct = id;
  const revForm = document.getElementById('sf-modal-rev-form');
  if (revForm) revForm.style.display = 'none';
  sfSetStars(0);
  sfRenderModalReviews(id);

  // Out-of-stock: show waitlist message, hide Add to Cart
  const addBtn = document.getElementById('sf-modal-add-btn');
  const oosMsg = document.getElementById('sf-modal-oos-msg');
  if (addBtn && oosMsg) {
    if (p.outOfStock) {
      addBtn.style.display = 'none';
      oosMsg.style.display = 'block';
    } else {
      addBtn.style.display = '';
      oosMsg.style.display = 'none';
    }
  }

  const modal = document.getElementById('sf-modal');
  if (modal) { modal.classList.add('open'); document.body.style.overflow='hidden'; }
}
window.sfOpenProduct = sfOpenProduct;

window.closeSfModal = function() {
  const m = document.getElementById('sf-modal');
  if (m) m.classList.remove('open');
  document.body.style.overflow = '';
};

window.sfSelectSize = function(prodId, sizeKey, btn) {
  document.querySelectorAll('.sf-modal-sz').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  sfCurrentSize = sizeKey;
  const prods = window.PRODUCTS || [];
  const p = prods.find(x => x.id === prodId);
  if (!p || !p.pricing[sizeKey]) return;
  const el = document.getElementById('sf-m-price');
  const mq = document.getElementById('sf-m-moq');
  const sub = document.getElementById('sf-modal-subtotal');
  if (el) el.textContent = 'J$'+p.pricing[sizeKey].price.toLocaleString();
  const _isUnit=['kit','unit','design'].includes(sizeKey);
  if (mq) mq.textContent = _isUnit&&p.unitDesc?p.unitDesc:sfSizeLabel(sizeKey);
  if (sub) sub.textContent = 'J$'+(p.pricing[sizeKey].price * sfCurrentModalQty).toLocaleString();
};

window.sfModalQty = function(delta) {
  if (!sfCurrentProd) return;
  sfCurrentModalQty = Math.max(1, sfCurrentModalQty + delta);
  const el = document.getElementById('sf-modal-qty-val');
  if (el) el.textContent = sfCurrentModalQty;
  const k = sfCurrentSize || Object.keys(sfCurrentProd.pricing)[0];
  const price = sfCurrentProd.pricing[k]?.price || 0;
  const sub = document.getElementById('sf-modal-subtotal');
  if (sub) sub.textContent = 'J$'+(price * sfCurrentModalQty).toLocaleString();
};

window.sfPickScent = function(scent, btn) {
  sfCurrentModalScent = scent;
  document.querySelectorAll('#sf-scent-pills .sf-modal-scent-pill').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
};

window.sfPickMint = function(val, btn) {
  sfCurrentModalMint = val;
  const yes = document.getElementById('sf-mint-yes');
  const no = document.getElementById('sf-mint-no');
  if (yes) yes.classList.toggle('on', val === 'With Mint');
  if (no) no.classList.toggle('on', val === 'No Mint');
};

// ── Cart ─────────────────────────────────────────────
window.sfAddToCart = function() {
  if (!sfCurrentProd) return;
  const p = sfCurrentProd;
  const k = sfCurrentSize || Object.keys(p.pricing)[0];
  const price = p.pricing[k]?.price || 0;
  const sizeLabel = sfSizeLabel(k);
  const extras = [sfCurrentModalScent, sfCurrentModalMint].filter(Boolean).join(' · ');
  const displaySize = sizeLabel + (extras ? ' · '+extras : '');
  const qty = sfCurrentModalQty || 1;
  const key = p.id+'|'+sizeLabel+'|'+(sfCurrentModalScent||'')+'|'+(sfCurrentModalMint||'');
  const ex = sfCart.find(i => i._key === key);
  if (ex) { ex.qty += qty; }
  else { sfCart.push({_key:key, id:p.id, name:p.name, size:displaySize, price, qty, emoji:p.emoji, cat:p.cat}); }
  sfUpdateCartBtn();
  window.closeSfModal();
  sfShowToast('✓ Added: '+p.name);
  sfSaveAbandonedCart();
};

function sfUpdateCartBtn() {
  const total = sfCart.reduce((s,i)=>s+i.qty, 0);
  const btn = document.getElementById('sf-cart-btn');
  const badge = document.getElementById('sf-cart-badge');
  if (badge) badge.textContent = total;
  if (btn) btn.style.display = total > 0 ? 'flex' : 'none';
}

window.sfOpenCart = function() {
  sfCartStep = 'cart';
  sfRenderCart();
  const ov = document.getElementById('sf-cart-overlay');
  if (ov) { ov.classList.add('open'); }
  const body = document.querySelector('.sf-cart-body');
  if (body) body.scrollTop = 0;
};

window.sfCloseCart = function() {
  const ov = document.getElementById('sf-cart-overlay');
  if (ov) ov.classList.remove('open');
};

window.sfCartQty = function(i, d) {
  sfCart[i].qty = Math.max(1, sfCart[i].qty + d);
  sfRenderCart(); sfUpdateCartBtn();
  sfSaveAbandonedCart();
};

window.sfRemoveItem = function(i) {
  sfCart.splice(i,1); sfRenderCart(); sfUpdateCartBtn();
  sfSaveAbandonedCart();
};

window.sfGoCheckout = function() {
  sfCartStep = 'checkout';
  sfRenderCart();
  const body = document.querySelector('.sf-cart-body');
  if (body) body.scrollTop = 0;
};

window.sfGoBackToCart = function() {
  sfCartStep = 'cart';
  sfRenderCart();
  const body = document.querySelector('.sf-cart-body');
  if (body) body.scrollTop = 0;
};

window.sfSelectShip = function(type, el) {
  sfSelectedShip = type;
  document.querySelectorAll('.sf-ship-opt').forEach(o => {
    o.classList.remove('on');
    const id = o.id.replace('sf-ship-','');
    const extra = document.getElementById('sf-'+id+'-extra');
    if (extra) extra.classList.remove('show');
  });
  if (el) el.classList.add('on');
  const radio = document.getElementById('sfr-'+type);
  if (radio) radio.checked = true;
  const extra = document.getElementById('sf-'+type+'-extra');
  if (extra) extra.classList.add('show');
  if (type === 'kingston' && window._sfMapsLoaded) sfInitKingstonAutocomplete();
  sfRenderCartFooter();
};

// ── Google Maps Places autocomplete for Kingston delivery ──────────────
window.sfMapsReady = function() {
  window._sfMapsLoaded = true;
  if (sfSelectedShip === 'kingston') sfInitKingstonAutocomplete();
};
function sfInitKingstonAutocomplete() {
  if (!window.google || !window.google.maps || !window.google.maps.places) return;
  const input = document.getElementById('sf-delivery-address');
  if (!input || input._sfAc) return;
  try {
    const ac = new google.maps.places.Autocomplete(input, {
      componentRestrictions: { country: 'jm' },
      fields: ['formatted_address']
    });
    ac.addListener('place_changed', function() {
      const place = ac.getPlace();
      if (place && place.formatted_address) input.value = place.formatted_address;
    });
    input._sfAc = ac;
  } catch(e) { /* fallback: plain text input still works */ }
}

window.sfKnutsfordBranchChange = function() {
  const sel = document.getElementById('sf-knutsford-branch');
  const other = document.getElementById('sf-knutsford-branch-other');
  if (sel && other) other.style.display = sel.value === 'Other' ? 'block' : 'none';
};

window.sfZipmailLocationChange = function() {
  const sel = document.getElementById('sf-zipmail-location');
  const other = document.getElementById('sf-zipmail-location-other');
  if (sel && other) other.style.display = sel.value === 'Other' ? 'block' : 'none';
};

function sfCalcCaribbeanShipping(country, totalKg) {
  const rates = CARIBBEAN_RATES[country];
  if (!rates || totalKg <= 0) return {usd: 0, jmd: 0};
  let usd;
  if (totalKg <= 10) {
    const idx = CARIB_KG_BRACKETS.findIndex(b => totalKg <= b);
    usd = rates[idx >= 0 ? idx : rates.length - 1];
  } else {
    const parcels = Math.ceil(totalKg / 10);
    usd = parcels * rates[4];
  }
  return {usd, jmd: Math.round(usd * CARIB_USD_TO_JMD)};
}

function sfEstimateWeightKg(item) {
  const size = (item.size || '').toLowerCase();
  if (size.includes('5 gal')) return 21;
  if (size.includes('gallon')) return 4.2;
  if (size.includes('litre') || size.includes('liter')) return 1.1;
  if (size.includes('40 lb')) return 18.5;
  if (size.includes('8 lb')) return 3.8;
  if (size.includes('2 lb')) return 1.0;
  if (size.includes('1 lb')) return 0.5;
  if (size.includes('½ lb') || size.includes('half lb')) return 0.3;
  if (size.includes('100 bar') || size.includes('bars100')) return 15.0;
  if (size.includes('bar') || size.includes('bars')) return 0.15;
  return 0.5;
}

function sfGetCartWeightKg() {
  const prods = window.PRODUCTS || [];
  let totalKg = 0;
  for (const item of sfCart) {
    const prod = prods.find(p => (p.id === item.id || p._docId === item.id));
    let weightKg = 0;
    if (prod && prod.variants) {
      const variant = prod.variants.find(v => sfSizeLabel(v.size) === item.size || v.size === item.size);
      if (variant && variant.shippingWeightKg) {
        weightKg = parseFloat(variant.shippingWeightKg) || 0;
      }
    }
    if (!weightKg) weightKg = sfEstimateWeightKg(item);
    totalKg += weightKg * item.qty;
  }
  return totalKg;
}

window.sfCaribbeanCountryChange = function() {
  const sel = document.getElementById('sf-caribbean-country');
  sfCaribbeanCountry = sel ? sel.value : '';
  const display = document.getElementById('sf-caribbean-cost-display');
  const badge = document.getElementById('sf-caribbean-fee-badge');
  if (sfCaribbeanCountry) {
    const kg = sfGetCartWeightKg();
    const result = sfCalcCaribbeanShipping(sfCaribbeanCountry, kg);
    if (display) {
      display.textContent = 'Est. weight: ' + kg.toFixed(1) + 'kg · USD $' + result.usd + ' (~J$' + result.jmd.toLocaleString() + ')';
      display.style.display = 'block';
    }
    if (badge) badge.innerHTML = '~J$' + result.jmd.toLocaleString() + '<br><span style="font-size:0.62rem;font-weight:400;color:#8A8480;">shipping</span>';
  } else {
    if (display) display.style.display = 'none';
    if (badge) badge.innerHTML = 'USD<br><span style="font-size:0.62rem;font-weight:400;color:#8A8480;">by weight</span>';
  }
  sfRenderCartFooter();
};

function sfGetShippingInfo() {
  let knutsfordBranch = '', zipmailLocation = '', deliveryAddress = '', shippingDetail = '', deliveryLocation = '', deliveryFee = 0;
  if (sfSelectedShip === 'knutsford') {
    const sel = (document.getElementById('sf-knutsford-branch')?.value||'').trim();
    const other = (document.getElementById('sf-knutsford-branch-other')?.value||'').trim();
    knutsfordBranch = sel === 'Other' ? other : sel;
    shippingDetail = 'Knutsford Express' + (knutsfordBranch ? ' — ' + knutsfordBranch : '');
    deliveryLocation = 'Knutsford Express' + (knutsfordBranch ? ' - ' + knutsfordBranch : '');
    deliveryFee = 500;
  } else if (sfSelectedShip === 'zipmail') {
    const sel = (document.getElementById('sf-zipmail-location')?.value||'').trim();
    const other = (document.getElementById('sf-zipmail-location-other')?.value||'').trim();
    zipmailLocation = sel === 'Other' ? other : sel;
    shippingDetail = 'Zipmail' + (zipmailLocation ? ' — ' + zipmailLocation : '');
    deliveryLocation = 'Zipmail' + (zipmailLocation ? ' - ' + zipmailLocation : '');
    deliveryFee = 1000;
  } else if (sfSelectedShip === 'kingston') {
    deliveryAddress = (document.getElementById('sf-delivery-address')?.value||'').trim();
    shippingDetail = 'Kingston/St. Andrew Delivery' + (deliveryAddress ? ' — ' + deliveryAddress : '');
    deliveryLocation = 'Kingston/St. Andrew' + (deliveryAddress ? ' - ' + deliveryAddress : '');
    deliveryFee = 1000;
  } else if (sfSelectedShip === 'caribbean') {
    const country = sfCaribbeanCountry;
    const kg = sfGetCartWeightKg();
    const result = sfCalcCaribbeanShipping(country, kg);
    shippingDetail = 'Caribbean Shipping — ' + country + ' (USD $' + result.usd + ', ' + kg.toFixed(1) + 'kg)';
    deliveryLocation = 'Caribbean — ' + country;
    deliveryFee = result.jmd;
  }
  return { knutsfordBranch, zipmailLocation, deliveryAddress, shippingDetail, deliveryLocation, deliveryFee };
}

// ── Upsell: "You might also like" ────────────────────────────────────
function sfRenderUpsell() {
  const prods = window.PRODUCTS || [];
  const cartCats = [...new Set(sfCart.map(i => i.cat))];
  const cartIds  = new Set(sfCart.map(i => i.id));
  // Collect matching products from the same categories, excluding cart items
  const seen = new Set();
  const suggestions = [];
  for (const cat of cartCats) {
    for (const p of prods) {
      if (p.cat === cat && !p.hidden && !cartIds.has(p.id) && !seen.has(p.id)) {
        seen.add(p.id);
        suggestions.push(p);
        if (suggestions.length === 3) break;
      }
    }
    if (suggestions.length === 3) break;
  }
  if (!suggestions.length) return '';
  const rows = suggestions.map(p => {
    const {price} = sfGetPrice(p);
    return `<div style="display:flex;align-items:center;gap:0.65rem;padding:0.5rem 0;border-bottom:1px solid #F0EDE8;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.8rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.emoji||'🧴'} ${p.name}</div>
        <div style="font-size:0.7rem;color:#8A8480;">${price}</div>
      </div>
      <button onclick="sfCloseCart();sfOpenProduct('${p.id}')" style="flex-shrink:0;padding:0.35rem 0.8rem;background:#0F0E0D;color:white;border:none;border-radius:6px;font-family:'Outfit',sans-serif;font-size:0.7rem;font-weight:600;cursor:pointer;">Add</button>
    </div>`;
  }).join('');
  return `<div style="padding:0.65rem 1.4rem 0.5rem;border-top:1px solid #E8E4DE;">
    <div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8A8480;margin-bottom:0.45rem;">You might also like</div>
    ${rows}
  </div>`;
}

function sfRenderCart() {
  const el = document.getElementById('sf-cart-items');
  const footer = document.getElementById('sf-cart-footer');
  const detSec = document.getElementById('sf-cart-details-section');
  const shipSec = document.getElementById('sf-cart-ship-section');
  const payInfo = document.getElementById('sf-payment-info');
  if (!el) return;

  if (sfCart.length === 0) {
    el.innerHTML = '<div style="padding:2.5rem 1.4rem;text-align:center;"><div style="font-size:2.5rem;margin-bottom:0.75rem;">🛒</div><div style="font-weight:700;font-size:0.88rem;margin-bottom:0.3rem;">Your cart is empty</div><div style="font-size:0.78rem;color:#8A8480;margin-bottom:1.2rem;">Browse products and tap Details → Add to Cart</div><button onclick="sfCloseCart()" style="padding:0.6rem 1.5rem;background:#0F0E0D;color:white;border:none;border-radius:8px;font-family:Outfit,sans-serif;font-size:0.8rem;font-weight:600;cursor:pointer;">Browse Products</button></div>';
    if (footer) footer.style.display='none';
    if (detSec) detSec.style.display='none';
    if (shipSec) shipSec.style.display='none';
    if (payInfo) payInfo.style.display='none';
    return;
  }

  if (sfCartStep === 'cart') {
    if (detSec) detSec.style.display='none';
    if (shipSec) shipSec.style.display='none';
    if (payInfo) payInfo.style.display='none';
    el.innerHTML = sfCart.map((item,i) => `
      <div class="sf-cart-item">
        <div class="sf-cart-item-emoji">${item.emoji}</div>
        <div class="sf-cart-item-info">
          <div class="sf-cart-item-name">${item.name}</div>
          <div class="sf-cart-item-sub">${item.size}</div>
          <div class="sf-cart-item-qty-row">
            <button class="sf-cq-btn" onclick="sfCartQty(${i},-1)">−</button>
            <span class="sf-cq-val">${item.qty}</span>
            <button class="sf-cq-btn" onclick="sfCartQty(${i},1)">+</button>
            <button class="sf-rm-btn" onclick="sfRemoveItem(${i})">🗑</button>
          </div>
        </div>
        <div class="sf-cart-item-price">J$${(item.price*item.qty).toLocaleString()}</div>
      </div>`).join('') + sfRenderUpsell();
    const sub = sfCart.reduce((s,i)=>s+i.price*i.qty,0);
    const count = sfCart.reduce((s,i)=>s+i.qty,0);
    if (footer) {
      footer.style.display='block';
      footer.innerHTML = `<div style="padding:0.75rem 1.4rem;border-top:1px solid #E8E4DE;">
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:0.35rem;">
          <span style="color:#8A8480;">${count} item${count!==1?'s':''}</span>
          <span style="font-weight:700;">J$${sub.toLocaleString()}</span>
        </div>
        <button onclick="sfGoCheckout()" style="width:100%;padding:0.82rem;background:#0F0E0D;color:white;border:none;border-radius:10px;font-family:'Outfit',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;">
          Proceed to Checkout →
        </button>
        <button onclick="sfCloseCart()" style="width:100%;margin-top:0.4rem;background:none;border:none;font-size:0.75rem;color:#8A8480;cursor:pointer;padding:0.4rem;font-family:'Outfit',sans-serif;">
          ← Continue Shopping
        </button>
      </div>`;
    }
  } else {
    // Checkout step
    const sub2 = sfCart.reduce((s,i)=>s+i.price*i.qty,0);
    const count2 = sfCart.reduce((s,i)=>s+i.qty,0);
    if (detSec) detSec.style.display='block';
    if (shipSec) shipSec.style.display='block';
    if (payInfo) payInfo.style.display='block';
    el.innerHTML = `
      <div style="padding:0.75rem 1.4rem;border-bottom:1px solid #E8E4DE;display:flex;align-items:center;justify-content:space-between;">
        <button onclick="sfGoBackToCart()" style="background:none;border:none;cursor:pointer;font-size:0.85rem;color:#8A8480;font-family:'Outfit',sans-serif;padding:0;">← Edit cart</button>
        <span style="font-size:0.75rem;color:#8A8480;">${count2} item${count2!==1?'s':''}</span>
      </div>
      <div style="padding:0.6rem 1.4rem;background:#F5F2ED;border-bottom:1px solid #E8E4DE;">
        <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8A8480;margin-bottom:0.4rem;">Your Order</div>
        ${sfCart.map(i=>`
          <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:0.3rem 0;border-bottom:1px solid rgba(0,0,0,0.06);">
            <div style="font-size:0.8rem;">
              <span>${i.emoji} </span><span style="font-weight:600;">${i.name}</span>
              <div style="font-size:0.7rem;color:#8A8480;margin-top:0.1rem;">${i.size} &times; ${i.qty}</div>
            </div>
            <span style="font-size:0.82rem;font-weight:700;flex-shrink:0;margin-left:0.75rem;">J$${ (i.price*i.qty).toLocaleString()}</span>
          </div>`).join('')}
        <div style="display:flex;justify-content:space-between;font-size:0.88rem;font-weight:700;padding-top:0.45rem;margin-top:0.1rem;">
          <span>Subtotal</span><span>J$${sub2.toLocaleString()}</span>
        </div>
      </div>`;
    sfRenderCartFooter();
    // Re-apply previously selected shipping visual state
    if (sfSelectedShip) {
      const opt = document.getElementById('sf-ship-' + sfSelectedShip);
      if (opt) {
        opt.classList.add('on');
        const radio = document.getElementById('sfr-' + sfSelectedShip);
        if (radio) radio.checked = true;
        const extra = document.getElementById('sf-' + sfSelectedShip + '-extra');
        if (extra) extra.classList.add('show');
      }
      if (sfSelectedShip === 'caribbean' && sfCaribbeanCountry) {
        const countryEl = document.getElementById('sf-caribbean-country');
        if (countryEl) countryEl.value = sfCaribbeanCountry;
        const kg = sfGetCartWeightKg();
        const result = sfCalcCaribbeanShipping(sfCaribbeanCountry, kg);
        const display = document.getElementById('sf-caribbean-cost-display');
        const badge = document.getElementById('sf-caribbean-fee-badge');
        if (display && result) {
          display.textContent = 'Est. weight: ' + kg.toFixed(1) + 'kg · USD $' + result.usd + ' (~J$' + result.jmd.toLocaleString() + ')';
          display.style.display = 'block';
        }
        if (badge && result) badge.innerHTML = '~J$' + result.jmd.toLocaleString() + '<br><span style="font-size:0.62rem;font-weight:400;color:#8A8480;">shipping</span>';
      }
    }
  }
}

function sfRenderCartFooter() {
  const footer = document.getElementById('sf-cart-footer');
  if (!footer) return;
  const rawSub = sfCart.reduce((s,i)=>s+i.price*i.qty,0);
  const sub = rawSub - sfDiscountAmount;
  const caribFee = (function() {
    if (sfSelectedShip !== 'caribbean' || !sfCaribbeanCountry) return 0;
    return sfCalcCaribbeanShipping(sfCaribbeanCountry, sfGetCartWeightKg()).jmd;
  })();
  const shipFees = {knutsford:500, zipmail:1000, kingston:1000, caribbean: caribFee};
  const shipLabels = {knutsford:'Knutsford (+J$500)', zipmail:'Zipmail (+~J$1,000)', kingston:'Kingston Delivery (+~J$1,000)', caribbean: sfCaribbeanCountry ? sfCaribbeanCountry + ' (~J$' + caribFee.toLocaleString() + ')' : 'Caribbean — select country above'};
  const fee = sfSelectedShip ? shipFees[sfSelectedShip] : 0;
  const grandTotal = sub + fee;
  const cardFee = Math.round(grandTotal * 0.15);
  const cardTotal = grandTotal + cardFee;
  const isCard = sfSelectedPayment === 'card';
  footer.style.display = 'block';
  footer.innerHTML = `<div style="padding:0.75rem 1.4rem 1.2rem;border-top:1px solid #E8E4DE;">
    <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:#8A8480;margin-bottom:0.25rem;"><span>Subtotal</span><span>J$${rawSub.toLocaleString()}</span></div>
    ${sfDiscountAmount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:0.8rem;color:#059669;margin-bottom:0.25rem;"><span>Discount (${sfDiscountLabel})</span><span>−J$${sfDiscountAmount.toLocaleString()}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:#8A8480;margin-bottom:0.45rem;padding-bottom:0.45rem;border-bottom:1px solid #E8E4DE;"><span>Shipping</span><span>${sfSelectedShip ? shipLabels[sfSelectedShip] : '— select shipping above'}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:1.05rem;font-weight:800;margin-bottom:0.85rem;">
      <span>Total</span><span>${sfSelectedShip ? 'J$'+grandTotal.toLocaleString() : 'J$'+sub.toLocaleString()+' + shipping'}</span>
    </div>
    ${sfSelectedShip ? `
    <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8A8480;margin-bottom:0.45rem;">Payment Method</div>
    <div class="sf-pay-opts">
      <label class="sf-pay-opt-lbl ${!isCard?'on':''}" onclick="sfSetPayment('wa')">
        <input type="radio" name="sf-pay" ${!isCard?'checked':''} readonly> 🏦 Bank Transfer / Lynk &mdash; <strong>no extra fee</strong>
      </label>
      <label class="sf-pay-opt-lbl ${isCard?'on':''}" onclick="sfSetPayment('card')">
        <input type="radio" name="sf-pay" ${isCard?'checked':''} readonly> 💳 Pay by Card via Fygaro &mdash; <strong>15% fee applies</strong>
      </label>
    </div>
    ${isCard ? `<div class="sf-card-fee-box">Card processing fee (15%): <strong>J$${cardFee.toLocaleString()}</strong> &nbsp;&middot;&nbsp; Total charged to card: <strong>J$${cardTotal.toLocaleString()}</strong></div>` : ''}
    ` : ''}
    <label style="display:flex;align-items:flex-start;gap:0.6rem;font-size:0.75rem;color:#4B4846;line-height:1.6;margin-bottom:0.85rem;cursor:pointer;">
      <input type="checkbox" id="sf-terms-check" ${sfTermsChecked?'checked':''} onchange="sfTermsChecked=this.checked" style="margin-top:2px;flex-shrink:0;width:14px;height:14px;cursor:pointer;">
      I agree to the <span onclick="sfScroll('sf-policies');sfCloseCart();" style="color:#0F0E0D;font-weight:700;text-decoration:underline;cursor:pointer;">Terms &amp; Conditions</span>, Refund Policy and Shipping Policy of Najah Chemist
    </label>
    ${isCard && sfSelectedShip ? `
      <button class="sf-fygaro-btn" onclick="sfCheckoutFygaro()">💳 Pay Now by Card &mdash; J$${cardTotal.toLocaleString()}</button>
      <p style="text-align:center;font-size:0.68rem;color:#8A8480;margin-top:0.4rem;">Secure payment via Fygaro. Card total includes 15% processing fee.</p>
    ` : `
      <button onclick="sfCheckoutWA()" ${!sfSelectedShip?'disabled':''} style="width:100%;padding:0.85rem;background:${sfSelectedShip?'#25D366':'#9CA3AF'};color:white;border:none;border-radius:10px;font-family:'Outfit',sans-serif;font-size:0.9rem;font-weight:700;cursor:${sfSelectedShip?'pointer':'not-allowed'};">
        📱 Send Order via WhatsApp
      </button>
      ${!sfSelectedShip ? '<p style="text-align:center;font-size:0.68rem;color:#8A8480;margin-top:0.4rem;">Select a shipping method above to continue</p>' : ''}
    `}
  </div>`;
}

window.sfSetPayment = function(method) {
  sfSelectedPayment = method;
  sfRenderCartFooter();
};

// ── Firestore Order Save ──────────────────────────────
// Defined here (regular script) so it is always globally accessible regardless
// of whether the module script loaded cleanly. Uses dynamic import + window._db,
// the same self-contained pattern as saveSubscriber.
async function linkOrderToClient(orderDocId, orderData) {
  var db = window._db;
  if (!db) return;
  var mod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
  var _doc = mod.doc, _getDoc = mod.getDoc, _setDoc = mod.setDoc,
      _updateDoc = mod.updateDoc, _ts = mod.serverTimestamp, _inc = mod.increment;
  var name = (orderData.client||orderData.customerName||'').trim();
  var email = (orderData.email||orderData.customerEmail||'').trim().toLowerCase();
  var phone = (orderData.phone||orderData.customerWhatsApp||orderData.wa||'').replace(/\D/g,'');
  var clientId = email || phone || ('name_'+(name||'unknown')+'_'+Date.now()).toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
  var clientRef = _doc(db,'clients',clientId);
  var existing = await _getDoc(clientRef);
  var base = existing.exists() ? {} : {created_at: _ts()};
  var data = Object.assign({}, base, {
    name: name, email: email||'', phone: phone||'', whatsapp: phone||'',
    orders: _inc(1),
    totalSpent: _inc(parseFloat(orderData.total)||0)
  });
  if (!email && !phone) data.incomplete = true;
  await _setDoc(clientRef, data, {merge:true});
  await _updateDoc(_doc(db,'orders',orderDocId), {client_id: clientId});
}

async function saveOrderSilent(order) {
  try {
    console.log('saveOrderSilent REACHED', order.id);
    var db = window._db;
    if (!db) { console.warn('[Najah] saveOrderSilent: db not ready on window._db'); return; }
    var mod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
    var addDoc = mod.addDoc, collection = mod.collection, serverTimestamp = mod.serverTimestamp;
    var orderRef = await addDoc(collection(db,'orders'), Object.assign({}, order, {createdAt: serverTimestamp()}));
    linkOrderToClient(orderRef.id, order).catch(function(e){ console.error('[client-link]', e); });
  } catch(e) {
    console.error('FIRESTORE SAVE FAILED:', e);
  }
}
window.saveOrderSilent = saveOrderSilent;

// ── Filling pre-modal (shown before WhatsApp opens) ──
function sfShowFillingModal(fee, onDecision) {
  if (!document.getElementById('sf-filling-modal-overlay')) {
    var el = document.createElement('div');
    el.id = 'sf-filling-modal-overlay';
    el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,14,13,0.72);z-index:960;align-items:center;justify-content:center;padding:1rem;';
    el.innerHTML = '<div style="background:white;border-radius:16px;border:2px solid #b8860b;max-width:380px;width:100%;padding:1.5rem;text-align:center;font-family:\'Outfit\',sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.18);">'
      + '<div style="font-size:2rem;margin-bottom:0.5rem;">🧴</div>'
      + '<h3 style="font-size:1rem;font-weight:700;color:#0F0E0D;margin:0 0 0.4rem;">Want us to fill your containers?</h3>'
      + '<p id="sf-filling-modal-desc" style="font-size:0.82rem;color:#4B4846;line-height:1.6;margin:0 0 1.2rem;"></p>'
      + '<button id="sf-filling-modal-yes" style="display:block;width:100%;padding:0.75rem;background:#b8860b;color:white;border:none;border-radius:10px;font-family:\'Outfit\',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;margin-bottom:0.5rem;"></button>'
      + '<button id="sf-filling-modal-no" style="display:block;width:100%;padding:0.65rem;background:none;border:none;color:#8A8480;font-family:\'Outfit\',sans-serif;font-size:0.8rem;cursor:pointer;text-decoration:underline;">No thanks, continue</button>'
      + '</div>';
    document.body.appendChild(el);
  }
  var ov = document.getElementById('sf-filling-modal-overlay');
  document.getElementById('sf-filling-modal-desc').textContent = 'We\u2019ll fill your bottles/jars with your product. Fee: J$' + fee.toLocaleString();
  document.getElementById('sf-filling-modal-yes').textContent = 'Yes, add filling service \u2014 J$' + fee.toLocaleString();
  document.getElementById('sf-filling-modal-yes').onclick = function() { ov.style.display = 'none'; onDecision(fee); };
  document.getElementById('sf-filling-modal-no').onclick = function() { ov.style.display = 'none'; onDecision(0); };
  ov.style.display = 'flex';
}

// ── Checkout ─────────────────────────────────────────
window.sfCheckoutWA = function() {
  const name = (document.getElementById('sf-cust-name')?.value||'').trim();
  const phone = (document.getElementById('sf-cust-phone')?.value||'').trim();
  const custEmail = (document.getElementById('sf-cust-email')?.value||'').trim();
  if (!name) {
    const n = document.getElementById('sf-cust-name');
    if (n) { n.focus(); n.style.borderColor='#DC2626'; }
    sfShowToast('Please enter your name');
    return;
  }
  if (!sfSelectedShip) { sfShowToast('Please select a shipping method'); return; }
  const termsCheck = document.getElementById('sf-terms-check');
  if (termsCheck && !termsCheck.checked) { sfShowToast('Please agree to the Terms & Conditions to continue'); return; }

  // Validate specific branch / location / address
  if (sfSelectedShip === 'knutsford') {
    const sel = (document.getElementById('sf-knutsford-branch')?.value||'').trim();
    const other = (document.getElementById('sf-knutsford-branch-other')?.value||'').trim();
    if (!sel || (sel === 'Other' && !other)) { sfShowToast('Please select your Knutsford branch'); return; }
  } else if (sfSelectedShip === 'zipmail') {
    const sel = (document.getElementById('sf-zipmail-location')?.value||'').trim();
    const other = (document.getElementById('sf-zipmail-location-other')?.value||'').trim();
    if (!sel || (sel === 'Other' && !other)) { sfShowToast('Please select your Zipmail location'); return; }
  } else if (sfSelectedShip === 'kingston') {
    const addr = (document.getElementById('sf-delivery-address')?.value||'').trim();
    if (!addr) { sfShowToast('Please enter your delivery address'); return; }
  } else if (sfSelectedShip === 'caribbean') {
    if (!sfCaribbeanCountry) { sfShowToast('Please select your destination country'); return; }
  }
  const { knutsfordBranch, zipmailLocation, deliveryAddress, shippingDetail, deliveryLocation, deliveryFee } = sfGetShippingInfo();
  const shipDetail = shippingDetail;

  const rawSub = sfCart.reduce((s,i)=>s+i.price*i.qty,0);
  const sub = rawSub - sfDiscountAmount;
  const total = sub + deliveryFee;
  const orderId = 'NC-' + Math.floor(10000 + Math.random()*90000);
  const date = new Date().toLocaleString('en-JM');
  const productsStr = sfCart.map(i=>`${i.name} (${i.size} x${i.qty})`).join(' | ');
  const items = sfCart.map(i=>`  * ${i.name} (${i.size}) x${i.qty} = J$${(i.price*i.qty).toLocaleString()}`).join('\n');
  const cartSnapshot = [...sfCart];
  const discountNote = sfDiscountAmount > 0 ? '\nDISCOUNT (' + sfDiscountLabel + '): -J$' + sfDiscountAmount.toLocaleString() : '';

  // Inner function — called synchronously from either the filling modal button or directly.
  // window.open here is safe because it's always reachable from a real user click.
  function proceed(fillingFee) {
    window.sfFillingFee = fillingFee;
    window._sfFillingHandled = true;
    const WA = window.WA_NUMBER || '18768851099';
    const fillingLine = fillingFee > 0 ? '\n🧴 Container Filling Service: J$' + fillingFee.toLocaleString() : '';
    const grandTotal = total + fillingFee;
    const msg = 'Hi Najah Chemist! I would like to place an order.\n\nORDER ID: ' + orderId + '\n\nCUSTOMER\nName: ' + name + (phone?'\nPhone: '+phone:'') + '\n\nORDER\n' + items + '\n\nSUBTOTAL: J$' + rawSub.toLocaleString() + discountNote + '\nSHIPPING: ' + shipDetail + fillingLine + '\nTOTAL: J$' + grandTotal.toLocaleString() + '\n\nPAYMENT\nI understand payment is required upfront (no COD).\nI will pay via bank transfer, Fygaro, or Lynk.\n\nPlease confirm my order. Thank you!';
    window.open('https://wa.me/' + WA + '?text=' + encodeURIComponent(msg), '_blank');

    document.getElementById('cf-order-id').textContent = orderId;
    document.getElementById('cf-items').innerHTML = cartSnapshot.map(i=>
      '<div style="display:flex;justify-content:space-between;"><span>'+i.name+' ('+i.size+') x'+i.qty+'</span><span>J$'+(i.price*i.qty).toLocaleString()+'</span></div>'
    ).join('');
    document.getElementById('cf-sub').textContent = 'J$' + sub.toLocaleString();
    document.getElementById('cf-ship').textContent = 'J$' + deliveryFee.toLocaleString();
    document.getElementById('cf-total').textContent = 'J$' + grandTotal.toLocaleString();
    document.getElementById('sf-confirm-overlay').classList.add('open');

    // Store original order details for upsell updated message (before cart is cleared)
    window._originalItems = cartSnapshot;
    window._originalSubtotal = rawSub;
    window._originalDiscount = sfDiscountAmount;
    window._originalDiscountLabel = sfDiscountLabel;
    window._originalShipping = shipDetail;
    window._originalShippingCost = deliveryFee;
    window._originalOrderId = orderId;
    window._originalCustomerName = name;
    window._originalCustomerPhone = phone;
    window._originalGrandTotal = grandTotal;

    sfCart = [];
    sfTermsChecked = false;
    sfSelectedPayment = 'wa';
    sfDiscountApplied = false;
    sfDiscountAmount = 0;
    sfUpdateCartBtn();
    sfCloseCart();

    setTimeout(async function() {
      try {
        const totalQty = cartSnapshot.reduce(function(s,i){return s+i.qty;},0);
        await window.saveOrderSilent({id:orderId,client:name,product:productsStr,size:'—',qty:totalQty,source:'Website',payment:'Unpaid',paymentStatus:'Unpaid',status:'Pending',date:date,total:grandTotal,payMethod:'Bank/Lynk',phone:phone||'—',deliveryLocation:deliveryLocation,deliveryFee:deliveryFee,knutsfordBranch:knutsfordBranch,zipmailLocation:zipmailLocation,deliveryAddress:deliveryAddress,shippingDetail:shippingDetail,caribbeanCountry:sfSelectedShip==='caribbean'?sfCaribbeanCountry:'',caribbeanShippingCost:sfSelectedShip==='caribbean'?deliveryFee:0});
        console.log('ORDER SAVED:', orderId);
      } catch(e) {
        console.error('SAVE FAILED:', e);
      }
      try {
        sfShowUpsell(cartSnapshot, orderId);
      } catch(e) {
        console.error('UPSELL ERROR:', e);
      }
      try { sfMarkCartRecovered(); } catch(e) {}
      try {
        await fetch('/.netlify/functions/create-order', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({orderId:orderId, date:date, customerName:name, phone:phone, products:productsStr, deliveryLocation:deliveryLocation, deliveryFee:deliveryFee, total:grandTotal, status:'NEW'})
        });
      } catch(e) { console.error('Sheets save failed:', e); }
      if (custEmail) {
        try { await saveSubscriber(name, custEmail, 'checkout'); } catch(e) {}
        try {
          await fetch('/.netlify/functions/send-receipt', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({orderId:orderId, customerName:name, email:custEmail,
              items:cartSnapshot.map(function(i){return {name:i.name,size:i.size,qty:i.qty,price:i.price};}),
              subtotal:sub, deliveryFee:deliveryFee, total:grandTotal, shipDetail:shipDetail})
          });
        } catch(e) {}
      }
    }, 100);
  }

  // If cart has containers + non-containers, ask about filling BEFORE opening WhatsApp
  var hasContainer = cartSnapshot.some(function(i){ return i.cat === 'containers' || /bottle|jar|container/i.test(i.name||''); });
  var hasNonContainer = cartSnapshot.some(function(i){ return i.cat !== 'containers' && !/bottle|jar|container/i.test(i.name||''); });
  if (hasContainer && hasNonContainer) {
    var productSub = cartSnapshot.reduce(function(s,i){ return (i.cat==='containers'||/bottle|jar|container/i.test(i.name||''))?s:s+i.price*i.qty; }, 0);
    sfShowFillingModal(Math.round(productSub * 0.15), proceed);
  } else {
    proceed(0);
  }
};

// ── Fygaro Card Checkout ─────────────────────────────
// Must remain a sync function — window.open must be called synchronously
window.sfCheckoutFygaro = function() {
  const name = (document.getElementById('sf-cust-name')?.value||'').trim();
  const phone = (document.getElementById('sf-cust-phone')?.value||'').trim();
  const custEmail = (document.getElementById('sf-cust-email')?.value||'').trim();
  if (!name) {
    const n = document.getElementById('sf-cust-name');
    if (n) { n.focus(); n.style.borderColor='#DC2626'; }
    sfShowToast('Please enter your name');
    return;
  }
  if (!sfSelectedShip) { sfShowToast('Please select a shipping method'); return; }
  const termsCheck = document.getElementById('sf-terms-check');
  if (termsCheck && !termsCheck.checked) { sfShowToast('Please agree to the Terms & Conditions to continue'); return; }

  // Validate specific branch / location / address
  if (sfSelectedShip === 'knutsford') {
    const sel = (document.getElementById('sf-knutsford-branch')?.value||'').trim();
    const other = (document.getElementById('sf-knutsford-branch-other')?.value||'').trim();
    if (!sel || (sel === 'Other' && !other)) { sfShowToast('Please select your Knutsford branch'); return; }
  } else if (sfSelectedShip === 'zipmail') {
    const sel = (document.getElementById('sf-zipmail-location')?.value||'').trim();
    const other = (document.getElementById('sf-zipmail-location-other')?.value||'').trim();
    if (!sel || (sel === 'Other' && !other)) { sfShowToast('Please select your Zipmail location'); return; }
  } else if (sfSelectedShip === 'kingston') {
    const addr = (document.getElementById('sf-delivery-address')?.value||'').trim();
    if (!addr) { sfShowToast('Please enter your delivery address'); return; }
  } else if (sfSelectedShip === 'caribbean') {
    if (!sfCaribbeanCountry) { sfShowToast('Please select your destination country'); return; }
  }
  const { knutsfordBranch, zipmailLocation, deliveryAddress, shippingDetail, deliveryLocation, deliveryFee } = sfGetShippingInfo();
  const shipDetail = shippingDetail;

  const rawSub = sfCart.reduce((s,i)=>s+i.price*i.qty,0);
  const sub = rawSub - sfDiscountAmount;
  const grandTotal = sub + deliveryFee;
  const cardFee = Math.round(grandTotal * 0.15);
  const cardTotal = grandTotal + cardFee;
  const orderId = 'NC-' + Math.floor(10000 + Math.random()*90000);
  const date = new Date().toLocaleString('en-JM');
  const productsStr = sfCart.map(i=>`${i.name} (${i.size} x${i.qty})`).join(' | ');
  const cartSnapshot = [...sfCart];
  const items = sfCart.map(i=>`  * ${i.name} (${i.size}) x${i.qty} = J$${(i.price*i.qty).toLocaleString()}`).join('\n');
  const discountNote = sfDiscountAmount > 0 ? '\nDISCOUNT (' + sfDiscountLabel + '): -J$' + sfDiscountAmount.toLocaleString() : '';

  // 1. Open Fygaro IMMEDIATELY — synchronous to avoid browser popup block
  const FYGARO_URL = 'https://www.fygaro.com/en/pb/817f634a-4ee0-41c7-9ad2-6508ae2048c2/';
  window.open(FYGARO_URL + '?amount=' + cardTotal + '&clientnote=' + encodeURIComponent(orderId), '_blank');

  // 1b. Open WhatsApp notification — same user gesture, fires alongside Fygaro
  const WA = window.WA_NUMBER || '18768851099';
  const waMsg = 'Hi Najah Chemist! I would like to place an order.\n\nORDER ID: ' + orderId + '\n\nCUSTOMER\nName: ' + name + (phone ? '\nPhone: ' + phone : '') + '\n\nORDER\n' + items + '\n\nSUBTOTAL: J$' + rawSub.toLocaleString() + discountNote + '\nSHIPPING: ' + shipDetail + '\nTOTAL: J$' + cardTotal.toLocaleString() + ' (incl. 15% card fee)\n\nPAYMENT\nPaying by card via Fygaro.\n\nPlease confirm my order. Thank you!';
  window.open('https://wa.me/' + WA + '?text=' + encodeURIComponent(waMsg), '_blank');

  // 2. Show confirmation modal
  document.getElementById('cf-order-id').textContent = orderId;
  document.getElementById('cf-items').innerHTML = cartSnapshot.map(i=>
    '<div style="display:flex;justify-content:space-between;"><span>'+i.name+' ('+i.size+') x'+i.qty+'</span><span>J$'+(i.price*i.qty).toLocaleString()+'</span></div>'
  ).join('');
  document.getElementById('cf-sub').textContent = 'J$' + sub.toLocaleString();
  document.getElementById('cf-ship').textContent = 'J$' + deliveryFee.toLocaleString();
  document.getElementById('cf-total').textContent = 'J$' + cardTotal.toLocaleString() + ' (incl. 15% card fee)';
  document.getElementById('sf-confirm-overlay').classList.add('open');

  // 3. Clear cart
  sfCart = [];
  sfTermsChecked = false;
  sfSelectedPayment = 'wa';
  sfDiscountApplied = false;
  sfDiscountAmount = 0;
  sfUpdateCartBtn();
  sfCloseCart();

  // 4. Save to Sheets + Firestore + email in background
  setTimeout(async function() {
    // 1. SAVE ORDER FIRST — nothing before this
    try {
      const totalQty = cartSnapshot.reduce(function(s,i){return s+i.qty;},0);
      await window.saveOrderSilent({id:orderId,client:name,product:productsStr,size:'—',qty:totalQty,source:'Website',payment:'Unpaid',paymentStatus:'Awaiting Payment',status:'Pending',date:date,total:cardTotal,payMethod:'Fygaro Card',phone:phone||'—',deliveryLocation:deliveryLocation,deliveryFee:deliveryFee,knutsfordBranch:knutsfordBranch,zipmailLocation:zipmailLocation,deliveryAddress:deliveryAddress,shippingDetail:shippingDetail,caribbeanCountry:sfSelectedShip==='caribbean'?sfCaribbeanCountry:'',caribbeanShippingCost:sfSelectedShip==='caribbean'?deliveryFee:0});
      console.log('ORDER SAVED:', orderId);
    } catch(e) {
      console.error('SAVE FAILED:', e);
    }

    // 2. UPSELL POPUP — only after save completes
    try {
      sfShowUpsell(cartSnapshot, orderId);
    } catch(e) {
      console.error('UPSELL ERROR:', e);
    }

    // 3. Everything else — background tasks that must not block the save
    try { sfMarkCartRecovered(); } catch(e) {}
    try {
      await fetch('/.netlify/functions/create-order', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({orderId, date, customerName:name, phone, products:productsStr, deliveryLocation, deliveryFee, total:cardTotal, status:'Awaiting Payment'})
      });
    } catch(e) { console.error('Sheets save failed:', e); }
    if (custEmail) {
      try { await saveSubscriber(name, custEmail, 'checkout'); } catch(e) {}
      try {
        await fetch('/.netlify/functions/send-receipt', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({orderId, customerName:name, email:custEmail,
            items:cartSnapshot.map(function(i){return {name:i.name,size:i.size,qty:i.qty,price:i.price};}),
            subtotal:sub, deliveryFee, total:cardTotal, shipDetail,
            note:'Payment via Fygaro card — total includes 15% processing fee'})
        });
      } catch(e) {}
    }
  }, 100);
};

// ── Email Collection ──────────────────────────────────
// (saveSubscriber is defined in the module script above line 3033)

// ── Waitlist ──────────────────────────────────────────
async function sfJoinWaitlist() {
  const email = (document.getElementById('sf-waitlist-email')?.value||'').trim();
  const msgEl = document.getElementById('sf-waitlist-msg');
  const btn = document.getElementById('sf-waitlist-btn');

  if (!email || !email.includes('@')) {
    msgEl.textContent = 'Please enter a valid email address.';
    msgEl.style.display = 'block';
    return;
  }

  const productId = window.sfCurrentProductId || null;
  const productName = window.sfCurrentProductName || 'this product';

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const res = await fetch('/.netlify/functions/join-waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, productId, productName })
    });
    const data = await res.json();
    if (data.success) {
      msgEl.textContent = "You're on the list! We'll email you when it's back.";
      msgEl.style.color = '#2e7d32';
      msgEl.style.display = 'block';
      document.getElementById('sf-waitlist-email').style.display = 'none';
      btn.style.display = 'none';
    } else {
      throw new Error(data.error || 'Failed');
    }
  } catch(e) {
    msgEl.textContent = 'Something went wrong. Please try again.';
    msgEl.style.color = '#c62828';
    msgEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Notify Me';
  }
}
window.sfJoinWaitlist = sfJoinWaitlist;

// ── Abandoned Cart ────────────────────────────────────
const _sfSessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
let _sfAbandonedCartDocId = null;

function sfGetPageEmail() {
  const ids = ['sf-cust-email', 'po-email', 'pm-email', 'cp-email', 'email'];
  for (const id of ids) {
    const v = (document.getElementById(id)?.value || '').trim();
    if (v.includes('@')) return v.toLowerCase();
  }
  return null;
}

async function sfSaveAbandonedCart() {
  if (sfCart.length === 0) return;
  const email = sfGetPageEmail();
  if (!email) return;
  const db = window._db;
  if (!db) return;
  try {
    const { collection, doc, addDoc, setDoc, serverTimestamp } =
      await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
    const name = (document.getElementById('sf-cust-name')?.value || '').trim();
    const cartItems = sfCart.map(i => ({ name: i.name, size: i.size, qty: i.qty }));
    if (_sfAbandonedCartDocId) {
      await setDoc(doc(db, 'abandonedCarts', _sfAbandonedCartDocId),
        { email, name, cartItems, updatedAt: serverTimestamp() },
        { merge: true });
    } else {
      const ref = await addDoc(collection(db, 'abandonedCarts'), {
        email, name, cartItems,
        createdAt: serverTimestamp(),
        recovered: false,
        emailSent: false,
        sessionId: _sfSessionId
      });
      _sfAbandonedCartDocId = ref.id;
    }
  } catch(e) { console.error('[abandonedCart] save error:', e); }
}

async function sfMarkCartRecovered() {
  if (!_sfAbandonedCartDocId) return;
  const db = window._db;
  if (!db) return;
  try {
    const { doc, updateDoc, serverTimestamp } =
      await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
    await updateDoc(doc(db, 'abandonedCarts', _sfAbandonedCartDocId), {
      recovered: true,
      recoveredAt: serverTimestamp()
    });
  } catch(e) { console.error('[abandonedCart] recover error:', e); }
}

// ── Chat widget ───────────────────────────────────────
let sfChatOpen = false;
let sfChatHistory = [];

window.sfToggleChat = function() {
  sfChatOpen = !sfChatOpen;
  const box = document.getElementById('sf-chat-box');
  const fab = document.getElementById('sf-chat-fab');
  if (box) box.classList.toggle('open', sfChatOpen);
  if (fab) fab.style.display = sfChatOpen ? 'none' : 'flex';
  if (sfChatOpen && sfChatHistory.length === 0) {
    sfAddChatMsg('Hi! I\'m the Najah Chemist assistant. Ask me anything about our products, pricing, or shipping.', false);
  }
};

window.sfChatQ = function(q) {
  document.getElementById('sf-ch-in').value = q;
  window.sfChatSend();
};

window.sfChatSend = async function() {
  const inp = document.getElementById('sf-ch-in');
  const msg = (inp ? inp.value : '').trim();
  if (!msg) return;
  if (inp) inp.value = '';
  sfAddChatMsg(msg, true);
  const typing = sfAddChatMsg('...', false, true);
  try {
    const res = await fetch('/.netlify/functions/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: msg, history: sfChatHistory.slice(-6)})
    });
    const data = await res.json();
    if (typing) typing.remove();
    sfAddChatMsg(data.reply || 'Sorry, I could not get a response. Please try again.', false);
  } catch(e) {
    if (typing) typing.remove();
    sfAddChatMsg('Sorry, something went wrong. Please WhatsApp us directly at +1 876-885-1099.', false);
  }
};

function sfAddChatMsg(text, isUser, isTyping) {
  const msgs = document.getElementById('sf-ch-msgs');
  if (!msgs) return null;
  const div = document.createElement('div');
  div.className = isUser ? 'sf-ch-msg sf-ch-user' : 'sf-ch-msg sf-ch-bot';
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  if (!isTyping) sfChatHistory.push({role: isUser ? 'user' : 'assistant', content: text});
  return div;
}

// ── Container products (hardcoded) ───────────────────────────────────────
(function() {
  const containers = [
    { id:'con1',  cat:'containers', name:'Small Pouch',          tagline:'Ideal for boric acid and small dry products. Clients typically sell in sets of 7\u201310 for J$1,000.', emoji:'🛍️', pricing:[{key:'unit',price:65}],  unitDesc:'Each', tag:'Packaging', hidden:false },
    { id:'con2',  cat:'containers', name:'Large Pouch',          tagline:'Larger pouch for packaging dry or powdered products.',                                                  emoji:'🛍️', pricing:[{key:'unit',price:85}],  unitDesc:'Each', tag:'Packaging', hidden:false },
    { id:'con3',  cat:'containers', name:'2oz Spray / Mist Bottle', tagline:'Plastic spray bottle for toners, facial mists, and lightweight liquid products.',                  emoji:'🧴', pricing:[{key:'unit',price:170}], unitDesc:'Each', tag:'Packaging', hidden:false },
    { id:'con4',  cat:'containers', name:'4oz Flip Top Bottle',  tagline:'Plastic flip top for body wash, conditioners, and thicker liquid products.',                           emoji:'🧴', pricing:[{key:'unit',price:250}], unitDesc:'Each', tag:'Packaging', hidden:false },
    { id:'con5',  cat:'containers', name:'4oz Spray Bottle',     tagline:'Plastic spray bottle for body mists, setting sprays, and larger liquid volumes.',                      emoji:'🧴', pricing:[{key:'unit',price:250}], unitDesc:'Each', tag:'Packaging', hidden:false },
    { id:'con6',  cat:'containers', name:'4oz Double Wall Jar',  tagline:'Plastic double wall jar in natural or white. For body butter, scrubs, and thick creams.',              emoji:'🫙', pricing:[{key:'unit',price:300}], unitDesc:'Each', tag:'Packaging', hidden:false },
    { id:'con7',  cat:'containers', name:'4oz Foam Bottle',      tagline:'Plastic foaming pump bottle for yoni washes, facial cleansers, and liquid soaps.',                    emoji:'🧴', pricing:[{key:'unit',price:300}], unitDesc:'Each', tag:'Packaging', hidden:false },
    { id:'con8',  cat:'containers', name:'2oz Foam Bottle',      tagline:'Plastic foaming pump bottle for serums, cleansers, and liquid products.',                             emoji:'🧴', pricing:[{key:'unit',price:222}], unitDesc:'Each', tag:'Packaging', hidden:false },
    { id:'con9',  cat:'containers', name:'2oz Double Wall Jar',  tagline:'Plastic double wall jar in natural or white. For small-batch thick products.',                         emoji:'🫙', pricing:[{key:'unit',price:250}], unitDesc:'Each', tag:'Packaging', hidden:false },
    { id:'con10', cat:'containers', name:'2oz Dropper Bottle',   tagline:'Clear glass dropper bottle with gold top. For serums, facial oils, and tinctures.',                   emoji:'💧', pricing:[{key:'unit',price:270}], unitDesc:'Each', tag:'Packaging', hidden:false },
    { id:'con11', cat:'containers', name:'White Pill Bottle',    tagline:'White plastic pill bottle for capsules, tablets, and supplements.',                                    emoji:'💊', pricing:[{key:'unit',price:120}], unitDesc:'Each', tag:'Packaging', hidden:false },
  ];
  window.PRODUCTS = window.PRODUCTS || [];
  // Remove any previously injected container entries before re-adding
  window.PRODUCTS = window.PRODUCTS.filter(function(p){ return !p.id.startsWith('con'); });
  containers.forEach(function(c){ window.PRODUCTS.push(c); });
  // Show loading state then load products from Firestore
  var grid = document.getElementById('sf-products-grid');
  if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:#8A8480;font-size:0.88rem;">Loading products…</div>';
  sfLoadProductsFromFirestore();
})();

// ── Post-Purchase Upsell ─────────────────────────────
var _sfUpsellOrderId = null;
var _sfUpsellShown   = false;
window.sfFillingFee  = 0;
window._sfFillingFeeCalc = 0;

function sfShowUpsell(cartSnap, orderId) {
  if (_sfUpsellShown) return;
  _sfUpsellShown   = true;
  _sfUpsellOrderId = orderId;
  var products = sfBuildUpsellProducts(cartSnap);
  console.log('upsell triggered', products.length, 'products');
  // Container filling upsell: show only if cart has both container + non-container items
  var hasContainer = (cartSnap || []).some(function(i) {
    return i.cat === 'containers' || /bottle|jar|container/i.test(i.name || '');
  });
  var hasNonContainer = (cartSnap || []).some(function(i) {
    return i.cat !== 'containers' && !/bottle|jar|container/i.test(i.name || '');
  });
  if (!products.length && !hasContainer) return;
  sfRenderUpsellPopup(products);
  var fillingSection = document.getElementById('sf-filling-section');
  if (fillingSection) {
    // Filling decision was already captured in the pre-modal before WhatsApp opened
    fillingSection.style.display = 'none';
  }

  var ov = document.getElementById('sf-upsell-overlay');
  if (ov) ov.style.display = 'flex';
}

function sfBuildUpsellProducts(cartSnap) {
  var prods = (window.PRODUCTS || []).filter(function(p){ return !p.hidden && p.cat !== 'containers' && p.cat !== 'label'; });
  var orderedIds = {};
  (cartSnap || []).forEach(function(i){ orderedIds[i.id] = true; });
  var cats = {};
  (cartSnap || []).forEach(function(i){ if (i.cat) cats[i.cat.toLowerCase()] = true; });
  var names = (cartSnap || []).map(function(i){ return (i.name||'').toLowerCase(); }).join(' ');

  function find(test) {
    return prods.find(function(p){ return !orderedIds[p.id] && test(p); }) || null;
  }
  function nm(p){ return (p.name||'').toLowerCase(); }

  var targets = [];

  if (cats['yoni']) {
    targets = [
      find(function(p){ return p.cat==='yoni' && /foaming/.test(nm(p)); }),
      find(function(p){ return p.cat==='yoni' && /\boil\b/.test(nm(p)); }),
      find(function(p){ return /boric acid cap/.test(nm(p)); }),
    ];
  } else if (cats['mencare']) {
    targets = [
      find(function(p){ return /beard oil/.test(nm(p)); }),
      find(function(p){ return /beard balm/.test(nm(p)); }),
      find(function(p){ return /ryfle/.test(nm(p)); }),
    ];
  } else if (cats['skincare'] || /serum|cream|toner|cleanser|body butter|body scrub|body oil/.test(names)) {
    if (/body butter|body scrub|body oil/.test(names)) {
      // Ordered a body product → suggest face/skin treatment products
      targets = [
        find(function(p){ return /serum/.test(nm(p)); }),
        find(function(p){ return /cream|moistur/.test(nm(p)); }),
        find(function(p){ return /toner/.test(nm(p)); }),
      ];
    } else {
      // Ordered serum, cream, cleanser or toner → suggest body products
      targets = [
        find(function(p){ return /body butter/.test(nm(p)); }),
        find(function(p){ return /body scrub/.test(nm(p)); }),
        find(function(p){ return /body oil/.test(nm(p)); }),
      ];
    }
  } else if (cats['soap']) {
    targets = [
      find(function(p){ return /toner/.test(nm(p)); }),
      find(function(p){ return /serum/.test(nm(p)); }),
      find(function(p){ return /cream|moistur/.test(nm(p)); }),
    ];
  } else {
    // Default: best sellers
    var bsIds = window._bestSellerIds || [];
    targets = bsIds.slice(0,3).map(function(id){
      return prods.find(function(p){ return p.id===id && !orderedIds[p.id]; }) || null;
    });
  }

  var results = targets.filter(Boolean).slice(0,3);

  // Last resort: if category logic found nothing, grab first 3 non-ordered visible products
  if (!results.length) {
    results = prods.filter(function(p){ return !orderedIds[p.id]; }).slice(0,3);
  }

  return results;
}

function sfUpsellBasePrice(p) {
  var keys = Object.keys(p.pricing || {});
  if (!keys.length) return 0;
  var k = sfMinKey(p.pricing) || keys[0];
  return (p.pricing[k] && p.pricing[k].price) || 0;
}

function sfRenderUpsellPopup(products) {
  var container = document.getElementById('sf-upsell-cards');
  container.innerHTML = products.map(function(p) {
    var basePrice = sfUpsellBasePrice(p);
    var discPrice = Math.round(basePrice * 0.95);
    var imgHtml = p.img
      ? '<img src="'+p.img+'" alt="'+p.name+'" style="width:60px;height:60px;object-fit:cover;border-radius:10px;flex-shrink:0;">'
      : '<div style="width:60px;height:60px;border-radius:10px;background:#F5F2ED;display:flex;align-items:center;justify-content:center;font-size:1.8rem;flex-shrink:0;">'+(p.emoji||'🧴')+'</div>';
    return '<div style="display:flex;align-items:center;gap:0.9rem;padding:0.9rem;border:1.5px solid #E8E4DE;border-radius:12px;background:#FAFAF8;">'
      +imgHtml
      +'<div style="flex:1;min-width:0;">'
        +'<div style="font-size:0.82rem;font-weight:700;color:#1C1A18;margin-bottom:0.15rem;">'+p.name+'</div>'
        +'<div style="font-size:0.72rem;color:#8A8480;margin-bottom:0.35rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+(p.tagline||'')+'</div>'
        +'<div style="display:flex;align-items:center;gap:0.45rem;">'
          +'<span style="font-size:0.7rem;color:#8A8480;text-decoration:line-through;">J$'+basePrice.toLocaleString()+'</span>'
          +'<span style="font-size:0.88rem;font-weight:700;color:#059669;">J$'+discPrice.toLocaleString()+'</span>'
          +'<span style="background:#D1FAE5;color:#065F46;font-size:0.6rem;font-weight:700;padding:0.1rem 0.35rem;border-radius:20px;">−5%</span>'
        +'</div>'
      +'</div>'
      +'<button onclick="sfAddUpsellItem(\''+p.id+'\','+discPrice+',this)" style="background:#B45309;color:white;border:none;border-radius:8px;padding:0.5rem 0.65rem;font-family:\'Outfit\',sans-serif;font-size:0.7rem;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;line-height:1.4;">Add to<br>My Order</button>'
    +'</div>';
  }).join('');
}

window.sfAddUpsellItem = async function(productId, discPrice, btn) {
  var p = (window.PRODUCTS || []).find(function(x){ return x.id === productId; });
  if (!p) return;
  var db = window._db;
  if (!db || !_sfUpsellOrderId) { sfShowToast('Could not add — please message us on WhatsApp'); return; }

  btn.disabled = true;
  btn.innerHTML = '…';

  // Build and open updated WA message SYNCHRONOUSLY before any await (keeps browser popup unblocked)
  var sizeKey   = sfMinKey(p.pricing) || Object.keys(p.pricing||{})[0] || '';
  var sizeLabel = sfSizeLabel(sizeKey) || 'Standard';
  var origItems = window._originalItems || [];
  var origItemLines = origItems.map(function(i){
    return '  * ' + i.name + ' (' + i.size + ') x' + i.qty + ' = J$' + (i.price * i.qty).toLocaleString();
  }).join('\n');
  var upsellLine = '  * ' + p.name + ' (' + sizeLabel + ') x1 = J$' + discPrice.toLocaleString();
  var fillingFee = window.sfFillingFee || 0;
  var fillingItemLine = fillingFee > 0 ? '\n  * 🧴 Container Filling Service = J$' + fillingFee.toLocaleString() : '';
  var newRawSub = (window._originalSubtotal || 0) + discPrice;
  var discount = window._originalDiscount || 0;
  var discountLabel = window._originalDiscountLabel || '';
  var newSub = newRawSub - discount;
  var shipCost = window._originalShippingCost || 0;
  var newTotal = newSub + shipCost + fillingFee;
  var discountNote = discount > 0 ? '\nDISCOUNT (' + discountLabel + '): -J$' + discount.toLocaleString() : '';
  var custName = window._originalCustomerName || '';
  var custPhone = window._originalCustomerPhone || '';
  var shipDetail = window._originalShipping || '';
  var orderId = window._originalOrderId || _sfUpsellOrderId || '';
  var waMsg = 'Hi Najah Chemist! I would like to place an order.'
    + '\n\nORDER ID: ' + orderId + ' (UPDATED)'
    + '\n\nCUSTOMER\nName: ' + custName + (custPhone ? '\nPhone: ' + custPhone : '')
    + '\n\nORDER\n' + origItemLines + '\n' + upsellLine + fillingItemLine
    + '\n\nSUBTOTAL: J$' + newRawSub.toLocaleString() + discountNote
    + '\nSHIPPING: ' + shipDetail
    + '\nTOTAL: J$' + newTotal.toLocaleString()
    + '\n\nPAYMENT\nI understand payment is required upfront (no COD).\nI will pay via bank transfer, Fygaro, or Lynk.\n\nPlease confirm my updated order. Thank you!';
  var WA = window.WA_NUMBER || '18768851099';
  window.open('https://wa.me/' + WA + '?text=' + encodeURIComponent(waMsg), '_blank');

  try {
    var mod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
    var collection = mod.collection, query = mod.query, where = mod.where,
        getDocs = mod.getDocs, updateDoc = mod.updateDoc, doc = mod.doc,
        arrayUnion = mod.arrayUnion, increment = mod.increment;

    // Find order by id field; retry once if background save hasn't completed yet
    var snap = await getDocs(query(collection(db,'orders'), where('id','==', _sfUpsellOrderId)));
    if (snap.empty) {
      await new Promise(function(r){ setTimeout(r, 1500); });
      snap = await getDocs(query(collection(db,'orders'), where('id','==', _sfUpsellOrderId)));
    }
    if (snap.empty) {
      sfShowToast('Could not find order — message us on WhatsApp');
      btn.disabled = false; btn.innerHTML = 'Add to<br>My Order';
      return;
    }

    var existingProduct = snap.docs[0].data().product || '';
    var updatedProduct = existingProduct + (existingProduct ? ' | ' : '') + p.name + ' (' + sizeLabel + ' x1)';

    console.log('adding upsell item to order', _sfUpsellOrderId, p.name);
    await updateDoc(doc(db,'orders', snap.docs[0].id), {
      items: arrayUnion({name:p.name, size:sizeLabel, qty:1, price:discPrice, upsellDiscount:true}),
      product: updatedProduct,
      total: increment(discPrice)
    });

    btn.innerHTML = '✓ Added!';
    btn.style.background = '#059669';
    sfShowToast(p.name + ' added to your order!');
  } catch(e) {
    console.error('[upsell]', e);
    sfShowToast('Error: ' + (e.message || 'Unknown error'));
    btn.disabled = false; btn.innerHTML = 'Add to<br>My Order';
  }
};

window.sfCloseUpsell = function() {
  var ov = document.getElementById('sf-upsell-overlay');
  if (ov) ov.style.display = 'none';
  // Reset filling service state
  window.sfFillingFee = 0;
  window._sfFillingHandled = false;
  document.querySelectorAll('input[name="sf-filling-choice"]').forEach(function(r) {
    r.checked = (r.value === 'no');
  });
  var priceEl = document.getElementById('sf-filling-price');
  if (priceEl) priceEl.style.display = 'none';
  var fillingSection = document.getElementById('sf-filling-section');
  if (fillingSection) fillingSection.style.display = 'none';
};

window.sfFillingChoiceChanged = function(val) {
  var priceEl = document.getElementById('sf-filling-price');
  if (val === 'yes') {
    window.sfFillingFee = window._sfFillingFeeCalc || 0;
    if (priceEl) priceEl.style.display = 'block';
  } else {
    window.sfFillingFee = 0;
    if (priceEl) priceEl.style.display = 'none';
  }
};

// ── Reorder ───────────────────────────────────────────
window.sfOpenReorder = function() {
  var inp = document.getElementById('sf-reorder-phone');
  var msg = document.getElementById('sf-reorder-msg');
  var btn = document.getElementById('sf-reorder-btn');
  if (inp) inp.value = '';
  if (msg) { msg.textContent = ''; msg.style.display = 'none'; }
  if (btn) { btn.textContent = 'Load My Order →'; btn.disabled = false; }
  var ov = document.getElementById('sf-reorder-overlay');
  if (ov) ov.classList.add('open');
  setTimeout(function(){ if (inp) inp.focus(); }, 150);
};

window.sfCloseReorder = function() {
  var ov = document.getElementById('sf-reorder-overlay');
  if (ov) ov.classList.remove('open');
};

window.sfLoadOrder = async function() {
  var rawPhone = (document.getElementById('sf-reorder-phone')?.value || '').trim();
  var msgEl = document.getElementById('sf-reorder-msg');
  var btn = document.getElementById('sf-reorder-btn');

  var showErr = function(txt) {
    if (msgEl) { msgEl.textContent = txt; msgEl.style.display = 'block'; }
    if (btn) { btn.textContent = 'Load My Order →'; btn.disabled = false; }
  };

  var digits = rawPhone.replace(/\D/g, '');
  if (digits.length < 7) { showErr('Please enter a valid phone number.'); return; }

  if (btn) { btn.textContent = 'Searching…'; btn.disabled = true; }
  if (msgEl) { msgEl.style.display = 'none'; }

  try {
    var db = window._db;
    if (!db) { showErr('Service not ready — please try again.'); return; }

    var mod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
    var collection = mod.collection, getDocs = mod.getDocs, query = mod.query,
        orderBy = mod.orderBy, limit = mod.limit;

    var snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(300)));

    // Find most recent order whose phone matches (normalize both sides to digits)
    var matchOrder = null;
    snap.forEach(function(d) {
      if (matchOrder) return;
      var o = d.data();
      var stored = [o.phone, o.whatsapp, o.customerWhatsApp].filter(Boolean);
      for (var i = 0; i < stored.length; i++) {
        var s = stored[i].replace(/\D/g, '');
        if (!s) continue;
        // Match if either number ends with the other (handles country code differences)
        if (s.endsWith(digits) || digits.endsWith(s) || s.slice(-7) === digits.slice(-7)) {
          matchOrder = o;
          break;
        }
      }
    });

    if (!matchOrder) {
      sfCloseReorder();
      sfShowToast('No previous order found for this number. Browse our products below.');
      sfScroll('sf-products');
      return;
    }

    // Rebuild cart items from the order's product string
    // Format: "Name (Size xQty) | Name2 (Size2 xQty2)"
    var products = window.PRODUCTS || [];
    var productStr = matchOrder.product || '';
    var parts = productStr.split(' | ');
    var added = 0;

    parts.forEach(function(part) {
      var m = part.match(/^(.+) \((.+) x(\d+)\)$/);
      if (!m) return;
      var itemName = m[1].trim();
      var sizeStr  = m[2].trim();  // may include scent, e.g. "1 Litre · Strawberry"
      var qty      = parseInt(m[3]) || 1;
      var baseSize = sizeStr.split(' · ')[0]; // strip scent/mint for key lookup

      var prod = products.find(function(p) { return p.name === itemName; });
      if (!prod) return;

      var pricingKey = Object.keys(prod.pricing || {}).find(function(k) {
        return sfSizeLabel(k) === baseSize;
      }) || Object.keys(prod.pricing || {})[0];
      if (!pricingKey) return;

      var price = (prod.pricing[pricingKey] || {}).price || 0;
      var cartKey = prod.id + '|' + sizeStr + '||';
      var existing = sfCart.find(function(i) { return i._key === cartKey; });
      if (existing) {
        existing.qty += qty;
      } else {
        sfCart.push({
          _key: cartKey, id: prod.id, name: prod.name,
          size: sizeStr, price: price, qty: qty,
          emoji: prod.emoji || '🧴', cat: prod.cat
        });
      }
      added++;
    });

    sfCloseReorder();

    if (added === 0) {
      sfShowToast('Products from your last order are no longer available. Browse below.');
      sfScroll('sf-products');
      return;
    }

    sfUpdateCartBtn();
    sfOpenCart();

    // Show success banner in cart, auto-hide after 8 s
    var banner = document.getElementById('sf-reorder-success');
    if (banner) {
      banner.style.display = 'block';
      setTimeout(function() { banner.style.display = 'none'; }, 8000);
    }

  } catch(e) {
    console.error('[reorder]', e);
    showErr('Something went wrong — please try again.');
  }
};

// ── Staff/Admin visibility — show buttons if ?staff=true in URL ───────────
if (window.location.search.includes('staff=true')) {
  ['sf-staff-btn','nav-admin','btn-admin-panel'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.setProperty('display', 'inline-flex', 'important');
  });
}

// ── ?bundle= — add product to cart and open cart ──────────────────────────
(function() {
  var bundleId = new URLSearchParams(window.location.search).get('bundle');
  if (!bundleId) return;
  var attempts = 0;
  function tryAddBundle() {
    var prod = (window.PRODUCTS || []).find(function(p) { return p.id === bundleId; });
    if (!prod && attempts++ < 20) { setTimeout(tryAddBundle, 250); return; }
    if (!prod) return;
    var k = Object.keys(prod.pricing || {})[0];
    if (!k) return;
    var price = (prod.pricing[k] && prod.pricing[k].price) || 0;
    var sizeLabel = typeof sfSizeLabel === 'function' ? sfSizeLabel(k) : k;
    var cartKey = prod.id + '|' + sizeLabel + '||';
    var ex = sfCart.find(function(i) { return i._key === cartKey; });
    if (ex) { ex.qty += 1; } else {
      sfCart.push({ _key: cartKey, id: prod.id, name: prod.name, size: sizeLabel, price: price, qty: 1, emoji: prod.emoji || '🧴', cat: prod.cat });
    }
    sfUpdateCartBtn();
    sfOpenCart();
    history.replaceState(null, '', window.location.pathname);
  }
  setTimeout(tryAddBundle, 300);
})();
