// ════════════════════════════════════════════════════
// NAJAH CHEMIST — Single clean script. No duplicates.
// Firebase: najah-chemist-staging project (STAGING BRANCH)
// Admin email: start@najahchemistja.com
// ════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, query, orderBy, onSnapshot, where, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCHSSW0hZldMIjhCTdSN27wgxxtcCMXlSE",
  authDomain: "najah-chemist-staging.firebaseapp.com",
  projectId: "najah-chemist-staging",
  storageBucket: "najah-chemist-staging.firebasestorage.app",
  messagingSenderId: "165284411356",
  appId: "1:165284411356:web:7f9e654b4c24ebf64b0119"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
window._db = db;
window._app = app;
const auth = getAuth(app);

// ═══ DATA ═══
window.PRODUCTS = window.PRODUCTS || [];

let REVIEWS = {
  'tk':[{name:'Yanique T.',stars:5,text:'This soap changed my skin completely! Dark spots are fading fast.',date:'Feb 20'}],
  'ds':[{name:'Latoya R.',stars:5,text:'I ordered the litre and it lasted months. Amazing results.',date:'Feb 18'}],
  'pg':[{name:'Shanice M.',stars:4,text:'Love the probiotic wash. No irritation at all.',date:'Jan 30'}]
};
window.REVIEWS = REVIEWS;

let DB_ORDERS = [];

let DB_MESSAGES = [];

const IMG_CLASS = {soap:'img-soap',cream:'img-cream',serum:'img-serum',wash:'img-wash',hair:'img-cream',label:'img-label'};

// ═══ UI SWITCHING ═══
function showDashboard() {
  document.getElementById('storefront').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  updateProductStat();
  updateBadges();
}
function showStorefront() {
  document.getElementById('storefront').style.display = '';
  document.getElementById('app').style.display = 'none';
}

// Flag: set to true before login so onAuthStateChanged knows to navigate to admin
let pendingAdminNav = false;
let _ordersUnsub = null; // real-time orders listener unsubscribe handle
let _lastOrdersSig = '';

// ═══ AUTH STATE — this is the single source of truth ═══
onAuthStateChanged(auth, async (user) => {
  const btn = document.getElementById('nav-admin');
  if (user) {
    btn.textContent = '✓ Admin';
    btn.classList.add('on');
    document.getElementById('admin-user-label').textContent = `Signed in as ${user.email}`;
    renderAdminProducts();
    renderAdminReviews();

    // ── Real-time orders listener (set up once per login) ──────────────
    if (!_ordersUnsub) {
      _ordersUnsub = onSnapshot(
        query(collection(db,'orders'), orderBy('createdAt','desc')),
        (snap) => {
          const _sig = snap.docs.map(d => d.id+'|'+(d.data().status||'')+'|'+(d.data().paymentStatus||'')).join(',');
          const _changed = _sig !== _lastOrdersSig;
          _lastOrdersSig = _sig;
          const dbO = snap.docs.map(d => ({...d.data(), dbId: d.id}));
          // Replace DB_ORDERS with Firestore data, keep local-only rows at the end
          DB_ORDERS = [...dbO, ...DB_ORDERS.filter(o => !dbO.find(d => d.id === o.id))];
          window.ordersMap = {}; DB_ORDERS.forEach(o => { window.ordersMap[o.id||''] = o; });
          console.log(`[Najah] Orders snapshot: ${dbO.length} orders`);
          if (_changed) { renderOrdersTable(); }
          updateBadges();
        },
        (err) => { console.log('[Najah] Orders listener error:', err.message); }
      );
    }

    // ── Load messages (one-time, requires auth) ────────────────────────
    try {
      const msgSnap = await getDocs(query(collection(db,'messages'), orderBy('createdAt','desc')));
      if (!msgSnap.empty) {
        const dbM = msgSnap.docs.map(d => ({...d.data(), dbId: d.id}));
        DB_MESSAGES = [...dbM, ...DB_MESSAGES.filter(m => !dbM.find(d => d.from === m.from))];
        renderInbox();
      }
    } catch(e) {}

    // Navigate to admin if user explicitly triggered a login
    if (pendingAdminNav) {
      pendingAdminNav = false;
      showDashboard();
      document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
      document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
      document.getElementById('v-admin').classList.add('on');
      document.getElementById('nav-admin').classList.add('on');
    }
  } else {
    // Logged out — tear down listener and show storefront
    if (_ordersUnsub) { _ordersUnsub(); _ordersUnsub = null; }
    showStorefront();
    btn.innerHTML = '⚙ Admin';
    btn.classList.remove('on');
  }
});

// ═══ STAFF LOGIN (modal on storefront) ═══
window.closeStaffModal = function() {
  document.getElementById('m-staff-login').classList.remove('open');
};

window.staffLogin = async function() {
  const email = document.getElementById('staff-email').value.trim();
  const pass  = document.getElementById('staff-pass').value;
  const errEl = document.getElementById('staff-err');
  const btn   = document.getElementById('staff-btn');

  if (!email || !pass) {
    errEl.textContent = 'Please enter your email and password.';
    errEl.style.display = 'block';
    return;
  }

  btn.textContent = 'Signing in…';
  btn.disabled = true;
  errEl.style.display = 'none';
  pendingAdminNav = true;

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    closeStaffModal();
    // Navigate to admin (onAuthStateChanged handles it via pendingAdminNav,
    // but also do it here as a belt-and-suspenders fallback)
    pendingAdminNav = false;
    showDashboard();
    document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
    document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
    document.getElementById('v-admin').classList.add('on');
    document.getElementById('nav-admin').classList.add('on');
    renderAdminProducts(); renderAdminReviews();
  } catch (e) {
    pendingAdminNav = false;
    btn.textContent = 'Sign In';
    btn.disabled = false;
    errEl.textContent = '❌ Login failed: ' + (e.code || e.message);
    errEl.style.display = 'block';
  }
};

// ═══ LOGIN / LOGOUT ═══
window.openAdminLogin = function() {
  // If already logged in, go straight to admin
  if (auth.currentUser) {
    showDashboard();
    document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
    document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
    document.getElementById('v-admin').classList.add('on');
    document.getElementById('nav-admin').classList.add('on');
    renderAdminProducts(); renderAdminReviews();
    return;
  }
  // Not logged in — show login modal
  document.getElementById('adm-email').value = '';
  document.getElementById('adm-pass').value = '';
  document.getElementById('adm-err').style.display = 'none';
  document.getElementById('adm-btn').textContent = 'Sign In to Admin';
  document.getElementById('adm-btn').disabled = false;
  openM('m-admin-login');
  setTimeout(() => document.getElementById('adm-email').focus(), 150);
};

window.doLogin = async function() {
  const email = document.getElementById('adm-email').value.trim();
  const pass  = document.getElementById('adm-pass').value;
  const errEl = document.getElementById('adm-err');
  const btn   = document.getElementById('adm-btn');

  if (!email || !pass) {
    errEl.textContent = 'Please enter your email and password.';
    errEl.style.display = 'block';
    return;
  }

  btn.textContent = 'Signing in…';
  btn.disabled = true;
  errEl.style.display = 'none';
  pendingAdminNav = true;

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    closeM('m-admin-login');
    pendingAdminNav = false;
    showDashboard();
    document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
    document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
    document.getElementById('v-admin').classList.add('on');
    document.getElementById('nav-admin').classList.add('on');
    renderAdminProducts(); renderAdminReviews();
  } catch (e) {
    pendingAdminNav = false;
    btn.textContent = 'Sign In to Admin';
    btn.disabled = false;
    errEl.textContent = '❌ Login failed: ' + (e.code || e.message) + ' — check email/password';
    errEl.style.display = 'block';
    console.error('Login error:', e.code, e.message);
  }
};

window.doSignOut = async function() {
  await signOut(auth);
  showStorefront();
  showToast('Signed out');
};

// ═══ NAV ═══
window.goView = function(id, btn) {
  // Block admin view if not logged in
  if (id === 'admin' && !auth.currentUser) {
    openAdminLogin();
    return;
  }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
  document.getElementById('v-' + id).classList.add('on');
  if (btn) btn.classList.add('on');
  if (id === 'admin') { renderAdminProducts(); renderAdminReviews(); }
  if (id === 'orders') renderOrdersTable();
  if (id === 'inbox') renderInbox();
};

window.stab = function(group, tab, btn) {
  const v = document.getElementById('v-' + group);
  v.querySelectorAll('.tc').forEach(c => c.classList.remove('on'));
  v.querySelectorAll('.tab').forEach(b => b.classList.remove('on'));
  document.getElementById('tc-' + group + '-' + tab).classList.add('on');
  if (btn) btn.classList.add('on');
};

window.openM = function(id) { document.getElementById(id).classList.add('open'); };
window.closeM = function(id) { document.getElementById(id).classList.remove('open'); };

// ═══ FIREBASE DB ═══
async function saveOrderToDB(order) {
  try { await addDoc(collection(db,'orders'),{...order,createdAt:serverTimestamp()}); showToast('Order saved ✓'); }
  catch(e){ console.error(e); }
}
async function saveMessageToDB(msg) {
  try { await addDoc(collection(db,'messages'),{...msg,createdAt:serverTimestamp()}); }
  catch(e){ console.error(e); }
}
async function saveReviewToDB(review) {
  try { await addDoc(collection(db,'reviews'),{...review,createdAt:serverTimestamp()}); }
  catch(e){ console.error(e); }
}
window.saveReviewToDB = saveReviewToDB;

async function loadFromDB() {
  // ── 1. Products — real-time listener keeps prices in sync with admin ──────
  // Using onSnapshot instead of getDocs so any price saved in admin.html
  // immediately re-renders the storefront without requiring a page reload.
  try {
    await new Promise(function(resolve) {
      var settled = false;
      onSnapshot(collection(db,'products'), function(snap) {
        const dbProds = snap.docs.map(function(d){ return {...d.data()}; });
        PRODUCTS.length = 0;
        dbProds.forEach(function(dbP){ PRODUCTS.push(dbP); });
        console.log('[Najah] Products synced: ' + PRODUCTS.length);
        updateProductStat();
        renderShop();
        renderAdminProducts();
        if(typeof sfRenderProducts==='function'){
          var _pendingCat = new URLSearchParams(window.location.search).get('cat');
          sfRenderProducts(_pendingCat || 'all');
          if(typeof sfRenderHeroCards==='function') sfRenderHeroCards();
          if(typeof sfRenderStarterKit==='function') sfRenderStarterKit();
          if(typeof renderBestSellers==='function') renderBestSellers();
        }
        if(!settled){
          var _openPid = new URLSearchParams(window.location.search).get('openProduct');
          if(_openPid && typeof window.sfOpenProduct==='function') window.sfOpenProduct(_openPid);
          settled=true; resolve();
        }
      }, function(e){
        console.log('[Najah] Products listener error:', e.message);
        if(!settled){ settled=true; resolve(); }
      });
    });
  } catch(e) { console.log('[Najah] Products load failed:', e.message); }

  // ── 2. Reviews (public read) ───────────────────────────────────────────
  try {
    const revSnap = await getDocs(collection(db,'reviews'));
    revSnap.docs.forEach(d=>{
      const r=d.data();
      if(!REVIEWS[r.productId]) REVIEWS[r.productId]=[];
      if(!REVIEWS[r.productId].find(x=>x.name===r.name&&x.text===r.text))
        REVIEWS[r.productId].unshift({name:r.name,stars:r.stars,text:r.text,date:r.date});
    });
  } catch(e) {}

  // ── 3. Settings + Best Sellers (public read) ──────────────────────────
  try {
    const kbDoc = await getDocs(collection(db,'settings'));
    kbDoc.docs.forEach(d => {
      if(d.id==='chatbot_knowledge' && d.data().content)
        window._extraChatbotKnowledge = d.data().content;
      if(d.id==='site_settings' && d.data().waNumber)
        window.WA_NUMBER = d.data().waNumber;
      if(d.id==='bestSellers'){
        const bsData=d.data();
        const bsIds=bsData.productIds||bsData.ids;
        if(Array.isArray(bsIds)) window._bestSellerIds = bsIds;
      }
    });
  } catch(e) {}

  // Orders and messages are loaded in onAuthStateChanged via onSnapshot
  // (they require auth and must wait for Firebase to restore the session)

  // ── 4. Render storefront ───────────────────────────────────────────────
  if (typeof sfRenderProducts === 'function') {
    sfRenderProducts('all');
    var _cat = new URLSearchParams(window.location.search).get('category');
    var _catMap = {
      'skincare': 'skincare',
      'feminine-care': 'yoni',
      'mens-care': 'mencare',
      'hair-care': 'haircare',
      'soaps': 'soap',
      'containers': 'containers'
    };
    if (_cat && _catMap[_cat] && typeof sfFilter === 'function') {
      setTimeout(function() {
        sfFilter(_catMap[_cat], null);
        setTimeout(function() {
          var el = document.querySelector('.sf-products-section') || document.getElementById('sf-products-grid') || document.getElementById('products');
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 300);
      }, 800);
    }
    if (typeof sfRenderHeroCards === 'function') sfRenderHeroCards();
    if (typeof sfRenderStarterKit === 'function') sfRenderStarterKit();
    sfRenderReviews();
  }
  renderBestSellers();
  renderAdminBestSellers();
  rebuildOrderProductSelect();
}

// saveOrderSilent and linkOrderToClient moved to the regular script below
// (module-scope static imports caused them to silently disappear if the module
//  had any load/init error — regular script + dynamic import is more reliable)

// ═══ BEST SELLERS ═══
const BS_IMG_CLASS={soap:'img-soap',yoni:'img-wash',skincare:'img-cream',mencare:'img-soap',haircare:'img-cream',bundle:'img-label',label:'img-label',cream:'img-cream',serum:'img-serum',wash:'img-wash',hair:'img-cream'};
function renderBestSellers(){
  const ids = window._bestSellerIds||[];
  const section = document.getElementById('sf-bestsellers-section');
  const grid = document.getElementById('sf-bs-grid');
  if(!section||!grid) return;
  const prods = ids.map(id=>PRODUCTS.find(p=>p.id===id)).filter(Boolean).slice(0,3);
  if(!prods.length){ section.style.display='none'; return; }
  section.style.display='block';
  grid.innerHTML = prods.map(p=>{
    const _so={halfLb:0,lb1:1,lb2:2,lb8:3,lb40:4,bar:0,bars10:0,bars100:1,litre:0,gallon:1,'5gal':2,caps100:0,caps1000:1,unit:0,kit:0,design:0};
    const firstKey=Object.keys(p.pricing).sort((a,b)=>((_so[a]??99)-(_so[b]??99)))[0];
    const price='J$'+p.pricing[firstKey].price.toLocaleString();
    const imgCls=BS_IMG_CLASS[p.cat]||'img-cream';
    const img=p.img?`<img src="${p.img}" style="width:100%;height:100%;object-fit:cover;">`:`<span style="font-size:3.5rem;">${p.emoji||'🧴'}</span>`;
    return `<div class="sf-bs-card" onclick="sfOpenProduct('${p.id}')">
      <div class="sf-bs-img ${imgCls}">${img}${p.tag?`<span class="pc-tag">${p.tag}</span>`:''}</div>
      <div class="sf-bs-body">
        <div class="sf-bs-name">${p.name}</div>
        <div class="sf-bs-tl">${p.tagline}</div>
        <div class="sf-bs-price">From ${price}</div>
        <button class="sf-bs-btn" onclick="event.stopPropagation();sfOpenProduct('${p.id}')">View Product</button>
      </div>
    </div>`;
  }).join('');
}
window.renderBestSellers = renderBestSellers;

function renderAdminBestSellers(){
  const container=document.getElementById('bs-manager-list'); if(!container) return;
  const ids=window._bestSellerIds||[];
  if(!PRODUCTS.length){ container.innerHTML='<div style="font-size:0.82rem;color:var(--mid);">No products loaded yet.</div>'; return; }
  container.innerHTML=PRODUCTS.map(p=>{
    const checked=ids.includes(p.id)?'checked':'';
    return `<label style="display:flex;align-items:center;gap:0.6rem;font-size:0.82rem;padding:0.3rem 0;cursor:pointer;">
      <input type="checkbox" class="bs-check" value="${p.id}" ${checked} style="width:15px;height:15px;accent-color:#0F0E0D;">
      <span>${p.name}</span>
    </label>`;
  }).join('');
}
window.renderAdminBestSellers = renderAdminBestSellers;

function rebuildOrderProductSelect(){
  const sel=document.getElementById('no-p'); if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">— Select Product —</option>'+PRODUCTS.map(p=>{
    const isSoap=p.cat==='soap';
    const isByWeight=Object.keys(p.pricing||{}).some(k=>k.startsWith('lb')||k==='halfLb'||k==='lb1');
    const sizes=isSoap?'none':isByWeight?'weight':'liquid';
    return `<option value="${p.id}" data-sizes="${sizes}">${p.sku?'['+p.sku+'] ':''}${p.name}</option>`;
  }).join('');
  if(cur) sel.value=cur;
}
window.rebuildOrderProductSelect=rebuildOrderProductSelect;

