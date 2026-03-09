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
