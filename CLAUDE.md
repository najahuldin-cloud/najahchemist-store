# Najah Chemist Wholesale Site — Claude Code Instructions

## Project Overview
Single-file wholesale storefront + admin panel for Najah Chemist, a Jamaican natural skincare manufacturer.

- **Live URL:** https://najahchemist.netlify.app
- **GitHub:** https://github.com/najahuldin-cloud/najahchemist-store
- **Stack:** Netlify (hosting + functions), Firebase (Firestore + Auth), Google Sheets (orders), Anthropic Claude Haiku (chatbot)

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

---

## Environment Variables (set in Netlify dashboard)
```
ANTHROPIC_API_KEY         = sk-ant-...
GOOGLE_SERVICE_ACCOUNT    = { full JSON from service account key file }
GOOGLE_SHEET_ID           = 10Gzprr55zedU0fai9lDHo85SljoGfHWL3MvxYEUyk5c
GOOGLE_PLACES_API_KEY     = AIzaSyAgqVirZbsbV-sa7oVMLtRSOXGgtRAetaA
RESEND_API_KEY            = re_...
```

**Important:** Netlify stores `\n` in env vars as literal backslash-n.
In `create-order.js`, always fix the private key before using it:
```js
credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
```

---

## Key Credentials (also in env vars above)
- Firebase project: `najah-chemist-362ad`
- Firebase API key: `AIzaSyDYdt_0wJNcfGl2WbIKPiESdVcmc-cqZgM`
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
| Admin panel blank after login | `openAdminLogin()` didn't call `showDashboard()` when user already logged in | Added `showDashboard()` at top of the already-logged-in branch |
| Admin panel blank on fresh login | `app.style.display = ''` lets CSS `display:none` win | Use `display = 'block'` |
| Reviews disappear | `sfRenderReviews()` wiped hardcoded cards with "Loading..." then fetch hung | Don't wipe cards; only replace if live data comes back |
| WhatsApp checkout doesn't open | `sfCheckoutWA` was `async` — browser blocks `window.open()` not called synchronously | Keep it as sync `function()` |
| Sheets stop updating | Netlify stores private key `\n` as literal backslash-n, breaking RSA signing | `.replace(/\\n/g, '\n')` on private key before signing |

---

## Business Info
- **Products:** Yoni Care, Skin Care, Bar Soaps, Men Care, Hair Care, Bundles
- **MOQ:** 1 litre / 2 lbs
- **Delivery:** Island-wide Jamaica (Knutsford Express, Zipmail, Kingston direct)
- **Payment:** NCB bank transfer, Fygaro (card), Lynk — no COD
- **Turnaround:** 2–3 business days after payment

---

## Pending Tasks
1. Buy `najahchemistja.com` → connect to Netlify → update canonical/OG/schema URLs
2. Verify domain in Resend → update `send-receipt.js` from-address to `orders@najahchemistja.com`
3. Fix broken product images: Admin Panel → Edit each product → re-upload photo
4. Migrate products from hardcoded HTML to Firestore (last priority)

---

## Update: April 2026

### File Structure Changes
- index.html split into: storefront.js (cart/checkout/upsell), storefront.css (all CSS), admin-module.js (Firebase/admin logic)
- index.html is now a shell only (~1,700 lines)
- New files added: links.html, custom-products.html, scripts/insert-missing-orders.js
- New Netlify functions: join-waitlist.js, send-restock-notification.js

### Critical Rules Added
- saveOrderSilent MUST be the FIRST call inside setTimeout in sfCheckoutWA and sfCheckoutFygaro — never add code before it or orders will be lost silently
- Firestore orders collection allows unauthenticated creates (allow create: if true) — never change this or storefront orders will fail
- Container filling service modal fires BEFORE WhatsApp opens
- Upsell popup fires AFTER WhatsApp opens
- When upsell accepted: send complete updated WhatsApp message with all items + new total
- Category URL format is ?category= (not ?cat=) — mapped in admin-module.js
- Firebase API key is hardcoded in admin.html and admin-module.js (safe — public by design)
- inject-env.js FILES array must include admin-module.js

### Corrected Business Info
- Live URL is now: https://najahchemistja.com
- Turnaround for existing products: 7-10 business days (not 2-3)
- Turnaround for new custom products: 14-21 business days
- New custom product MOQ: 5 gallons minimum
- R&D fee: J$120,000 first product, J$90,000 each additional
- Filling service: 15% of product subtotal
- Acid additions to existing products: J$1,000 per 2 lbs

### Features Built April 2026
- Waitlist system: email capture, Firestore save, confirmation email, restock notification
- Container filling service upsell with pre-WhatsApp modal
- Updated order WhatsApp message when upsell accepted
- /links Linktree-style page with working ?category= URL filters
- /custom-products service page
- New Client Manufacturing Package (PDF + Word doc)
- Admin health check indicator (last order saved timestamp)
- Admin 🧪 Send Test Order button
- URL category filtering (?category=skincare etc.)