window.saveBestSellers = async function(){
  const checks=document.querySelectorAll('.bs-check:checked');
  if(checks.length!==3){ showToast('Select exactly 3 products'); return; }
  const ids=Array.from(checks).map(c=>c.value);
  window._bestSellerIds=ids;
  try {
    await setDoc(doc(db,'settings','bestSellers'),{productIds:ids,ids});
    renderBestSellers();
    showToast('Best Sellers saved ✓');
  } catch(e){ showToast('Save failed: '+(e.message||'error')); }
};

// ═══ TOAST ═══
function showToast(msg){
  let t=document.getElementById('toast');
  if(!t){t=document.createElement('div');t.id='toast';t.style.cssText='position:fixed;bottom:1.5rem;right:1.5rem;background:#0F0E0D;color:white;padding:0.7rem 1.2rem;border-radius:8px;font-size:0.82rem;font-family:Outfit,sans-serif;z-index:9999;opacity:0;transition:opacity 0.3s;';document.body.appendChild(t);}
  t.textContent=msg;t.style.opacity='1';setTimeout(()=>t.style.opacity='0',2800);
}

// ═══ SIZE HELPERS ═══
function sizeLabel(k){const labels={litre:'1 Litre',gallon:'1 Gallon','5gal':'5 Gallon',lb2:'2 lbs',lb8:'8 lbs',lb40:'40 lbs',bars10:'10 Bars',bars100:'100 Bars',caps100:'100 Caps',caps1000:'1000 Caps',halfLb:'½ lb',lb1:'1 lb',kit:'Per Unit',unit:'Per Unit',design:'Per Design',bar:'Per Bar'};return labels[k]||k.charAt(0).toUpperCase()+k.slice(1);}
function getDisplayPrice(p){
  const keys=Object.keys(p.pricing);
  if(!keys.length) return {price:'Contact us',moq:''};
  const SO={halfLb:0,lb1:1,lb2:2,lb8:3,lb40:4,bar:0,bars10:0,bars100:1,litre:0,gallon:1,'5gal':2,caps100:0,caps1000:1,unit:0,kit:0,design:0};
  const f=keys.sort((a,b)=>((SO[a]??99)-(SO[b]??99)))[0];
  return {price:'From J$'+p.pricing[f].price.toLocaleString(),moq:sizeLabel(f)};
}

// ═══ PRODUCT STAT ═══
function updateProductStat(){
  const total = PRODUCTS.length;
  const visible = PRODUCTS.filter(p=>!p.hidden).length;
  const el = document.getElementById('stat-prods');
  const sub = document.getElementById('stat-prods-sub');
  if(el) el.textContent = total + ' total';
  if(sub) sub.textContent = total > 0 ? `${visible} visible · ${total-visible} hidden` : 'In catalogue';
  const aboutCount = document.getElementById('sf-about-prod-count');
  if(aboutCount && total > 0) aboutCount.textContent = total + '+';
}
window.updateProductStat = updateProductStat;

// ═══ SHOP ═══
function renderShop(){
  const g=document.getElementById('shop-grid'); if(!g) return;
  if(typeof renderAdminBestSellers==='function') renderAdminBestSellers();
  g.innerHTML=PRODUCTS.map(p=>{
    const {price,moq}=getDisplayPrice(p);
    const img=p.img?`<img src="${p.img}" style="width:100%;height:100%;object-fit:cover;">`:`<span class="emoji-fb">${p.emoji}</span>`;
    return `<div class="pc" onclick="openProduct('${p.id}')">
      <div class="pc-img ${IMG_CLASS[p.cat]}">${img}${p.tag?`<span class="pc-tag">${p.tag}</span>`:''}
      </div>
      <div class="pc-body">
        <div class="pc-name">${p.name}</div>
        <div class="pc-tl">${p.tagline}</div>
        <div class="pc-row"><div><div class="pc-price">${price}</div><div class="pc-moq">Min ${moq}</div></div>
        <button class="btn btn-dk btn-sm" onclick="event.stopPropagation();openProduct('${p.id}')">Details</button></div>
      </div></div>`;
  }).join('');
  updateProductStat();
}

// ═══ PRODUCT DETAIL ═══
window.openProduct = function(id){
  const p=PRODUCTS.find(x=>x.id===id); if(!p) return;
  document.getElementById('pd-name').textContent=p.name;
  document.getElementById('pd-tl').textContent=p.tagline;
  document.getElementById('pd-ing').textContent=p.ingredients;
  document.getElementById('pd-ben').innerHTML=(Array.isArray(p.benefits)?p.benefits:[p.benefits]).map(b=>`<span class="benefit-tag">${b}</span>`).join('');
  document.getElementById('pd-use').textContent=p.usage;
  const imgEl=document.getElementById('pd-img');
  imgEl.className=IMG_CLASS[p.cat];
  imgEl.style.cssText='height:210px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:4rem;overflow:hidden;';
  imgEl.innerHTML=p.img?`<img src="${p.img}" style="width:100%;height:100%;object-fit:cover;">`:p.emoji;
  const sw=document.getElementById('pd-sizes-wrap');
  if(p.cat==='soap'){
    sw.style.display='none';
    const bk=Object.keys(p.pricing).find(k=>k.startsWith('bars')||k==='bar')||Object.keys(p.pricing)[0];
    const sp=p.pricing[bk]||{price:0,moq:1};
    document.getElementById('pd-price').textContent='J$'+sp.price.toLocaleString()+'/bar';
    document.getElementById('pd-moq').textContent='Min '+sp.moq+' bars';
  } else {
    sw.style.display='block';
    const keys=Object.keys(p.pricing);
    const isUnit=keys.some(k=>k==='kit'||k==='unit'||k==='design');
    document.getElementById('pd-size-btns').innerHTML=keys.map((k,i)=>{
      const lbl=isUnit&&p.unitDesc?p.unitDesc:(p.pricing[k]?.desc||sizeLabel(k));
      return `<button class="size-btn${i===0?' on':''}" onclick="selectSize('${p.id}','${k}',this)">${lbl}</button>`;
    }).join('');
    document.getElementById('pd-price').textContent='J$'+p.pricing[keys[0]].price.toLocaleString();
    document.getElementById('pd-moq').textContent=(isUnit&&p.unitDesc)?'Min '+p.pricing[keys[0]].moq+' × '+p.unitDesc:'MOQ '+p.pricing[keys[0]].moq+' units';
  }
  currentReviewProduct=id;
  renderProdReviews(id);
  document.getElementById('review-form-area').style.display='none';
  openM('m-product');
};

