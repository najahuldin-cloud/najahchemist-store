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