### Known Bugs Fixed April 2026
- Orders not saving: moved saveOrderSilent to always run first
- Orders not saving: fixed Firestore security rules
- Orders not saving: hardcoded Firebase API key
- Orders not saving: added admin-module.js to inject-env.js FILES array
- Orders not saving: added firebase-admin + resend to root package.json
- WhatsApp notification links: owner email now links to lead's number
- Category filter: uses ?category= param with 800ms delay for Firestore load

### Confirmed Working (April 2026)
- Container filling service working end to end
- Upsell updated order message working
- Fixed Firestore rules for unauthenticated order saves
- Built /links page category filtering working
- Built repo memory system — CLAUDE.md now in repo root
- Added admin test order button
- Fixed WhatsApp notification links

### TODO (April 2026)
1. Waitlist confirmation email not sending
2. Add recommended retail prices to all product pages
3. Meta Business verification
4. Conversion rate dashboard improvements
5. Vegan/ingredient tagging on products
6. Garlic Lavender Soap page
7. NC-76264 Rosheda Nixon — add to Firestore manually

---

## Session Update: April 19, 2026

### Fixed
- Waitlist confirmation email — was failing due to FIREBASE_SERVICE_ACCOUNT env var too large for Lambda. Fixed by switching join-waitlist.js and send-restock-notification.js to use Firestore REST API with FIREBASE_API_KEY instead of firebase-admin
- Segmented WhatsApp message on /start completion card — was showing owner notification text. Fixed by injecting _ncLeadFollowupLink directly into completion card HTML at render time
- Owner notification auto window.open removed from browser — lead no longer sees owner message pop up

### Still Pending / Unconfirmed
- Lead notification message still possibly going to clients — needs real client test to confirm
- Discount text in segmented messages — may still say 10% instead of 5%, needs confirming
- Button renames (Details → Add to Cart, Shop Wholesale → Shop Now, Reorder → My Orders) — not done yet

### TODO (carry forward)
1. Confirm lead segmented message working with real client
2. Confirm discount text shows 5% not 10% in WhatsApp messages
3. Rename confusing buttons (Details, Shop Wholesale, Reorder)
4. Recommended retail prices on product pages
5. Meta Business verification
6. AOV / Business Intelligence dashboard in admin
7. Vegan/ingredient tagging on products
8. Garlic Lavender Soap page
9. NC-76264 Rosheda Nixon missing order

---

## Session Update: April 20, 2026

### Fixed
- Waitlist confirmation email — switched to Firestore REST API, removed firebase-admin dependency
- FIREBASE_SERVICE_ACCOUNT env var removed — replaced with smaller FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, then removed entirely in favour of REST API
- Segmented WhatsApp messages on /start — lead now gets correct segment message, owner notification no longer shows to client
- Bundle "Order This Bundle" buttons — all 4 bundles now add correct product to cart (skb2, gni1, mcb1, skb1)
- Girls Night In bundle price corrected to J$13,000
- Bundle product counts corrected — Skincare and Feminine Care: 24 products (4×6), Mencare: 18 products (3×6)
- Body care segment message — removed wrong Ayurvedic Hair Growth Oil reference
- Feminine care segment — updated to Girls Night In Luxury Bundle at J$13,000
- Discount corrected to 5% no code in all segment messages
- Client Portal button added to nav, Reorder button removed from hero

### Still Pending
- Confirm lead segmented message working with real client
- Recommended retail prices on product pages
- Meta Business verification
- AOV / Business Intelligence dashboard
- Vegan/ingredient tagging on products
- Garlic Lavender Soap page
- NC-76264 Rosheda Nixon missing order
- /links page review

---

## Session Update: April 21, 2026

### Fixed
- Business Intelligence dashboard auto-loads on tab click
- Top 5 Products by Revenue now parsing order items correctly
- sendBroadcastEmail Firebase function — set RESEND_API_KEY secret, redeployed all functions
- Niacinamide & Hyaluronic Serum product page — corrected INCI list and prices (J$13,000/J$50,000/J$225,000)
- Bundle "Order This Bundle" buttons — all 4 bundles working correctly
- Girls Night In bundle price corrected to J$13,000
- Body Care and Hair Care niches added to /start funnel
- Bar soap customisation details added to /customise page
- TikTok link added to site footer (@najahchemist)
- Client Portal button in nav, Reorder button removed from hero
- Bundle direct order links added to /links page
- Segmented WhatsApp messages — discount corrected to 5% no code
- Body care segment message corrected — removed Ayurvedic Hair Growth Oil reference

### Business Intelligence Stats (April 20, 2026)
- AOV: J$17,991
- Revenue this month: J$394,325
- Orders this month: 26
- Conversion rate: 2.4% (6 of 252 leads)
- Top client: Lisa Heath-combs — 5 orders, J$182,000 spent