window.selectSize = function(prodId,sizeKey,btn){
  document.querySelectorAll('.size-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  const p=PRODUCTS.find(x=>x.id===prodId);
  if(!p||!p.pricing[sizeKey]) return;
  const isUnit=['kit','unit','design'].includes(sizeKey);
  document.getElementById('pd-price').textContent='J$'+p.pricing[sizeKey].price.toLocaleString();
  document.getElementById('pd-moq').textContent=(isUnit&&p.unitDesc)?'Min '+p.pricing[sizeKey].moq+' × '+p.unitDesc:'MOQ '+p.pricing[sizeKey].moq+' units';
};

// ═══ REVIEWS ═══
let currentReviewProduct=null, selectedStars=0;

function renderProdReviews(id){
  const revs=REVIEWS[id]||[];
  const el=document.getElementById('pd-reviews'); if(!el) return;
  el.innerHTML=revs.length===0?'<p style="font-size:0.82rem;color:var(--mid);">No reviews yet. Be the first!</p>':
    revs.map(r=>`<div class="review-card"><div style="display:flex;justify-content:space-between;align-items:center;"><div class="review-name">${r.name}</div><div>${'⭐'.repeat(r.stars)}</div></div><div class="review-text">${r.text}</div><div class="review-meta">${r.date}</div></div>`).join('');
}

window.openReviewForm = ()=>{ document.getElementById('review-form-area').style.display='block'; };

window.setStars = function(n){
  selectedStars=n;
  document.querySelectorAll('#star-picker .star').forEach((s,i)=>s.textContent=i<n?'⭐':'☆');
};

window.submitReview = async function(){
  const name=document.getElementById('rv-name').value.trim();
  const text=document.getElementById('rv-text').value.trim();
  if(!name||!text||!selectedStars){alert('Please fill in your name, rating, and review.');return;}
  const review={name,stars:selectedStars,text,productId:currentReviewProduct,date:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'})};
  if(!REVIEWS[currentReviewProduct]) REVIEWS[currentReviewProduct]=[];
  REVIEWS[currentReviewProduct].unshift(review);
  await saveReviewToDB(review);
  document.getElementById('rv-name').value='';
  document.getElementById('rv-text').value='';
  setStars(0);
  document.getElementById('review-form-area').style.display='none';
  renderProdReviews(currentReviewProduct);
  renderAdminReviews();
  updateStatRevs();
  showToast('Review submitted ✓');
};

// ═══ ORDERS ═══
let _ordersDateFilter = '';
function renderOrdersTable(){
  const tb=document.getElementById('orders-body'); if(!tb) return;
  const payStatuses=['Unpaid','Awaiting Payment','Paid','Refunded'];
  const payCls={Unpaid:'b-unp','Awaiting Payment':'b-await',Paid:'b-paid',Refunded:'b-refund'};
  let _filteredOrders = DB_ORDERS;
  if(_ordersDateFilter){
    _filteredOrders = DB_ORDERS.filter(o=>{
      const raw = o.date||o.createdAt;
      if(!raw) return false;
      let d;
      if(raw.seconds) d = new Date(raw.seconds*1000);
      else if(raw.toDate) d = raw.toDate();
      else d = new Date(raw);
      if(isNaN(d.getTime())) return false;
      return d.toISOString().slice(0,10) === _ordersDateFilter;
    });
  }
  tb.innerHTML=_filteredOrders.map(o=>{
    const ps=o.paymentStatus||'Unpaid';
    return `<tr>
    <td style="padding:0.65rem 0.5rem;"><input type="checkbox" class="order-cb" data-id="${o.id}" onchange="updateOrderSelection()" style="cursor:pointer;width:14px;height:14px;"></td>
    <td><strong>${o.id}</strong>${o.labelPrinted?'<span title="Label printed" style="color:#16a34a;margin-left:4px;font-size:0.65rem;">🏷✓</span>':''}${o.receiptPrinted?'<span title="Receipt printed" style="color:#16a34a;margin-left:2px;font-size:0.65rem;">🧾✓</span>':''}</td><td>${o.client}</td><td style="max-width:180px;word-break:break-word;">${(o.product||'').substring(0,60)}${(o.product||'').length>60?'…':''}</td><td>${o.size||'—'}</td><td>${o.qty}</td><td>${o.source||'—'}</td>
    <td><select onchange="updatePaymentStatus('${o.id}',this.value)" style="border:1px solid var(--border);padding:0.2rem 0.4rem;font-size:0.72rem;font-family:Outfit,sans-serif;border-radius:4px;">${payStatuses.map(s=>`<option${s===ps?' selected':''}>${s}</option>`).join('')}</select></td>
    <td><select onchange="updateOrderStatus('${o.id}',this.value)" style="border:1px solid var(--border);padding:0.2rem 0.4rem;font-size:0.72rem;font-family:Outfit,sans-serif;border-radius:4px;">${['Pending','Processing','Shipped','Complete','Cancelled'].map(s=>`<option${s===o.status?' selected':''}>${s}</option>`).join('')}</select></td>
    <td>${o.date}</td>
    <td><span style="font-size:0.72rem;color:${o.tracking?'#16a34a':'#9CA3AF'};">${o.tracking?'📦 '+o.tracking.courier:'—'}</span></td>
    <td style="white-space:nowrap;">
      <button class="btn-gh btn-xs" onclick="showReceipt('${o.id}','${o.client}','${o.product}',${o.qty},${o.total||0},'${o.payMethod||o.payment}','${o.date}')">View</button>
      <button class="btn btn-pr btn-xs" onclick="printReceipt(window.ordersMap['${o.id}'])">🖨</button>
      <button class="btn btn-xs" style="background:#1D4ED8;color:white;border:none;" onclick="printLabel(window.ordersMap['${o.id}'])">🏷</button>
      <button class="btn btn-ol btn-xs" onclick="sendOrderReceipt('${o.id}')">📧</button>
      <button class="btn btn-xs" style="background:#166534;color:white;border:none;" onclick="openTrackingModal(window.ordersMap['${o.id}'])">🚚</button>
      <button class="btn btn-xs" style="background:#B45309;color:white;border:none;" onclick="openEditOrder(window.ordersMap['${o.id}'])">✏️</button>
    </td></tr>`;
  }).join('');
  // Dash recent orders
  const dt=document.getElementById('dash-orders-body'); if(dt)
    dt.innerHTML=DB_ORDERS.slice(0,4).map(o=>`<tr><td>${o.client}</td><td>${o.product}</td><td><span class="bge b-${o.status==='Shipped'?'ship':o.status==='Processing'?'proc':o.status==='Complete'?'done':'pend'}">${o.status}</span></td><td><span class="bge ${(o.paymentStatus||o.payment)==='Paid'?'b-paid':'b-unp'}">${o.paymentStatus||o.payment}</span></td><td><button class="btn-gh btn-xs" onclick="showReceipt('${o.id}','${o.client}','${o.product}',${o.qty},${o.total||0},'${o.payMethod||o.payment}','${o.date}')">View</button></td></tr>`).join('');
}

window.updateOrderStatus = async function(orderId,newStatus){
  const idx=DB_ORDERS.findIndex(o=>o.id===orderId);
  if(idx>-1) DB_ORDERS[idx].status=newStatus;
  showToast(`${orderId} → ${newStatus}`);
  try{
    const snap=await getDocs(collection(db,'orders'));
    snap.docs.forEach(async d=>{if(d.data().id===orderId) await updateDoc(doc(db,'orders',d.id),{status:newStatus});});
  }catch(e){}
};

window.updatePaymentStatus = async function(orderId,newStatus){
  const idx=DB_ORDERS.findIndex(o=>o.id===orderId);
  if(idx>-1) DB_ORDERS[idx].paymentStatus=newStatus;
  showToast(`${orderId} payment → ${newStatus}`);
  try{
    const snap=await getDocs(collection(db,'orders'));
    snap.docs.forEach(async d=>{if(d.data().id===orderId) await updateDoc(doc(db,'orders',d.id),{paymentStatus:newStatus});});
  }catch(e){}
};

window.sendOrderReceipt = async function(id) {
  const order = DB_ORDERS.find(o=>o.id===id) || {id};
  const client = order.client || order.customerName || '—';
  const product = order.product || order.products || '—';
  const qty = order.qty || 1;
  const total = parseFloat(order.total||0);
  const payMethod = order.payMethod || order.payment || '—';
  const date = order.date || '';
  const defaultEmail = order.email || order.customerEmail || '';
  const email = prompt('Send receipt to email address:', defaultEmail);
  if (!email || !email.includes('@')) { if (email !== null) showToast('Invalid email'); return; }
  try {
    showToast('Sending receipt…');
    const res = await fetch('/.netlify/functions/send-receipt', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        orderId: id,
        customerName: client,
        email,
        items: Array.isArray(order.items)&&order.items.length ? order.items : [{name: product, size: '—', qty, price: total}],
        subtotal: total - parseFloat(order.deliveryFee||0),
        deliveryFee: parseFloat(order.deliveryFee||0),
        total,
        shipDetail: payMethod
      })
    });
    if (res.ok) { showToast('Receipt sent to ' + email); }
    else { const err = await res.text(); showToast('Send failed: ' + err); }
  } catch(e) { showToast('Send failed: ' + (e.message||'Network error')); }
};

window.openTrackingModal = function(orderOrId) {
  const o = (typeof orderOrId==='object'&&orderOrId!==null) ? orderOrId : (DB_ORDERS.find(x=>x.id===orderOrId)||{id:orderOrId});
  const orderId = o.id||orderOrId;
  document.getElementById('trk-order-id').value = orderId;
  document.getElementById('trk-courier').value = o.tracking?.courier||'Knutsford Express';
  document.getElementById('trk-num').value = o.tracking?.trackingNumber||'';
  document.getElementById('trk-date').value = o.tracking?.estimatedDelivery||'';
  document.getElementById('trk-notes').value = o.tracking?.notes||'';
  openM('m-tracking');
};

window.saveTracking = async function() {
  const orderId = document.getElementById('trk-order-id').value;
  const courier = document.getElementById('trk-courier').value;
  const trackingNumber = document.getElementById('trk-num').value.trim();
  const estimatedDelivery = document.getElementById('trk-date').value;
  const notes = document.getElementById('trk-notes').value.trim();
  if (!orderId) return;
  const order = DB_ORDERS.find(o=>o.id===orderId) || {id:orderId};
  const client = order.client || order.customerName || 'Customer';
  const waRaw = order.phone || order.wa || order.customerWhatsApp || '';
  const waNum = waRaw.replace(/\D/g,'');
  const tracking = { courier, trackingNumber: trackingNumber||'N/A', estimatedDelivery, notes, addedAt: new Date().toISOString() };
  // Save to Firestore
  try {
    const snap = await getDocs(collection(db,'orders'));
    snap.docs.forEach(async d => { if((d.data().id||d.data().orderId)===orderId) await updateDoc(doc(db,'orders',d.id),{tracking, status:'Shipped'}); });
    const idx = DB_ORDERS.findIndex(o=>o.id===orderId);
    if(idx>-1){ DB_ORDERS[idx].tracking=tracking; DB_ORDERS[idx].status='Shipped'; }
    if(window.ordersMap&&window.ordersMap[orderId]){ window.ordersMap[orderId].tracking=tracking; window.ordersMap[orderId].status='Shipped'; }
  } catch(e) { console.error('Tracking save error:',e); }
  renderOrdersTable();
  closeM('m-tracking');
  showToast('Tracking saved and client notified on WhatsApp ✓');
  // Send WhatsApp message to client
  if (waNum) {
    let msg;
    if (/zipmail/i.test(courier)) {
      msg = 'Good day, your package 📦 was shipped 🚢 track your package here https://jamaicapost.gov.jm/track-and-trace/';
    } else if (/knutsford/i.test(courier)) {
      msg = 'Good day, your package 📦 was shipped 🚢 track your package here https://www.knutsfordexpress.com/courier/track-your-packages/';
    } else {
      msg = `Good day, your package 📦 was shipped 🚢 Courier: ${courier}${trackingNumber&&trackingNumber!=='N/A'?' · Tracking #: '+trackingNumber:''}`;
    }
    window.open('https://wa.me/'+waNum+'?text='+encodeURIComponent(msg),'_blank');
  }
};

window.createOrder = async function(){
  const n=document.getElementById('no-c').value.trim();
  if(!n){alert('Please enter a client name');return;}
  const p=document.getElementById('no-p').value;
  const q=parseInt(document.getElementById('no-q').value)||1;
  const sz=document.getElementById('size-fg').style.display!=='none'?document.getElementById('no-sz').value:'—';
  const pay=document.getElementById('no-pay').value;
  const nt=document.getElementById('no-nt').value;
  const src=document.getElementById('no-src').value;
  const editId=document.getElementById('edit-order-id').value;
  if(editId){
    const idx=DB_ORDERS.findIndex(o=>o.id===editId);
    const updated={...(DB_ORDERS[idx]||{}),client:n,product:p,size:sz,qty:q,source:src,payMethod:pay,notes:nt};
    if(idx>-1) DB_ORDERS[idx]=updated;
    if(window.ordersMap) window.ordersMap[editId]=updated;
    try{
      const snap=await getDocs(collection(db,'orders'));
      snap.docs.forEach(async d=>{if((d.data().id||d.data().orderId)===editId) await updateDoc(doc(db,'orders',d.id),{client:n,product:p,size:sz,qty:q,source:src,payMethod:pay,notes:nt});});
    }catch(e){console.error(e);}
    renderOrdersTable(); updateBadges();
    document.getElementById('edit-order-id').value='';
    document.getElementById('new-order-title').textContent='New Order';
    closeM('m-new-order'); return;
  }
  const order={id:'NC-'+Math.floor(Math.random()*9000+1000),client:n,product:p,size:sz,qty:q,
    source:src,payment:'Unpaid',status:'Pending',
    date:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'}),total:0,
    payMethod:pay,notes:nt};
  DB_ORDERS.unshift(order);
  if(window.ordersMap) window.ordersMap[order.id]=order;
  renderOrdersTable(); updateBadges();
  await saveOrderToDB(order);
  closeM('m-new-order');
};

window.openEditOrder = function(order){
  if(!order){ alert('Order not found'); return; }
  rebuildOrderProductSelect();
  document.getElementById('new-order-title').textContent='Edit Order — '+(order.id||'');
  document.getElementById('edit-order-id').value=order.id||'';
  document.getElementById('no-c').value=order.client||order.customerName||'';
  document.getElementById('no-e').value=order.email||'';
  const pSel=document.getElementById('no-p');
  const firstItem=Array.isArray(order.items)&&order.items[0];
  if(firstItem&&firstItem.productId) pSel.value=firstItem.productId;
  if(!pSel.value){
    const matchName=firstItem?firstItem.name:order.product;
    for(let opt of pSel.options){if(opt.value===(order.product||'')||opt.text.includes(matchName||'')){pSel.value=opt.value;break;}}
  }
  document.getElementById('no-q').value=(firstItem&&firstItem.qty)||order.qty||1;
  document.getElementById('no-pay').value=order.payMethod||'Bank Transfer';
  document.getElementById('no-nt').value=order.notes||'';
  updateSizeOpts();
  const sizeVal=(firstItem&&firstItem.size)||order.size;
  if(sizeVal&&sizeVal!=='—'){document.getElementById('no-sz').value=sizeVal;}
  openM('m-new-order');
};

window.createAndPrint = async function(){
  await createOrder();
  if(DB_ORDERS[0]) printR(DB_ORDERS[0].id,DB_ORDERS[0].client,DB_ORDERS[0].product,DB_ORDERS[0].qty,0,DB_ORDERS[0].payMethod,DB_ORDERS[0].date);
};

window.updateSizeOpts = function(){
  const sel=document.getElementById('no-p');
  const opt=sel.options[sel.selectedIndex];
  const sizes=opt?opt.dataset.sizes:'liquid';
  document.getElementById('size-fg').style.display=sizes==='none'?'none':'block';
};

// ═══ INBOX ═══
function renderInbox(){
  const tb=document.getElementById('inbox-body'); if(!tb) return;
  if(!DB_MESSAGES.length){ tb.innerHTML='<tr><td colspan="6" class="empty-state">No messages yet</td></tr>'; return; }
  tb.innerHTML=DB_MESSAGES.map(m=>`<tr><td><strong>${m.from}</strong></td><td>${m.subject}</td><td>${m.email}</td><td style="color:var(--mid);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m.preview}</td><td>${m.date}</td><td><span class="bge ${m.status==='New'?'b-new':'b-done'}">${m.status}</span></td></tr>`).join('');
}

