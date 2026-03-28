# Najah Chemist Wholesale Site — Claude Code Instructions

## Project Overview
Single-file wholesale storefront + admin panel for Najah Chemist, a Jamaican skincare manufacturer.

- **Live URL:** https://najahchemistja.com (also https://najahchemist.netlify.app)
- **GitHub:** https://github.com/najahuldin-cloud/najahchemist-store
- **Stack:** Netlify (hosting + functions), Firebase (Firestore + Auth), Google Sheets (orders), Anthropic Claude Haiku (chatbot)

---

## Brand Identity — IMPORTANT
- Najah Chemist is **NOT a natural/organic brand**
- Products use ingredients like **kojic acid, AHAs, chemical actives**
- Correct description: **"professional-grade skincare formulations"**
- Never describe products as "100% natural" or "all-natural" — this is factually wrong
- Chatbot must say products use "carefully selected ingredients including actives like kojic acid"

---

## Repo Structure
```
/
├── index.html                    ← entire storefront + admin panel
├── netlify.toml                  ← build config, functions path
├── netlify/
│   └── functions/
│       ├── package.json          ← no dependencies needed
│       ├── create-order.js       ← saves orders to Google Sheets
│       ├── chat.js               ← AI chatbot (storefront + admin)
│       ├── get-reviews.js        ← fetches Google Places reviews
│       └── send-receipt.js       ← sends order email receipts
```

---

## Critical Rules — Read Before Every Change

1. **Never touch index.html without reading the exact lines you're changing first.**
2. **The file has two script blocks:**
   - Module script: lines ~1790–3034 (Firebase, auth, admin logic, PRODUCTS array)
   - Regular script: lines ~3037–3598 (storefront cart, checkout, chat widget)
3. **All functions called from `onclick=""` HTML attributes must be on `window.*`**
4. **`sfCheckoutWA` must remain a sync function** — `window.open()` must be called synchronously or browsers block the popup.
5. **`#app` div has CSS `display:none`** — show it with `style.display = 'block'` (inline), not `style.display = ''` (that lets CSS win and keeps it hidden).
6. **Reviews are hardcoded in the HTML** — `sfRenderReviews()` only upgrades them if the Netlify function returns live data. Never wipe them with "Loading...".
7. **Admin product save** — `closeM()` and `renderShop()` must only be called AFTER Firebase `await setDoc()` resolves successfully.

---

## Environment Variables (set in Netlify dashboard)
```
ANTHROPIC_API_KEY         = sk-ant-...
GOOGLE_SERVICE_ACCOUNT    = { full JSON from service account key file }
GOOGLE_SHEET_ID           = 10Gzprr55zedU0fai9lDHo85SljoGfHWL3MvxYEUyk5c
GOOGLE_PLACES_API_KEY     = (new key — rotated March 2026, stored in Netlify only)
RESEND_API_KEY            = re_...
```

**Important:** Netlify stores `\n` in env vars as literal backslash-n.
In `create-order.js`, always fix the private key before using it:
```js
credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
```

---

## Key Credentials
- Firebase project: `najah-chemist-362ad`
- Firebase API key: stored in Netlify env var `FIREBASE_API_KEY`
- Admin email: `start@najahchemist.com`
- WhatsApp number: `18768851099`
- Google Place ID: `ChIJJ5oDKN4_244RKugRQdtw6Lc`
- NCB JMD account: `354-747-294`
- NCB USD account: `354-747-308`
- Lynk: `@najahchemist`
- Swift: `JNCBJMKX`
- Service account: `najah-wholesale-system@najah-chemist-wholesale-system.iam.gserviceaccount.com`

---

## Known Bugs Fixed (don't reintroduce)

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Admin panel blank after login | `openAdminLogin()` didn't call `showDashboard()` when already logged in | Added `showDashboard()` call |
| Admin panel blank on fresh login | `app.style.display = ''` lets CSS `display:none` win | Use `display = 'block'` |
| Reviews disappear | `sfRenderReviews()` wiped hardcoded cards with "Loading..." | Don't wipe; only replace if live data returns |
| WhatsApp checkout blocked | `sfCheckoutWA` was async | Keep sync |
| Sheets stop updating | Netlify `\n` in private key breaks RSA signing | `.replace(/\\n/g, '\n')` |
| Product save not persisting | `closeM()` called before Firebase await resolved | Move `closeM()` inside `try` after `await setDoc()` |
| Images not saving | Full base64 exceeded Firestore 1MB | Canvas compress: max 400px, JPEG 0.72 |

---

## Full Function Checklist — Verify All Working

### Storefront
- [ ] Products display with images, prices, sizes
- [ ] Category filter buttons work
- [ ] "Order Now" opens product detail modal
- [ ] Cart adds items, updates quantity, shows total
- [ ] Checkout opens WhatsApp with order summary (must be sync)
- [ ] Google reviews display (hardcoded fallback always visible)
- [ ] Chatbot opens and sends/receives messages
- [ ] Chatbot correctly answers: delivery, payment, pregnancy warnings, pricing, ingredients

### Admin Panel
- [ ] Login opens dashboard (not blank screen)
- [ ] Products tab shows all products with images
- [ ] Add New Product saves to Firestore AND appears on storefront immediately
- [ ] Edit product — name, price, image all update AND persist after page reload
- [ ] Delete product removes from Firestore and storefront
- [ ] Image upload compresses and saves (max 400px, JPEG 0.72)
- [ ] Orders tab shows orders
- [ ] Messages tab shows customer inbox
- [ ] Send receipt emails the customer

### Netlify Functions
- [ ] `/.netlify/functions/chat` — returns AI reply, handles CORS, OPTIONS preflight
- [ ] `/.netlify/functions/create-order` — saves to Google Sheets
- [ ] `/.netlify/functions/get-reviews` — returns Google Places reviews
- [ ] `/.netlify/functions/send-receipt` — sends email via Resend

---

## Business Info
- **Brand:** Professional-grade skincare — uses actives like kojic acid, AHAs (NOT a natural/organic brand)
- **Products:** Yoni Care, Skin Care, Bar Soaps, Men Care, Hair Care, Bundles
- **MOQ:** 1 litre / 2 lbs
- **Delivery:** Island-wide Jamaica (Knutsford Express, Zipmail, Kingston direct)
- **Payment:** NCB bank transfer, Fygaro (card), Lynk — no COD
- **Turnaround:** 2–3 business days after payment

---

## Pending Tasks
1. Connect `najahchemistja.com` to Netlify → update all URLs in index.html (canonical, OG, schema, sitemap, receipt footer)
2. Verify domain in Resend → update `send-receipt.js` from-address to `orders@najahchemistja.com`
3. Fix product save bug: move `closeM()` + `renderShop()` inside `try` block after `await setDoc()` resolves
4. Fix broken product images: Admin Panel → Edit each product → re-upload photo
5. Update chatbot brand voice in `chat.js`: remove any "natural brand" language, mention kojic acid and actives
6. Migrate hardcoded PRODUCTS array in index.html to Firestore (last priority)