### Formulation Notes
- Aloe Vera Extract formula finalised: 95.9% fresh aloe gel, 0.5% Potassium Sorbate, 0.5% Sodium Benzoate, 0.1% EDTA, 0.5% Vitamin E, 0.5% Citric Acid. Target pH 3.8-4.2. Shelf life 3-4 months room temp.

### TODO (carry forward)

#### ✅ Completed
- Waitlist confirmation email
- Container filling service upsell
- Upsell updated order message
- /links page with category filters
- /custom-products page
- New Client Manufacturing Package (PDF + Word)
- Repo memory system (CLAUDE.md)
- Garlic Lavender Soap page
- NC-76264 Rosheda Nixon missing order
- TikTok link added to site
- Client Portal button in nav
- Bundle direct order links
- Segmented WhatsApp messages fixed
- Business Intelligence dashboard
- Costing system (Google Sheets + Apps Script)
- Low stock WhatsApp alerts
- Receipt scanner (PDF + image auto-updates Database)
- Orders saving to Firestore confirmed working

#### ❌ Pending
1. Recommended retail prices on all product pages
2. Review all product page INCI lists for accuracy
3. Reorder calculator (Google Sheets)
4. Website inventory connection — map product formulas in Google Sheets, auto-decrease inventory when orders placed. Formulas stored in Google Drive — need to be added to costing system first.
5. Social proof videos
6. Google Search Console setup
7. Meta Business verification
8. Vegan/ingredient tagging on products

---

## Session Update: April 23, 2026

### Completed This Session
- Business Intelligence dashboard — auto-loads on tab click, top products fixed
- sendBroadcastEmail Firebase function — RESEND_API_KEY secret set, all functions redeployed
- Re-engagement broadcast — partially sent to 252 leads (do NOT resend)
- Niacinamide & Hyaluronic Serum — INCI corrected, peptide reference removed, prices updated J$13,000/J$50,000/J$225,000
- Body Care and Hair Care niches added to /start funnel with segmented WhatsApp messages
- TikTok link added to footer (@najahchemist)
- Google Costing System v5 built with 6 sheets: Database, Costing, Inventory, Dashboard, Production Log, Reorder Calculator, Formula Map
- Supplier landed costs added to Database (Niacinamide $40/kg, Tranexamic Acid $110/kg, Allantoin $40/kg, Hydroquinone $55/kg, Kojic Acid $43/kg, Salicylic Acid $35/kg, Snow White $60/kg, Hyaluronic Acid $125/kg, Beta Glucan $62/kg, SAP $102/kg — all USD landed cost)
- CallMeBot WhatsApp alerts set up (phone: 18768851099, API key: 9757849)
- Low stock WhatsApp alert — runs daily at 8am via Google Apps Script
- Receipt scanner — uploads PDF/image to Google Drive folder, Claude AI reads it, Database updates automatically every 30 mins. Folder ID: 16fTJEP2kp6Zixb1gRPJfrhphGs3dif-4
- Reorder Calculator sheet built — pulls from Inventory + Production Log, shows days of stock, reorder qty for 60-day cover
- Formula Map sheet started — 12 products mapped from formula files

### In Progress (incomplete — do next session)
- Formula review — going through each product formula at 1000g batch with Najah to verify/correct before building website inventory connection
- Products reviewed so far: NONE (usage limit hit before starting)
- After all formulas verified → add ingredient upgrade suggestions
- After formulas finalised → build website inventory connection (Firestore order → Google Sheets inventory decrease)

### Lead Conversion Structure (to build next session)
- Current: 252 leads, 2.4% conversion, all stuck at "New" stage in pipeline
- Need to build: lead status update system in admin (New → Contacted → Qualified → Quoted → Converted)
- Need to build: automated follow-up sequence based on lead status
- Need to build: WhatsApp follow-up templates per segment

### Pending TODO
1. Formula review — verify all product formulas at 1000g batch (IN PROGRESS)
2. Website inventory connection — after formulas confirmed
3. Lead conversion structure — status pipeline + follow-up system
4. Recommended retail prices on all product pages
5. Review all product page INCI lists for accuracy
6. Social proof videos
7. Google Search Console setup
8. Meta Business verification
9. Vegan/ingredient tagging on products

### Key Business Stats (April 20, 2026)
- AOV: J$17,991
- Revenue April: J$394,325
- Orders: 26
- Leads: 252
- Conversion rate: 2.4% (6 converted)
- Top client: Lisa Heath-combs — 5 orders, J$182,000
- Top products: Kojic & Turmeric Soap, Skincare Bundle, Girls Night In Bundle

### Google Sheets Costing System
- File: NajahChemist_Costing_System_v5.xlsx
- Google Drive ID (v4 latest uploaded): 1T3QEdlaO4UKfbeA-oVvmfqrOdp581JjT2g-HZXmTTs8
- Google Apps Script deployed with: checkLowStock (8am daily), checkForNewReceipts (every 30 mins), setup()
- Anthropic API key stored in Script Properties as ANTHROPIC_API_KEY
- Receipt folder: 16fTJEP2kp6Zixb1gRPJfrhphGs3dif-4