function updateBadges(){
  const pending=DB_ORDERS.filter(o=>o.status==='Pending').length;
  const newMsgs=DB_MESSAGES.filter(m=>m.status==='New').length;
  const ob=document.getElementById('ob'); if(ob) ob.textContent=pending||'';
  const ib=document.getElementById('ib'); if(ib) ib.textContent=newMsgs||'';
  const sm=document.getElementById('stat-msgs'); if(sm) sm.textContent=newMsgs;
  const so=document.getElementById('stat-orders'); if(so) so.textContent=DB_ORDERS.filter(o=>o.status==='Pending'||o.status==='Processing').length;
}

function updateStatRevs(){
  const all=[]; PRODUCTS.forEach(p=>{(REVIEWS[p.id]||[]).forEach(r=>all.push(r));});
  const sr=document.getElementById('stat-revs'); if(sr) sr.textContent=all.length;
}

// ═══ ADMIN ═══
function renderAdminProducts(){
  const el=document.getElementById('admin-prod-list'); if(!el) return;
  el.innerHTML=PRODUCTS.map(p=>{
    const {price}=getDisplayPrice(p);
    const img=p.img?`<img src="${p.img}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`:p.emoji;
    return `<div class="admin-prod-row">
      <div class="admin-prod-img ${IMG_CLASS[p.cat]}">${img}</div>
      <div class="admin-prod-info"><div class="admin-prod-name">${p.name}</div><div class="admin-prod-meta">${price} · ${p.cat==='soap'?'By Bar':p.cat==='bundle'||p.cat==='label'?'Per Unit':Object.keys(p.pricing).some(k=>k.startsWith('lb'))?'By Weight':'By Volume'} · ${(REVIEWS[p.id]||[]).length} review(s)</div></div>
      <div class="admin-actions">
        <button class="btn btn-ol btn-xs" onclick="editProduct('${p.id}')">Edit</button>
        <button class="btn btn-xs" style="background:${p.hidden?'#6B7280':'#059669'};color:white;border:none;" onclick="toggleProductHidden('${p.id}')">${p.hidden?'Hidden':'Visible'}</button>
        <button class="btn btn-rd btn-xs" onclick="deleteProduct('${p.id}')">Delete</button>
      </div></div>`;
  }).join('');
}

function renderAdminReviews(){
  const all=[]; PRODUCTS.forEach(p=>{(REVIEWS[p.id]||[]).forEach(r=>all.push({...r,product:p.name}));});
  const el=document.getElementById('all-reviews-list'); if(!el) return;
  el.innerHTML=all.length===0?'<p style="font-size:0.82rem;color:var(--mid);">No reviews yet.</p>':
    all.map(r=>`<div class="review-card"><div style="display:flex;justify-content:space-between;"><div class="review-name">${r.name}</div><div>${'⭐'.repeat(r.stars)}</div></div><div style="font-size:0.7rem;color:var(--mid);font-weight:600;margin-top:0.15rem;">${r.product}</div><div class="review-text">${r.text}</div><div class="review-meta">${r.date}</div></div>`).join('');
  const avg=all.length?(all.reduce((s,r)=>s+r.stars,0)/all.length).toFixed(1):'—';
  const sumEl=document.getElementById('review-summary'); if(!sumEl) return;
  sumEl.innerHTML=`<div style="font-family:'Playfair Display',serif;font-size:2.5rem;font-weight:700;">${avg}<span style="font-size:0.9rem;color:var(--mid);"> / 5</span></div><div>Total: <strong>${all.length}</strong></div>`;
  updateStatRevs();
}

window.toggleProductHidden = async function(id) {
  const idx = PRODUCTS.findIndex(p => p.id === id);
  if (idx < 0) return;
  if (!auth.currentUser) { showToast('Session expired — please log in again'); return; }
  const newHidden = !PRODUCTS[idx].hidden;
  PRODUCTS[idx].hidden = newHidden;
  updateProductStat();
  renderAdminProducts();
  if (typeof sfRenderProducts === 'function') sfRenderProducts('all');
  try {
    await setDoc(doc(db,'products',id), {hidden: newHidden}, {merge: true});
    showToast(newHidden ? 'Product hidden from shop' : 'Product visible in shop');
  } catch(e) {
    PRODUCTS[idx].hidden = !newHidden;
    renderAdminProducts();
    if (typeof sfRenderProducts === 'function') sfRenderProducts('all');
    showToast('Save failed: ' + (e.code || e.message || 'Firebase error'));
  }
};

// ═══ SUBSCRIBERS ═══
window.renderAdminSubscribers = async function() {
  const tb = document.getElementById('subscribers-body');
  if (!tb) return;
  try {
    const snap = await getDocs(query(collection(db,'subscribers'), orderBy('subscribedAt','desc')));
    const docs = snap.docs.map(d => d.data());
    const countEl = document.getElementById('subscribers-count');
    if (countEl) countEl.textContent = docs.length + ' subscriber' + (docs.length !== 1 ? 's' : '');
    if (!docs.length) {
      tb.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--mid);padding:1.5rem;">No subscribers yet</td></tr>';
      return;
    }
    tb.innerHTML = docs.map(s => {
      const date = s.subscribedAt ? new Date(s.subscribedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
      return `<tr><td>${s.name||'—'}</td><td>${s.email||'—'}</td><td>${s.source||'—'}</td><td>${date}</td></tr>`;
    }).join('');
  } catch(e) {
    tb.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--mid);padding:1.5rem;">Failed to load subscribers</td></tr>';
  }
};

window.exportSubscribers = async function() {
  try {
    const snap = await getDocs(query(collection(db,'subscribers'), orderBy('subscribedAt','desc')));
    const docs = snap.docs.map(d => d.data());
    if (!docs.length) { showToast('No subscribers to export'); return; }
    const rows = [['Name','Email','Source','Date']].concat(docs.map(s => [
      (s.name||'').replace(/,/g,''),
      (s.email||'').replace(/,/g,''),
      (s.source||'').replace(/,/g,''),
      s.subscribedAt ? new Date(s.subscribedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''
    ]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'subscribers-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  } catch(e) { showToast('Export failed'); }
};

function showPricingSection(cat, pricingType) {
  const isSoap = cat === 'soap';
  const isBundle = cat === 'bundle' || cat === 'label';
  const type = pricingType || (isSoap ? 'bar' : isBundle ? 'unit' : 'liquid');
  document.getElementById('soap-pricing').style.display = type === 'bar' ? 'block' : 'none';
  document.getElementById('weight-pricing').style.display = type === 'weight' ? 'block' : 'none';
  document.getElementById('liquid-pricing').style.display = type === 'liquid' ? 'block' : 'none';
  document.getElementById('bundle-pricing').style.display = type === 'unit' ? 'block' : 'none';
  ['bar','liquid','weight','unit'].forEach(t=>{
    const btn=document.getElementById('pt-'+t);
    if(btn){btn.classList.toggle('btn-dk',t===type);btn.classList.toggle('btn-ol',t!==type);}
  });
  window._apPricingType = type;
}
window.setPricingType = function(type) {
  showPricingSection(document.getElementById('ap-cat').value, type);
};

document.addEventListener('change', e=>{
  if(e.target.id==='ap-cat'){
    showPricingSection(e.target.value);
  }
});

function resetProductForm(){
  ['ap-sku','ap-name','ap-tl','ap-tag','ap-ing','ap-ben','ap-use',
   'ap-p-bar','ap-m-bar','ap-p-l','ap-m-l','ap-p-g','ap-m-g','ap-p-5g','ap-m-5g',
   'ap-p-hlb','ap-m-hlb','ap-p-1lb','ap-m-1lb',
   'ap-p-lb2','ap-m-lb2','ap-p-lb8','ap-m-lb8','ap-p-lb40','ap-m-lb40',
   'ap-p-unit','ap-m-unit','ap-unit-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const cat=document.getElementById('ap-cat');
  if(cat){cat.selectedIndex=0;cat.dispatchEvent(new Event('change'));}
  const prev=document.getElementById('img-preview');
  if(prev){prev.src='';prev.style.display='none';}
  document.getElementById('edit-prod-id').value='';
  document.getElementById('prod-modal-title').textContent='Add New Product';
}
window.resetProductForm=resetProductForm;

window.editProduct = function(id){
  const p=PRODUCTS.find(x=>x.id===id); if(!p) return;
  document.getElementById('prod-modal-title').textContent='Edit Product';
  document.getElementById('edit-prod-id').value=id;
  const apSkuEl=document.getElementById('ap-sku'); if(apSkuEl) apSkuEl.value=p.sku||'';
  document.getElementById('ap-name').value=p.name;
  document.getElementById('ap-tl').value=p.tagline;
  document.getElementById('ap-cat').value=p.cat;
  document.getElementById('ap-tag').value=p.tag||'';
  document.getElementById('ap-ing').value=p.ingredients;
  document.getElementById('ap-ben').value=Array.isArray(p.benefits)?p.benefits.join(', '):p.benefits;
  document.getElementById('ap-use').value=p.usage;
  if(p.img){document.getElementById('img-preview').src=p.img;document.getElementById('img-preview').style.display='block';}
  else document.getElementById('img-preview').style.display='none';
  const pKeys = Object.keys(p.pricing);
  let pType = 'liquid';
  if (pKeys.some(k => k.startsWith('bars') || k === 'bar')) pType = 'bar';
  else if (pKeys.some(k => k === 'lb2' || k === 'lb8' || k === 'lb40' || k === 'halfLb' || k === 'lb1')) pType = 'weight';
  else if (pKeys.some(k => k === 'kit' || k === 'unit' || k === 'design')) pType = 'unit';
  showPricingSection(p.cat, pType);
  if (pType === 'bar') {
    const bk = pKeys.find(k => k.startsWith('bars') || k === 'bar') || 'bars10';
    if (p.pricing[bk]) { document.getElementById('ap-p-bar').value=p.pricing[bk].price; document.getElementById('ap-m-bar').value=p.pricing[bk].moq; }
  } else if (pType === 'weight') {
    if(p.pricing.halfLb){document.getElementById('ap-p-hlb').value=p.pricing.halfLb.price;document.getElementById('ap-m-hlb').value=p.pricing.halfLb.moq||1;}
    if(p.pricing.lb1){document.getElementById('ap-p-1lb').value=p.pricing.lb1.price;document.getElementById('ap-m-1lb').value=p.pricing.lb1.moq||1;}
    if(p.pricing.lb2){document.getElementById('ap-p-lb2').value=p.pricing.lb2.price;document.getElementById('ap-m-lb2').value=p.pricing.lb2.moq;}
    if(p.pricing.lb8){document.getElementById('ap-p-lb8').value=p.pricing.lb8.price;document.getElementById('ap-m-lb8').value=p.pricing.lb8.moq;}
    if(p.pricing.lb40){document.getElementById('ap-p-lb40').value=p.pricing.lb40.price;document.getElementById('ap-m-lb40').value=p.pricing.lb40.moq;}
  } else if (pType === 'unit') {
    const uk = pKeys.find(k => k === 'kit' || k === 'unit' || k === 'design') || 'kit';
    if (p.pricing[uk]) { document.getElementById('ap-p-unit').value=p.pricing[uk].price; document.getElementById('ap-m-unit').value=p.pricing[uk].moq||1; }
    const udEl=document.getElementById('ap-unit-desc'); if(udEl) udEl.value=p.unitDesc||p.pricing[uk]?.desc||p.pricing[uk]?.unitDesc||'';
  } else {
    if(p.pricing.litre){document.getElementById('ap-p-l').value=p.pricing.litre.price;document.getElementById('ap-m-l').value=p.pricing.litre.moq;}
    if(p.pricing.gallon){document.getElementById('ap-p-g').value=p.pricing.gallon.price;document.getElementById('ap-m-g').value=p.pricing.gallon.moq;}
    if(p.pricing['5gal']){document.getElementById('ap-p-5g').value=p.pricing['5gal'].price;document.getElementById('ap-m-5g').value=p.pricing['5gal'].moq;}
  }
  openM('m-add-prod');
};

window.deleteProduct = async function(id){
  if(!confirm('Delete this product? This cannot be undone.')) return;
  const filtered = PRODUCTS.filter(p=>p.id!==id);
  PRODUCTS.length = 0;
  filtered.forEach(p => PRODUCTS.push(p));
  try { await deleteDoc(doc(db,'products',id)); } catch(e){}
  updateProductStat();
  renderAdminProducts(); renderShop();
  if(typeof sfRenderProducts==='function'){ sfRenderProducts('all'); if(typeof sfRenderHeroCards==='function') sfRenderHeroCards(); }
  showToast('Product deleted');
};

window.saveProduct = async function(){
  const name=document.getElementById('ap-name').value.trim();
  if(!name){alert('Enter a product name');return;}
  const cat=document.getElementById('ap-cat').value;
  let pricing={};
  const weightVisible = document.getElementById('weight-pricing').style.display !== 'none';
  const bundleVisible = document.getElementById('bundle-pricing').style.display !== 'none';
  const soapVisible = document.getElementById('soap-pricing').style.display !== 'none';
  if(soapVisible){
    pricing.bars10={price:parseFloat(document.getElementById('ap-p-bar').value)||0,moq:parseInt(document.getElementById('ap-m-bar').value)||1};
  } else if(weightVisible){
    const phlb=document.getElementById('ap-p-hlb')?.value, mhlb=document.getElementById('ap-m-hlb')?.value;
    const p1lb=document.getElementById('ap-p-1lb')?.value, m1lb=document.getElementById('ap-m-1lb')?.value;
    const p2=document.getElementById('ap-p-lb2').value,m2=document.getElementById('ap-m-lb2').value;
    const p8=document.getElementById('ap-p-lb8').value,m8=document.getElementById('ap-m-lb8').value;
    const p40=document.getElementById('ap-p-lb40').value,m40=document.getElementById('ap-m-lb40').value;
    if(phlb) pricing.halfLb={price:parseFloat(phlb),moq:parseInt(mhlb)||1};
    if(p1lb) pricing.lb1={price:parseFloat(p1lb),moq:parseInt(m1lb)||1};
    if(p2) pricing.lb2={price:parseFloat(p2),moq:parseInt(m2)||1};
    if(p8) pricing.lb8={price:parseFloat(p8),moq:parseInt(m8)||1};
    if(p40) pricing.lb40={price:parseFloat(p40),moq:parseInt(m40)||1};
    if(!Object.keys(pricing).length) pricing.lb2={price:0,moq:1};
  } else if(bundleVisible){
    const uk=cat==='label'?'design':cat==='bundle'?'kit':'unit';
    const unitDesc=(document.getElementById('ap-unit-desc')?.value||'').trim();
    pricing[uk]={price:parseFloat(document.getElementById('ap-p-unit').value)||0,moq:parseInt(document.getElementById('ap-m-unit').value)||1,...(unitDesc?{unitDesc}:{})};
  } else {
    const pl=document.getElementById('ap-p-l').value,ml=document.getElementById('ap-m-l').value;
    const pg=document.getElementById('ap-p-g').value,mg=document.getElementById('ap-m-g').value;
    const p5=document.getElementById('ap-p-5g').value,m5=document.getElementById('ap-m-5g').value;
    if(pl) pricing.litre={price:parseFloat(pl),moq:parseInt(ml)||1};
    if(pg) pricing.gallon={price:parseFloat(pg),moq:parseInt(mg)||1};
    if(p5) pricing['5gal']={price:parseFloat(p5),moq:parseInt(m5)||1};
    if(!Object.keys(pricing).length) pricing.litre={price:0,moq:1};
  }
  const editId=document.getElementById('edit-prod-id').value;
  const imgEl=document.getElementById('img-preview');
  const newImgSrc=imgEl.style.display!=='none'?imgEl.src:'';
  const existingImg=editId?(PRODUCTS.find(p=>p.id===editId)||{}).img||'':'';
  const imgSrc=newImgSrc||existingImg;
  const unitDesc=(document.getElementById('ap-unit-desc')?.value||'').trim()||undefined;
  if(editId){
    const idx=PRODUCTS.findIndex(p=>p.id===editId);
    const _editSku=(document.getElementById('ap-sku')?.value||'').trim();
    if(idx>-1) PRODUCTS[idx]={...PRODUCTS[idx],sku:_editSku,name,tagline:document.getElementById('ap-tl').value,cat,tag:document.getElementById('ap-tag').value,ingredients:document.getElementById('ap-ing').value,benefits:document.getElementById('ap-ben').value.split(',').map(s=>s.trim()),usage:document.getElementById('ap-use').value,pricing,img:imgSrc,...(unitDesc?{unitDesc}:{unitDesc:undefined})};
  } else {
    const _newSku=(document.getElementById('ap-sku')?.value||'').trim();
    PRODUCTS.push({id:'p'+Date.now(),sku:_newSku,name,tagline:document.getElementById('ap-tl').value,cat,emoji:'🧴',tag:document.getElementById('ap-tag').value,ingredients:document.getElementById('ap-ing').value,benefits:document.getElementById('ap-ben').value.split(',').map(s=>s.trim()),usage:document.getElementById('ap-use').value,pricing,img:imgSrc,...(unitDesc?{unitDesc}:{})});
  }
  // Save to Firebase so it persists across reloads
  if (!auth.currentUser) { showToast('Session expired — please log in again'); return; }
  const prodToSave = editId ? PRODUCTS.find(p=>p.id===editId) : PRODUCTS[PRODUCTS.length-1];
  // Strip img from Firestore doc to keep it small; store img separately
  const {img, ...prodNoImg} = prodToSave;
  const docToSave = img ? {...prodNoImg, img} : prodNoImg;
  try {
    const docId = editId || prodToSave.id;
    await setDoc(doc(db,'products',docId), docToSave);
    showToast('Product saved ✓');
    closeM('m-add-prod'); updateProductStat(); renderShop(); renderAdminProducts();
    resetProductForm();
    // Refresh storefront
    if(typeof sfRenderProducts==='function'){ sfRenderProducts('all'); if(typeof sfRenderHeroCards==='function') sfRenderHeroCards(); }
  } catch(e) {
    console.error('saveProduct error:', e);
    const code = e.code || e.name || '';
    if (code.includes('permission') || code.includes('PERMISSION')) {
      showToast('Permission denied — check Firestore rules in Firebase Console');
    } else if (code.includes('unavailable') || code.includes('network')) {
      showToast('No connection — check internet and try again');
    } else {
      showToast('Save failed (' + (e.code||e.message||'unknown') + ')');
    }
  }
};

window.previewImg = function(input){
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const raw=new Image();
    raw.onload=function(){
      const MAX=400;
      const scale=Math.min(1,MAX/Math.max(raw.width,raw.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.round(raw.width*scale);
      canvas.height=Math.round(raw.height*scale);
      canvas.getContext('2d').drawImage(raw,0,0,canvas.width,canvas.height);
      const img=document.getElementById('img-preview');
      img.src=canvas.toDataURL('image/jpeg',0.72);
      img.style.display='block';
    };
    raw.src=e.target.result;
  };
  reader.readAsDataURL(file);
};

// ═══ RECEIPTS ═══
function buildReceipt(o){
  const id=o.id||'—', client=o.client||'—', product=o.product||'—';
  const qty=o.qty||1, total=parseFloat(o.total||0), pay=o.payMethod||o.payment||'—';
  const date=parseOrderDate(o.date||o.createdAt,'short');
  const wa=o.phone||o.wa||'—', addr=o.deliveryLocation||o.address||o.customerAddress||'—';
  const ship=parseFloat(o.deliveryFee||0), sub=total-ship;
  const ps=o.paymentStatus||o.payment||'—';
  return `<div class="receipt" style="max-width:480px;margin:0 auto;font-family:'Outfit',sans-serif;">
    <div class="rcpt-hdr">
      <div class="rcpt-logo"><div class="rcpt-nc"><span>Nc</span></div><div><div style="font-family:'Playfair Display',serif;font-size:0.95rem;font-weight:700;">Najah Chemist</div><div style="font-size:0.68rem;color:#888;">Jamaica's Skincare Manufacturer</div></div></div>
      <div style="font-size:0.7rem;color:#888;margin-top:0.25rem;">najahchemistja.com · @najahchemist</div>
    </div>
    <div style="margin-bottom:1rem;">
      <div class="rcpt-row"><span style="color:#888;">Order ID</span><strong>${id}</strong></div>
      <div class="rcpt-row"><span style="color:#888;">Date</span><span>${date}</span></div>
      <div class="rcpt-row"><span style="color:#888;">Client</span><span>${client}</span></div>
      ${wa!=='—'?`<div class="rcpt-row"><span style="color:#888;">WhatsApp</span><span>${wa}</span></div>`:''}
      ${addr!=='—'?`<div class="rcpt-row"><span style="color:#888;">Delivery</span><span style="max-width:200px;text-align:right;">${addr}</span></div>`:''}
      <div class="rcpt-row"><span style="color:#888;">Payment Method</span><span>${pay}</span></div>
      <div class="rcpt-row"><span style="color:#888;">Payment Status</span><span>${ps}</span></div>
    </div>
    <div style="font-size:0.66rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-bottom:0.5rem;">Order Details</div>
    ${Array.isArray(o.items)&&o.items.length?o.items.map(i=>{const prod=window.PRODUCTS.find(p=>p.id===i.productId);const sku=prod&&prod.sku?` [${prod.sku}]`:'';return `<div class="rcpt-row"><span style="max-width:260px;">${i.name}${sku} · ${i.size||'—'}</span><span>× ${i.qty}</span></div>`}).join(''):`<div class="rcpt-row"><span style="max-width:260px;">${product}</span><span>× ${qty}</span></div>`}
    ${ship>0?`<div class="rcpt-row"><span style="color:#888;">Subtotal</span><span>J$${Math.round(sub).toLocaleString()}</span></div><div class="rcpt-row"><span style="color:#888;">Shipping</span><span>J$${Math.round(ship).toLocaleString()}</span></div>`:''}
    <div class="rcpt-row rcpt-total"><span>Total</span><span>J$${Math.round(total).toLocaleString()}</span></div>
    <div class="rcpt-footer">Thank you for choosing Najah Chemist! · najahchemistja.com</div>
  </div>`;
}

window.showReceipt = function(id,client,product,qty,total,pay,date){
  const order = window.ordersMap&&window.ordersMap[id] ? window.ordersMap[id] : {id,client,product,qty,total,payMethod:pay,date};
  window.currentReceiptOrder = order;
  document.getElementById('receipt-content').innerHTML=buildReceipt(order);
  openM('m-receipt');
};

// ── BATCH PRINT ──
window.toggleAllOrders = function(checked){
  document.querySelectorAll('input.order-cb').forEach(cb=>{ cb.checked=checked; });
  updateOrderSelection();
};
window.updateOrderSelection = function(){
  const checks = document.querySelectorAll('input.order-cb:checked');
  const all = document.querySelectorAll('input.order-cb');
  const n = checks.length;
  const bc = document.getElementById('batch-count'); if(bc) bc.textContent = n>0 ? n+(n===1?' order':' orders')+' selected' : '';
  const bl = document.getElementById('batch-lbl-n'); if(bl) bl.textContent = n;
  const br = document.getElementById('batch-rct-n'); if(br) br.textContent = n;
  const btnL = document.getElementById('btn-batch-labels');
  const btnR = document.getElementById('btn-batch-receipts');
  if(btnL){ btnL.disabled=n===0; btnL.style.background=n>0?'#065F46':'#9CA3AF'; btnL.style.cursor=n>0?'pointer':'not-allowed'; }
  if(btnR){ btnR.disabled=n===0; btnR.style.background=n>0?'#065F46':'#9CA3AF'; btnR.style.cursor=n>0?'pointer':'not-allowed'; }
  document.querySelectorAll('input.order-cb').forEach(cb=>{
    const row = cb.closest('tr'); if(row) row.style.background = cb.checked ? '#FFFBEB' : '';
  });
  const sa = document.getElementById('select-all-orders');
  if(sa && all.length){ sa.indeterminate = n>0 && n<all.length; sa.checked = n===all.length; }
};
window.clearOrderSelection = function(){
  document.querySelectorAll('input.order-cb').forEach(cb=>{ cb.checked=false; });
  const sa = document.getElementById('select-all-orders');
  if(sa){ sa.checked=false; sa.indeterminate=false; }
  updateOrderSelection();
};
window.filterOrdersByDate = function(val){
  _ordersDateFilter = val;
  renderOrdersTable();
};
window.clearDateFilter = function(){
  _ordersDateFilter = '';
  const inp = document.getElementById('orders-date-input');
  if(inp) inp.value = '';
  renderOrdersTable();
};
window.selectAllFiltered = function(){
  document.querySelectorAll('#orders-body tr').forEach(row=>{
    if(row.style.display==='none') return;
    const cb = row.querySelector('input.order-cb');
    if(cb) cb.checked = true;
  });
  updateOrderSelection();
};
// ── Shared label helpers ──────────────────────────────────────────────────────
var _LABEL_CSS = [
  '*{margin:0;padding:0;box-sizing:border-box;}',
  'body{background:#e8e8e8;display:flex;flex-direction:column;align-items:center;padding:10mm;}',
  '@page{size:A4;margin:0;}',
  '@media print{body{background:white;padding:10mm;}}',
  '.label{width:80mm;height:150mm;border:1.5px solid #000;padding:3mm 5mm;background:white;',
    'overflow:hidden;font-family:Arial,Helvetica,sans-serif;font-size:7pt;line-height:1.4;',
    'page-break-after:always;}',
  '.label:last-child{page-break-after:avoid;}',
  /* ── Header: all centred ── */
  '.lbl-hdr{text-align:center;margin-bottom:1mm;}',
  '.lbl-box{border:1.5px solid #000;width:12mm;height:12mm;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;margin:0 auto 1mm;}',
  '.lbl-box-nc{font-family:Georgia,"Times New Roman",serif;font-size:12pt;font-weight:bold;line-height:1;}',
  '.lbl-co-name{font-family:Georgia,"Times New Roman",serif;font-weight:bold;font-size:9.5pt;margin-bottom:0.5mm;}',
  '.lbl-co-line{font-size:6pt;color:#000;line-height:1.55;}',
  /* ── Dashes ── */
  '.lbl-dash{border:none;border-top:1px dashed #000;margin:1.5mm 0;}',
  /* ── RECEIPT block ── */
  '.lbl-rcpt{text-align:center;font-size:12pt;font-weight:bold;letter-spacing:3px;margin-bottom:1.5mm;}',
  '.lbl-bc{width:100%;margin-bottom:0.5mm;}',
  '.lbl-bc svg{display:block;width:100%;height:8mm;}',
  '.lbl-oid{text-align:center;font-family:monospace;font-size:7pt;font-weight:bold;letter-spacing:1px;}',
  /* ── Tagline ── */
  '.lbl-tagline{display:flex;justify-content:space-between;font-style:italic;font-size:5.5pt;margin-bottom:1.5mm;}',
  /* ── Customer ── */
  '.lbl-cname{font-family:Georgia,"Times New Roman",serif;font-size:13pt;font-weight:bold;',
    'line-height:1.2;margin-bottom:0.5mm;text-align:center;}',
  '.lbl-tier{font-weight:bold;font-size:8pt;text-align:center;margin-bottom:1.5mm;}',
  '.lbl-ship{font-size:9pt;font-weight:bold;margin-bottom:0.5mm;}',
  '.lbl-contact{font-size:9pt;font-weight:bold;}',
  '.lbl-gap{height:3mm;}',
  /* ── Sender block ── */
  '.lbl-from-row{display:flex;justify-content:space-between;align-items:center;',
    'font-size:7pt;font-weight:bold;line-height:1.5;}',
  '.lbl-from-addr{font-size:6.5pt;line-height:1.5;}',
  /* ── Footer ── */
  '.lbl-foot{text-align:center;margin-top:1mm;}',
  '.lbl-foot-logo{border:1px solid #000;font-family:Georgia,"Times New Roman",serif;font-weight:bold;',
    'font-size:7pt;padding:0.5mm 2mm;display:inline-block;margin-bottom:0.5mm;}',
  '.lbl-foot-txt{font-size:5pt;color:#333;line-height:1.6;}'
].join('');

function _makeBarcode(str){
  var u=[2,1,1];
  for(var i=0;i<str.length;i++){
    var c=str.charCodeAt(i);
    u.push((c>>6)&1?3:1,(c>>5)&1?1:2,(c>>4)&1?2:1,(c>>3)&1?1:1,(c>>2)&1?3:1,(c>>1)&1?1:2,c&1?2:1,1);
  }
  u.push(2,1,2);
  var x=0,rects='';
  u.forEach(function(w,i){
    if(i%2===0)rects+='<rect x="'+x+'" y="0" width="'+w+'" height="28" fill="#000"/>';
    x+=w;
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="9mm" viewBox="0 0 '+x+' 28" preserveAspectRatio="none">'+rects+'</svg>';
}

function _buildLabel(o){
  var sd=(o.shippingDetail||'').trim();
  var dl=(o.deliveryLocation||'').trim();
  var sm=(o.shipMethod||'').trim();
  var shipLine='';
  if(sd){ shipLine=sd.replace(/\s*[\u00b7\u2014\-]+\s*/,': '); }
  else if(dl){ shipLine=dl.replace(/\s*-\s*/,': ').replace('Kingston/St. Andrew:','Kingston/St. Andrew Delivery:'); }
  else if(sm){ var addr=(o.customerAddress||o.address||'').trim(); shipLine=addr?sm+': '+addr:sm; }

  var name=o.clientName||o.client||o.customerName||'';
  var phone=o.customerWhatsApp||o.phone||o.whatsapp||o.wa||'';
  var orderId=o.id||'';

  // Calculate customer tier from order total
  var total=parseFloat(o.total)||0;
  var tier=total>=150000?'PREMIUM':total>=61000?'GROWTH':total>=3550?'STARTER':'';

  var bc=_makeBarcode('NC-'+(orderId||'ORDER'));
  return '<div class="label">'
    // ── Header: Nc logo centred → company name → address → phones → email → site ──
    +'<div class="lbl-hdr">'
      +'<div class="lbl-box"><div class="lbl-box-nc">Nc</div></div>'
      +'<div class="lbl-co-name">Najah Chemist</div>'
      +'<div class="lbl-co-line">Carlton Crescent, Kingston 10 JA W.I.</div>'
      +'<div class="lbl-co-line">1(876)885-1099</div>'
      +'<div class="lbl-co-line">1(876)807-7104</div>'
      +'<div class="lbl-co-line">start@najahchemistja.com</div>'
      +'<div class="lbl-co-line">www.najahchemistja.com</div>'
    +'</div>'
    // ── Separator → RECEIPT → barcode → order number ──
    +'<div class="lbl-dash"></div>'
    +'<div class="lbl-rcpt">RECEIPT</div>'
    +'<div class="lbl-bc">'+bc+'</div>'
    +'<div class="lbl-oid">NC-'+orderId+'</div>'
    // ── Separator → tagline → customer name → tier → ship → contact ──
    +'<div class="lbl-dash"></div>'
    +'<div class="lbl-tagline"><em>Luxury Certified</em><em>Time 2 Shine &#9661;</em></div>'
    +'<div class="lbl-cname">'+name+'</div>'
    +(tier?'<div class="lbl-tier">('+tier+')</div>':'')
    +'<div class="lbl-ship">'+shipLine+'</div>'
    +'<div class="lbl-contact">Contact: '+phone+'</div>'
    // ── Gap → sender block ──
    +'<div class="lbl-gap"></div>'
    +'<div class="lbl-from-row"><span>Fr: Najah Chemist</span><span>&#128666;</span></div>'
    +'<div class="lbl-from-addr">Carlton Crescent<br>Kingston 10 JA W.I.</div>'
    // ── Separator → small logo → full address footer ──
    +'<div class="lbl-dash"></div>'
    +'<div class="lbl-foot">'
      +'<div class="lbl-foot-logo">Nc</div>'
      +'<div class="lbl-foot-txt">'
        +'Najah Chemist &middot; Carlton Crescent, Kingston 10 JA W.I.<br>'
        +'1(876)885-1099 &middot; 1(876)807-7104<br>'
        +'start@najahchemistja.com &middot; www.najahchemistja.com'
      +'</div>'
    +'</div>'
  +'</div>';
}
// ─────────────────────────────────────────────────────────────────────────────

window.batchPrintLabels = function(){
  const checks = document.querySelectorAll('input.order-cb:checked');
  if(!checks.length){ alert('No orders selected'); return; }
  const orders = Array.from(checks).map(cb=>window.ordersMap&&window.ordersMap[cb.getAttribute('data-id')]).filter(Boolean);
  if(!orders.length){ alert('Order data not found'); return; }
  const labelsHtml = orders.map(o=>_buildLabel(o)).join('');
  const win = window.open('','_blank','width=500,height=750');
  if(!win){ alert('Please allow popups for this site to use bulk printing.'); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>'+_LABEL_CSS+'</style></head><body>'+labelsHtml+'<script>setTimeout(function(){window.print();},400);<\/script></body></html>');
  win.document.close();
  win.onafterprint = ()=>win.close();
  markBatchPrinted(Array.from(checks).map(cb=>cb.getAttribute('data-id')),'labelPrinted');
};
window.batchPrintReceipts = function(){
  const checks = document.querySelectorAll('input.order-cb:checked');
  if(!checks.length){ alert('No orders selected'); return; }
  const orders = Array.from(checks).map(cb=>window.ordersMap&&window.ordersMap[cb.getAttribute('data-id')]).filter(Boolean);
  if(!orders.length){ alert('Order data not found'); return; }
  // Clear any stale content from previous print sessions
  const _zone = document.getElementById('bulk-print-zone');
  if(_zone){ _zone.innerHTML = ''; _zone.style.display = 'none'; }
  document.body.classList.remove('bulk-printing');
  const receiptsHtml = orders.map((order,i)=>{
    const arr = Array.isArray(order.items)?order.items:[];
    const itemsHtml = arr.length>0
      ? arr.map(it=>{ const p=it.sku?[it.sku,it.name||'']:[it.name||'']; if(it.size)p.push(it.size); return `<tr><td>${p.join(' · ')}</td><td align="right">x${it.qty||1}</td><td align="right">J$${((it.price||0)*(it.qty||1)).toLocaleString()}</td></tr>`; }).join('')
      : `<tr><td colspan="3">${order.product||'—'}</td></tr>`;
    const sub = (parseFloat(order.total)||0)-(parseFloat(order.deliveryFee)||0);
    const ship = parseFloat(order.deliveryFee)||0;
    const total = parseFloat(order.total)||0;
    const dateStr = parseOrderDate(order.date||order.createdAt);
    const wa = order.customerWhatsApp||order.phone||order.whatsapp||order.wa||'—';
    const addr = order.shippingDetail||order.deliveryLocation||order.customerAddress||order.address||'—';
    const pb = i<orders.length-1?'page-break-after:always;':'';
    return `<div style="${pb}padding:12px;font-family:Arial,sans-serif;font-size:11pt;color:#000;">
      <h2 style="text-align:center;font-size:14pt;margin:0 0 2px;">Najah Chemist</h2>
      <div style="text-align:center;font-size:9pt;color:#555;margin-bottom:10px;">Jamaica's Skincare Manufacturer<br>najahchemistja.com · @najahchemist</div>
      <hr style="border:none;border-top:1px dashed #000;margin:8px 0;">
      <table width="100%" style="border-collapse:collapse;font-size:10pt;">
        <tr><td>Order ID</td><td align="right"><b>${order.id||order.orderId||'—'}</b></td></tr>
        <tr><td>Date</td><td align="right">${dateStr}</td></tr>
        <tr><td>Client</td><td align="right">${order.clientName||order.client||order.customerName||'—'}</td></tr>
        <tr><td>WhatsApp</td><td align="right">${wa}</td></tr>
        <tr><td>Shipping</td><td align="right">${addr}</td></tr>
        <tr><td>Payment Method</td><td align="right">${order.payMethod||order.paymentMethod||'—'}</td></tr>
        <tr><td>Payment Status</td><td align="right">${order.paymentStatus||order.payment||'—'}</td></tr>
      </table>
      <hr style="border:none;border-top:1px dashed #000;margin:8px 0;">
      <b>ORDER DETAILS</b>
      <table width="100%" style="margin-top:6px;border-collapse:collapse;font-size:10pt;">
        <thead><tr><th align="left">Item</th><th align="right">Qty</th><th align="right">Amount</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <hr style="border:none;border-top:1px dashed #000;margin:8px 0;">
      ${ship>0?`<div style="display:flex;justify-content:space-between;font-size:10pt;margin-bottom:3px;"><span>Subtotal</span><span>J$${(sub>0?sub:total).toLocaleString()}</span></div><div style="display:flex;justify-content:space-between;font-size:10pt;margin-bottom:3px;"><span>Shipping</span><span>J$${ship.toLocaleString()}</span></div>`:''}
      <div style="font-size:13pt;font-weight:bold;text-align:right;margin-top:6px;">Total: J$${total.toLocaleString()}</div>
      <div style="text-align:center;font-size:8pt;color:#888;margin-top:14px;">Thank you for choosing Najah Chemist! · najahchemistja.com</div>
    </div>`;
  }).join('');
  const win = window.open('','_blank','width=640,height=820');
  if(!win){ alert('Please allow popups for this site to use bulk printing.'); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;}body{margin:0;background:white;}table{border-collapse:collapse;width:100%;}@media print{@page{size:A5;margin:10mm;}}</style></head><body>'
    + receiptsHtml
    + '<script>setTimeout(function(){window.print();window.close();},400);<\/script></body></html>');
  win.document.close();
  markBatchPrinted(Array.from(checks).map(cb=>cb.getAttribute('data-id')),'receiptPrinted');
};
window.printAllReceipts = function(){
  const rows = Array.from(document.querySelectorAll('#orders-body tr')).filter(r=>r.style.display!=='none');
  if(!rows.length){ alert('No orders to print'); return; }
  const ids = rows.map(r=>{ const cb=r.querySelector('input.order-cb'); return cb?cb.getAttribute('data-id'):null; }).filter(Boolean);
  const orders = ids.map(id=>window.ordersMap&&window.ordersMap[id]).filter(Boolean);
  if(!orders.length){ alert('Order data not found'); return; }
  const receiptsHtml = orders.map((order,i)=>{
    const arr = Array.isArray(order.items)?order.items:[];
    const itemsHtml = arr.length>0
      ? arr.map(it=>{ const p=it.sku?[it.sku,it.name||'']:[it.name||'']; if(it.size)p.push(it.size); return `<tr><td>${p.join(' · ')}</td><td align="right">x${it.qty||1}</td><td align="right">J$${((it.price||0)*(it.qty||1)).toLocaleString()}</td></tr>`; }).join('')
      : `<tr><td colspan="3">${order.product||'—'}</td></tr>`;
    const sub = (parseFloat(order.total)||0)-(parseFloat(order.deliveryFee)||0);
    const ship = parseFloat(order.deliveryFee)||0;
    const total = parseFloat(order.total)||0;
    const dateStr = parseOrderDate(order.date||order.createdAt);
    const wa = order.customerWhatsApp||order.phone||order.whatsapp||order.wa||'—';
    const addr = order.shippingDetail||order.deliveryLocation||order.customerAddress||order.address||'—';
    const pb = i<orders.length-1?'page-break-after:always;':'';
    return `<div style="${pb}padding:12px;font-family:Arial,sans-serif;font-size:11pt;color:#000;">
      <h2 style="text-align:center;font-size:14pt;margin:0 0 2px;">Najah Chemist</h2>
      <div style="text-align:center;font-size:9pt;color:#555;margin-bottom:10px;">Jamaica's Skincare Manufacturer<br>najahchemistja.com · @najahchemist</div>
      <hr style="border:none;border-top:1px dashed #000;margin:8px 0;">
      <table width="100%" style="border-collapse:collapse;font-size:10pt;">
        <tr><td>Order ID</td><td align="right"><b>${order.id||order.orderId||'—'}</b></td></tr>
        <tr><td>Date</td><td align="right">${dateStr}</td></tr>
        <tr><td>Client</td><td align="right">${order.clientName||order.client||order.customerName||'—'}</td></tr>
        <tr><td>WhatsApp</td><td align="right">${wa}</td></tr>
        <tr><td>Shipping</td><td align="right">${addr}</td></tr>
        <tr><td>Payment Method</td><td align="right">${order.payMethod||order.paymentMethod||'—'}</td></tr>
        <tr><td>Payment Status</td><td align="right">${order.paymentStatus||order.payment||'—'}</td></tr>
      </table>
      <hr style="border:none;border-top:1px dashed #000;margin:8px 0;">
      <b>ORDER DETAILS</b>
      <table width="100%" style="margin-top:6px;border-collapse:collapse;font-size:10pt;">
        <thead><tr><th align="left">Item</th><th align="right">Qty</th><th align="right">Amount</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <hr style="border:none;border-top:1px dashed #000;margin:8px 0;">
      ${ship>0?`<div style="display:flex;justify-content:space-between;font-size:10pt;margin-bottom:3px;"><span>Subtotal</span><span>J$${(sub>0?sub:total).toLocaleString()}</span></div><div style="display:flex;justify-content:space-between;font-size:10pt;margin-bottom:3px;"><span>Shipping</span><span>J$${ship.toLocaleString()}</span></div>`:''}
      <div style="font-size:13pt;font-weight:bold;text-align:right;margin-top:6px;">Total: J$${total.toLocaleString()}</div>
      <div style="text-align:center;font-size:8pt;color:#888;margin-top:14px;">Thank you for choosing Najah Chemist! · najahchemistja.com</div>
    </div>`;
  }).join('');
  const win = window.open('','_blank','width=640,height=820');
  if(!win){ alert('Please allow popups for this site to use bulk printing.'); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;}body{margin:0;background:white;}table{border-collapse:collapse;width:100%;}@media print{@page{size:A5;margin:10mm;}}</style></head><body>'
    + receiptsHtml
    + '<script>setTimeout(function(){window.print();window.close();},400);<\/script></body></html>');
  win.document.close();
};
async function markBatchPrinted(ids, field){
  if(!ids||!ids.length) return;
  for(const id of ids){
    const o = window.ordersMap&&window.ordersMap[id];
    if(o&&o.dbId){
      try{ await updateDoc(doc(db,'orders',o.dbId),{[field]:true}); if(window.ordersMap[id]) window.ordersMap[id][field]=true; }catch(e){}
    }
  }
  renderOrdersTable();
}

function parseOrderDate(date, format) {
  if (!date) return '—';
  let d;
  if (date && date.seconds) d = new Date(date.seconds * 1000);
  else if (date && date.toDate) d = date.toDate();
  else d = new Date(date);
  if (isNaN(d.getTime())) {
    if (typeof date === 'string' && date && !date.startsWith('[object')) return date;
    return '—';
  }
  if (format === 'short') return d.toLocaleDateString('en-JM');
  return d.toLocaleString('en-JM');
}

window.printReceipt = function(order){
  if(!order){ alert('Order not found'); return; }
  const items = (order.items||[]).map(i=>{
    const prod = window.PRODUCTS&&window.PRODUCTS.find(p=>p.id===i.productId);
    const name = prod ? prod.name : (i.name||'—');
    return `<tr><td>${name} ${i.size||''}</td><td align="right">x${i.qty||1}</td></tr>`;
  }).join('');
  const dateStr = parseOrderDate(order.date||order.createdAt);
  const win = window.open('','_blank','width=420,height=600');
  win.document.write(`<!DOCTYPE html><html><head><title>Receipt ${order.id||''}</title>
  <style>
    @page { size: A5; margin: 10mm; }
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; margin: 0; padding: 12px; }
    h2 { text-align:center; font-size:14pt; margin:0 0 2px; }
    .sub { text-align:center; font-size:9pt; color:#555; margin-bottom:10px; }
    table { width:100%; border-collapse:collapse; }
    td { padding:3px 0; font-size:10pt; }
    hr { border:none; border-top:1px dashed #000; margin:8px 0; }
    .total { font-size:13pt; font-weight:bold; text-align:right; margin-top:6px; }
    .footer { text-align:center; font-size:8pt; color:#888; margin-top:14px; }
  </style></head><body>
  <h2>Najah Chemist</h2>
  <div class="sub">Jamaica's Skincare Manufacturer<br>najahchemistja.com · @najahchemist</div>
  <hr>
  <table>
    <tr><td>Order ID</td><td align="right"><b>${order.id||'—'}</b></td></tr>
    <tr><td>Date</td><td align="right">${dateStr}</td></tr>
    <tr><td>Client</td><td align="right">${order.clientName||order.client||'—'}</td></tr>
    <tr><td>Payment Method</td><td align="right">${order.payMethod||order.paymentMethod||'—'}</td></tr>
    <tr><td>Payment Status</td><td align="right">${order.paymentStatus||order.payment||'—'}</td></tr>
  </table>
  <hr>
  <b>ORDER DETAILS</b>
  <table style="margin-top:6px;">${items||`<tr><td>${order.product||'—'}</td></tr>`}</table>
  <hr>
  <div class="total">Total: J$${(parseFloat(order.total)||0).toLocaleString()}</div>
  <div class="footer">Thank you for choosing Najah Chemist! · najahchemistja.com</div>
  </body></html>`);
  win.document.close();
  setTimeout(()=>{ win.print(); },350);
};

window.printR = function(orderOrId){
  const o = typeof orderOrId==='string' ? (DB_ORDERS.find(x=>x.id===orderOrId)||{id:orderOrId}) : orderOrId;
  const html = buildReceipt(o);
  const w = window.open('','_print','width=600,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page{size:A5;margin:10mm;}
    *{box-sizing:border-box;}body{margin:0;font-family:'Outfit',Arial,sans-serif;font-size:0.84rem;}
    .receipt{background:#fff;border:1px solid #E8E4DE;border-radius:10px;padding:1.75rem;font-size:0.84rem;}
    .rcpt-hdr{text-align:center;margin-bottom:1.1rem;padding-bottom:1rem;border-bottom:2px dashed #E8E4DE;}
    .rcpt-logo{display:flex;align-items:center;justify-content:center;gap:0.55rem;margin-bottom:0.35rem;}
    .rcpt-nc{width:32px;height:32px;background:#0F0E0D;display:flex;align-items:center;justify-content:center;}
    .rcpt-nc span{color:#fff;font-weight:700;font-size:0.78rem;}
    .rcpt-row{display:flex;justify-content:space-between;padding:0.28rem 0;border-bottom:1px solid #E8E4DE;}
    .rcpt-total{font-weight:700;font-size:0.98rem;padding-top:0.45rem;}
    .rcpt-footer{text-align:center;margin-top:0.85rem;padding-top:0.75rem;border-top:2px dashed #E8E4DE;font-size:0.73rem;color:#6B7280;}
  </style></head><body>${html}</body></html>`);
  w.document.close();
  w.onafterprint = () => w.close();
  setTimeout(() => w.print(), 200);
};

window.printLabel = function(order){
  const o = typeof order==='string'?JSON.parse(order):order;
  const labelHtml = _buildLabel(o);
  const win = window.open('','_blank','width=500,height=750');
  if(!win){ alert('Please allow popups to print labels.'); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>'+_LABEL_CSS+'</style></head><body>'+labelHtml+'<script>setTimeout(function(){window.print();},400);<\/script></body></html>');
  win.document.close();
  win.onafterprint = ()=>win.close();
};

// ═══ FORMS ═══
window.doTrack = ()=>{ document.getElementById('trk-out').style.display='block'; };

window.subPO = async function(){
  const n=document.getElementById('po-name').value, e=document.getElementById('po-email').value;
  if(!n||!e){alert('Please fill in name and email');return;}
  const msg={from:n,subject:'Order Request',email:e,preview:`${document.getElementById('po-prod').value} | ${document.getElementById('po-size').value} | Qty: ${document.getElementById('po-qty').value}`,date:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'}),status:'New'};
  DB_MESSAGES.unshift(msg); renderInbox(); updateBadges();
  await saveMessageToDB(msg);
  alert(`✓ Order request submitted! We'll be in touch within 24 hours, ${n}.`);
};

window.sendMsg = async function(){
  const n=document.getElementById('pm-name').value, b=document.getElementById('pm-body').value;
  if(!n||!b){alert('Please fill in name and message');return;}
  const msg={from:n,subject:document.getElementById('pm-subj').value,email:document.getElementById('pm-email').value,preview:b.substring(0,60)+'...',date:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'}),status:'New'};
  DB_MESSAGES.unshift(msg); renderInbox(); updateBadges();
  await saveMessageToDB(msg);
  alert('✓ Message sent! We respond within 24 hours.');
};

window.genLink = function(){
  const n=document.getElementById('pl-n').value, a=document.getElementById('pl-a').value;
  if(!n||!a){alert('Please fill in name and amount');return;}
  const id='NC-'+Math.floor(Math.random()*9000+1000);
  document.getElementById('pl-txt').innerHTML=`To: ${n}<br>Amount: J$${Math.round(parseFloat(a)).toLocaleString()}<br>For: ${document.getElementById('pl-d').value||'Najah Chemist Order'}<br>Ref: ${id}<br>Pay to: Najah Chemist · NCB Account<br>Via: ${document.getElementById('pl-v').value}`;
  document.getElementById('pl-out').style.display='block';
};

// ═══ CHATBOT ═══
function getSYS(){
  // Build live product catalogue from Firestore-loaded PRODUCTS array
  const sizeLabels={litre:'1L',gallon:'Gal','5gal':'5 Gal',lb2:'2lbs',lb8:'8lbs',lb40:'40lbs',
    bars10:'10 bars',bars100:'100 bars',caps100:'100 caps',caps1000:'1000 caps',
    halfLb:'½lb',lb1:'1lb',kit:'per unit',unit:'per unit',design:'per design',bar:'per bar'};
  function fmtPricing(pricing){
    return Object.entries(pricing).map(([k,v])=>`J$${v.price.toLocaleString()} (${sizeLabels[k]||k})`).join(' | ');
  }
  const cats={yoni:'YONI CARE',skincare:'SKIN CARE',soap:'BAR SOAPS',mencare:'MEN CARE',haircare:'HAIR CARE',bundle:'BUNDLES',label:'DESIGN SERVICES'};
  const grouped={};
  (window.PRODUCTS||[]).filter(p=>!p.hidden).forEach(p=>{
    const c=cats[p.cat]||p.cat.toUpperCase();
    if(!grouped[c]) grouped[c]=[];
    grouped[c].push(`  • ${p.name} — ${fmtPricing(p.pricing)}${p.ingredients?'\n    Ingredients: '+p.ingredients:''}${p.benefits?'\n    Benefits: '+(Array.isArray(p.benefits)?p.benefits.join(', '):p.benefits):''}`);
  });
  const catalogue=Object.entries(grouped).map(([cat,lines])=>`${cat}:\n${lines.join('\n')}`).join('\n\n');

  return `You are the friendly, knowledgeable customer service assistant for Najah Chemist — a Jamaican professional-grade skincare manufacturer. Be warm, helpful and concise. All prices are in Jamaican Dollars (J$). Answer questions immediately and fully. When a customer asks about a product, share its benefits, key ingredients, how to use it, best skin type, and suggest 1–2 complementary products. Capture name and WhatsApp number when they want to place an order. For urgent issues direct them to WhatsApp (876) 885-1099 or @najahchemist.

BRAND: Najah Chemist uses professional-grade actives — kojic acid, AHAs, salicylic acid, hyaluronic acid, etc. NOT a natural or organic brand. Focus is on results.

══════════════════════════════════════
LIVE PRODUCT CATALOGUE (from Firestore)
══════════════════════════════════════
${catalogue}

══════════════════════════════════════
INGREDIENTS & BENEFITS (detailed)
══════════════════════════════════════
BAR SOAPS:
  • Turmeric & Kojic — Kojic Acid, Turmeric, Coconut Oil → fades dark spots, hyperpigmentation, acne
  • Garlic & Lavender — Garlic Extract, Lavender, Coconut Oil → eczema, psoriasis, liver spots, antibacterial
  • Vitamin C — Vitamin C, Kojic Acid, Olive Oil → brightens, discoloration, acne
  • Glycolic Acid — Glycolic Acid (AHA), Coconut Oil → minimises pores, fine lines, exfoliates, acne
  • Salicylic Acid — Salicylic Acid (BHA), Tea Tree, Coconut Oil → unclogs pores, acne, blackheads
  • Skin Lightening — Kojic Acid, Snow White Complex, Charcoal → lightens, discoloration, acne

YONI CARE:
  • Yoni Foaming Wash — Aloe Vera, Lactic Acid, Calendula → pH-balanced daily intimate wash (6 scents)
  • Boric Acid & Probiotics Gel Wash — Boric Acid, Probiotics, Lactic Acid → restores pH, fights BV
  • Yoni Brightening Scrub — Sugar, Kojic Acid, Coconut Oil → brightens intimate skin, reduces ingrown hairs
  • Luxury Yoni Oil — Sunflower Oil, Coconut Oil, Jojoba Oil, Sweet Almond Oil, Frankincense, Vitamin E → moisturises, antibacterial, balances
  • VagiMist — Aloe Vera, Witch Hazel, Tea Tree Oil, Lactic Acid → on-the-go intimate freshness
  • Yoni Pops / Boric Acid Suppositories — Boric Acid 600mg → eliminates BV and yeast infections, restores pH
  • Yoni Steam Herbs — Lavender, Rosemary, Chamomile, Rose Petals, Mugwort → womb wellness steam therapy

SKIN CARE:
  • Dark Spot Remover / Spot Remover — Kojic Acid, Alpha Arbutin, Turmeric Oil, Vitamin E → fades dark spots, hyperpigmentation
  • Lightening Serum — Kojic Acid, Alpha Arbutin, Niacinamide, Vitamin C → fades spots, evens tone
  • Hyaluronic Acid Serum — Hyaluronic Acid, Niacinamide, Aloe Vera → intense hydration, plumps, minimises pores
  • Rose Oil Serum — Rosehip Oil, Rose Essential Oil, Vitamin E, Jojoba Oil → anti-aging, nourishing
  • Glycolic Acid Toner — Glycolic Acid, Witch Hazel, Niacinamide → resurfaces, refines pores
  • Rose Toner — Rose Water, Aloe Vera, Witch Hazel → soothes, balances pH
  • Turmeric Facial Cleanser — Turmeric, Niacinamide, Aloe Vera → brightens, deep cleanses
  • Brightening Body Butter — Shea Butter, Kojic Acid, Vitamin E → moisturises and brightens body
  • Brightening Body Scrub — Sugar, Avocado Butter, Shea Butter → exfoliates, fades discoloration, razor bumps, ingrown hairs

MEN CARE:
  • Beard Oil — Jojoba, Argan, Coconut Oil, Vitamin E → softens, conditions, reduces itch
  • Beard Shampoo — Aloe Vera, SLES, Sunflower Oil → cleanses and conditions beard
  • Beard Balm — Shea Butter, Beeswax, Argan Oil → styles, shapes, conditions
  • Ryfle Wash / Body Wash 3-in-1 — Glycerine, Aloe Vera, Sunflower Oil → body + hair + face, 12hr freshness

HAIR CARE:
  • Hair Growth Oil — Castor Oil, Bhringraj, Amla, Neem, Coconut Oil, Peppermint → stimulates growth, strengthens
  • Hair Butter — Shea Butter, Mango Butter, Argan Oil, Castor Oil → deep conditions, defines curls

BUNDLES:
  • Girls Night In Bundle — Yoni Wash + Yoni Oil + Yoni Scrub

══════════════════════════════════════
SKINCARE ROUTINE RECOMMENDATIONS
══════════════════════════════════════
Brightening:  Turmeric Kojic Soap → Rose Toner → Lightening Serum → Moisturiser + SPF
Acne:         Salicylic Acid Soap → Glycolic Toner → 2% Salicylic Serum → Moisturiser
Hydration:    Milk Cleanser → Rose Toner → Hyaluronic Acid Serum → Moisturiser
Anti-aging:   Glycolic Acid Soap → Glycolic Toner → Rose Oil Serum → Moisturiser
Men's:        Body Wash 3-in-1 → Beard Shampoo → Beard Oil → Beard Balm
Yoni routine: Yoni Cleanser daily + Yoni Oil daily + Yoni Scrub 2–3×/week

SKIN TYPE MATCHING:
Oily/acne:          Salicylic Acid Bar, Glycolic Acid Bar, Glycolic Toner
Dry/sensitive:      Milk Cleanser, Rose Toner, Hyaluronic Serum, Body Butter, Garlic Lavender Soap
Hyperpigmentation:  Turmeric Kojic Soap, Lightening Serum, Dark Spot Remover, Skin Lightening Bar
Aging:              Rose Oil Serum, Glycolic Toner, Moisturiser
All skin types:     Hyaluronic Acid Serum, Rose Toner, Moisturiser, Turmeric Bar Soap

══════════════════════════════════════
PREGNANCY & SAFETY
══════════════════════════════════════
NOT safe during pregnancy: Salicylic Acid products, Boric Acid products (Yoni Pops, Boric Acid Capsules, Probiotic Gel Wash), Glycolic Acid/AHA products, Peeling Oil, Yoni Steam Herbs, Male Enhancement Supplement.
Use with caution / consult doctor: Kojic Acid, Alpha Arbutin, Lactic Acid, Peppermint Oil (avoid first trimester), Strong Lightening Cream.
Generally safe: Hyaluronic Acid Serum, Rose Toner, Aloe Vera products, Shea Butter, Turmeric Soap, Vitamin C Soap, Body Butter, Hair Butter, Rose Oil Serum.
SPF RULE: ALL lightening and brightening products require SPF 30+ daily.

══════════════════════════════════════
PAYMENT & SHIPPING
══════════════════════════════════════
Payment (NO cash on delivery):
  • Online card: Fygaro via najahchemistja.com
  • Bank Transfer: NCB — JMD account 354-747-294 | USD account 354-747-308 | Swift: JNCBJMKX | Business: Najah Chemist
  • Lynk: @najahchemist | Cash: Kingston pickup only
Payment required BEFORE processing. 2–3 business day turnaround.

Shipping (Jamaica island-wide):
  • Knutsford Express — island-wide, next-day. Bearer fee ~J$500.
  • Zipmail — ~J$1,000 total.
  • Kingston/St. Andrew direct delivery — from J$1,000.

PRIVATE LABEL: MOQ 1 litre / 2 lbs | Lead time 7–14 days | 50% deposit | Custom labels available | Label Design J$3,000 | Formulation Consultation J$31,406

CONTACT: WhatsApp (876) 885-1099 · @najahchemist on Instagram & TikTok · najahchemistja.com`;
}

let hist=[];
function addMsg(txt,isUser){const m=document.getElementById('chat-msgs');const el=document.createElement('div');el.className='msg '+(isUser?'msg-user':'msg-bot');el.innerHTML=txt.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');m.appendChild(el);m.scrollTop=m.scrollHeight;}
function showTyping(){const m=document.getElementById('chat-msgs');const el=document.createElement('div');el.className='msg-typing';el.id='typing-ind';el.innerHTML='<div class="dot-a"><span></span><span></span><span></span></div>';m.appendChild(el);m.scrollTop=m.scrollHeight;}
function rmTyping(){const t=document.getElementById('typing-ind');if(t)t.remove();}
async function callAI(msg){
  hist.push({role:'user',content:msg});
  const extraKb = window._extraChatbotKnowledge ? '\n\nADDITIONAL BUSINESS INFORMATION:\n' + window._extraChatbotKnowledge : '';
  try{
    const r=await fetch('/.netlify/functions/chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages:hist.slice(-20),system:getSYS()+extraKb})
    });
    const d=await r.json();
    const reply=d.content?.[0]?.text||"I'm having trouble. Please DM us @najahchemist!";
    hist.push({role:'assistant',content:reply});
    return reply;
  }catch(e){return 'Having trouble connecting. Please DM @najahchemist on Instagram 💚';}
}
window.qr = async function(txt){addMsg(txt,true);document.getElementById('chat-qr').style.display='none';showTyping();const r=await callAI(txt);rmTyping();addMsg(r,false);};
window.chatSend = async function(){const inp=document.getElementById('chat-in');const txt=inp.value.trim();if(!txt)return;addMsg(txt,true);inp.value='';document.getElementById('chat-qr').style.display='none';showTyping();const r=await callAI(txt);rmTyping();addMsg(r,false);};

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('today-lbl').textContent = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  updateSizeOpts();
  renderOrdersTable();
  renderInbox();
  updateBadges();
  updateStatRevs();
  await loadFromDB();
  sfRenderReviews();
});


// ════════════════════════════════════════
// STOREFRONT LOGIC
// ════════════════════════════════════════

// ── Google Reviews ────────────────────────────────────
function sfRenderReviews() {
  const el = document.getElementById('sf-reviews-grid');
  if (!el) return;
  // Don't wipe existing cards — only replace if we get real data from Google
  fetch('/.netlify/functions/get-reviews')
    .then(function(r){ return r.json(); })
    .then(function(data) {
      if (!data.reviews || !data.reviews.length) return; // keep hardcoded cards
      renderReviewCards(el, data.reviews);
    })
    .catch(function() { /* keep hardcoded cards on any error */ });
}
window.sfRenderReviews = sfRenderReviews;

function renderReviewCards(el, reviews) {
  if (!reviews || !reviews.length) { el.innerHTML = '<p style="font-size:0.82rem;color:#9CA3AF;grid-column:1/-1;">No reviews yet.</p>'; return; }
  el.innerHTML = reviews.slice(0,6).map(function(r) {
    return '<div class="review-card"><div style="display:flex;gap:0.3rem;margin-bottom:0.4rem;color:#F59E0B;">'+'&#9733;'.repeat(r.stars||5)+'&#9734;'.repeat(5-(r.stars||5))+'</div><div class="review-name" style="font-weight:700;font-size:0.85rem;margin-bottom:0.3rem;">'+r.name+'</div><div class="review-text" style="font-size:0.82rem;color:#4B4846;line-height:1.6;margin-bottom:0.4rem;">'+r.text+'</div><div class="review-meta" style="font-size:0.72rem;color:#8A8480;">'+(r.date||'')+' &middot; Google Review</div></div>';
  }).join('');
}

function sfFallbackReviews() {
  return [
    {name:'Yanique T.', stars:5, text:'This soap changed my skin completely! Dark spots are fading fast. I reorder every month.', date:'Feb 2026'},
    {name:'Latoya R.', stars:5, text:'I ordered the litre and it lasted months. Amazing results and my customers love it.', date:'Feb 2026'},
    {name:'Shanice M.', stars:4, text:'Love the probiotic wash. No irritation at all. Great for sensitive skin.', date:'Jan 2026'},
    {name:'Kezia B.', stars:5, text:'Best wholesale supplier in Jamaica. Fast delivery and the products actually work.', date:'Jan 2026'},
    {name:'Tanya F.', stars:5, text:'Started my own brand with their private label service. Professional and affordable.', date:'Dec 2025'},
    {name:'Marcia W.', stars:5, text:'The turmeric soap is incredible. My whole family uses it now. Will definitely reorder.', date:'Dec 2025'}
  ];
}

// ── Email Popup ───────────────────────────────────────
window.closeEmailPopup = function() {
  const el = document.getElementById('sf-email-popup');
  if (el) el.classList.remove('open');
  try { localStorage.setItem('nc_popup_seen', '1'); } catch(e) {}
};

window.submitEmailPopup = async function() {
  const name = (document.getElementById('ep-name')?.value||'').trim();
  const email = (document.getElementById('ep-email')?.value||'').trim();
  const btn = document.getElementById('ep-btn');
  if (!email || !email.includes('@')) { sfShowToast('Please enter a valid email'); return; }
  if (btn) { btn.textContent = 'Opening...'; btn.disabled = true; }
  try { await saveSubscriber(name, email, 'popup_price_list'); } catch(e) {}
  window.open('https://najahchemistja.com/wholesale-prices', '_blank');
  const succ = document.getElementById('ep-success');
  if (succ) succ.style.display = 'block';
  if (btn) btn.style.display = 'none';
  setTimeout(window.closeEmailPopup, 3000);
};

window.submitEmailSection = async function() {
  const email = (document.getElementById('se-email')?.value||'').trim();
  if (!email || !email.includes('@')) { sfShowToast('Please enter a valid email'); return; }
  try { await saveSubscriber('', email, 'footer_subscribe'); } catch(e) {}
  sfShowToast('Subscribed! Welcome to Najah Chemist.');
  const inp = document.getElementById('se-email');
  if (inp) inp.value = '';
};

// Auto-show popup after 25 seconds (once per visitor)
setTimeout(function() {
  try {
    if (localStorage.getItem('nc_popup_seen')) return;
  } catch(e) {}
  const el = document.getElementById('sf-email-popup');
  if (el) el.classList.add('open');
}, 25000);

// ── Save Subscriber to Firestore ──────────────────────
async function saveSubscriber(name, email, source) {
  if (!email || !email.includes('@')) return false;
  try {
    const db = window._db;
    if (!db) return false;
    const { collection, addDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
    await addDoc(collection(db, 'subscribers'), {
      name: name || '',
      email: email.toLowerCase().trim(),
      source: source || 'website',
      subscribedAt: new Date().toISOString(),
      marketingConsent: true
    });
    return true;
  } catch(e) { console.error('saveSubscriber error:', e); return false; }
}
window.saveSubscriber = saveSubscriber;
const WA_NUMBER = '18768851099';

// Expose all storefront functions to window (required for module script inline onclick)
// NOTE: actual window.X assignments are placed next to each function definition below

const SF_IMG_CLASS = {soap:'img-soap',cream:'img-cream',serum:'img-serum',wash:'img-wash',hair:'img-cream',label:'img-label',yoni:'img-wash',skincare:'img-cream',mencare:'img-soap',haircare:'img-cream',bundle:'img-label'};
const SF_CAT_LABEL = {soap:'Bar Soap',cream:'Cream',serum:'Serum',wash:'Feminine Wash',hair:'Hair',label:'Design Service',yoni:'Yoni Care',skincare:'Skin Care',mencare:'Men Care',haircare:'Hair Care',bundle:'Bundle'};

function waOrder(productName) {
  const msg = productName
    ? `Hi Najah Chemist! I'd like to order: *${productName}*. Can you help me?`
    : `Hi Najah Chemist! I'd like to place an order. Can you help me?`;
  window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
}
window.waOrder = waOrder;
window.WA_NUMBER = WA_NUMBER;


