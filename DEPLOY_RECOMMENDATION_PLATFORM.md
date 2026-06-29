# Recommendation Platform — Production Deployment Package

**Scope:** ship Phases A–E (Recommendation Platform read-model + backend) to production, backfill, verify, then enter a multi-day **Observation Mode**. **No new functionality.** Legacy recommendation code stays until all validation passes. Reconciler stays in **SHADOW** (`RECONCILE_LIVE_ENABLED=false`).

Project: **`najah-chemist`** (always pass `--project najah-chemist`). Run all `firebase`/`node` commands from the repo root: `C:\Users\najah\Downloads\najahchemist-store`.

> ⚠️ **Two items need your explicit confirmation before running** (Constitution: never auto-deploy / auto-modify rules): (1) the `firestore.rules` change, (2) the Netlify site id — `.netlify/state.json` says `8953c5f0-e6e1-4942-ad4b-eb473e4deb57` but memory recorded `21afb9a7-…`. **Confirm which is the `najahchemistja.com` production site, or use the git-push path below which sidesteps the id.**

---

## A. Pre-deployment

### A1. What this deploy writes (affected collections)
| Collection | Effect | Snapshot needed? |
|---|---|---|
| `recommendations` | **new** — created by backfill/sync | No (rollback = delete collection) |
| `recommendation_resolution_proposals` | **new** — function-written (shadow) | No |
| `recommendation_integrity_reports` | **new** — function-written | No |
| `jarvis_outcomes` | **appended** — manual Won/Lost mirror a row here | **Yes — snapshot** |
| `lead_intelligence`, `leads` | read-only by this deploy (unchanged) | Optional reference snapshot |

### A2. Snapshot commands (run BEFORE any live write)
**Reference snapshot (existing tool, read-only, no code):**
```bash
node scripts/backup-lead-intelligence.js
# → writes scripts/_snapshots/lead-intelligence-snapshot-<ts>.json (leads + lead_intelligence)
```
**`jarvis_outcomes` snapshot — pick ONE (both are no-code):**
```bash
# Option 1 — managed export to GCS (preferred; needs gcloud + a bucket)
gcloud firestore export gs://najah-chemist-backups/rec-platform-$(date +%Y%m%d) \
  --collection-ids=jarvis_outcomes --project najah-chemist
```
```text
# Option 2 — Firebase console (manual, zero setup)
Firebase Console → Firestore → (⋮) Import/Export → Export →
  collection: jarvis_outcomes → destination bucket → Export
```
**Pass gate:** snapshot file/export exists and is non-empty. Record its path/URI here: `__________`.

### A3. Deployment order (and why)
1. **Firestore rules** — must precede the UI cutover, or the dashboard's `recommendations` read is denied. (If it *does* land late, the UI safely falls back to legacy — no breakage.)
2. **Cloud Functions** — publishes the platform services + the `onOrderCreated` reconcile hook. Safe before backfill (schedulers just have nothing to do yet).
3. **Netlify (jarvis.html)** — the read-model cutover. Until records exist it auto-falls-back to legacy, so order vs. backfill is not fragile.
4. **Backfill (dry-run → live)** — populates `recommendations` so the platform becomes `AUTHORITATIVE`.
5. **Sync** — mints records for any active leads the backfill didn't cover.
6. **Integrity scan** — first watchdog baseline.

### A4. Expected time & impact
| Step | Time | Downtime | User impact |
|---|---|---|---|
| Snapshot | 1–3 min | none | none |
| Rules | ~10–30 s | none | none |
| Functions (5 fns) | ~3–6 min | none (atomic swap) | none |
| Netlify | ~2–4 min | none (atomic publish) | none |
| Backfill + sync + integrity | <2 min total | none | none |
| **Total active** | **~15–25 min** | **none** | **none for customers; founder dashboard unaffected until records exist, then improved** |

There is **no downtime** and **no customer impact** (storefront/order flow untouched). The cutover is fail-safe: empty/denied `recommendations` ⇒ legacy path.

---

## B. Deployment — exact commands

> Pre-req once per machine: `firebase login` (token must be fresh — `firebase projects:list` to refresh).

### 1. Firestore Rules
```bash
firebase deploy --only firestore:rules --project najah-chemist
```

### 2. Cloud Functions (targeted — only new/changed)
```bash
firebase deploy --only "functions:syncRecommendations,functions:reconcileRecommendations,functions:recommendationIntegrityScan,functions:recommendationOps,functions:onOrderCreated" --project najah-chemist
```

### 3. Netlify deployment (jarvis.html cutover)
**Primary — git push to the deploy branch (recommended; avoids site-id ambiguity):**
```bash
git add jarvis.html firestore.rules functions/ DEPLOY_RECOMMENDATION_PLATFORM.md
git commit -m "Recommendation Platform: Phase A–E backend + dashboard read-model cutover

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git checkout main && git merge --no-ff phase4.8-executive-intelligence
git push origin main        # → triggers Netlify auto-build & atomic publish
```
**Alternative — Netlify CLI (confirm the site id first):**
```bash
# Verify which site serves najahchemistja.com, then:
netlify deploy --site 8953c5f0-e6e1-4942-ad4b-eb473e4deb57 --dir . --prod
# NOTE: the build runs node inject-env.js (dirties index/admin/etc with real secrets).
# jarvis.html is intentionally NOT in inject-env's FILES array, so it is untouched.
# Restore placeholders before committing (see inject-env deploy-quirk note).
```

### 4–7. Backfill / Sync / Integrity (admin-only callable `recommendationOps`)
**Primary — functions:shell (no browser; uses prod admin creds + simulated admin auth):**
```bash
GOOGLE_APPLICATION_CREDENTIALS=prod-service-account.json firebase functions:shell --project najah-chemist
```
Then inside the shell, run in order, **reviewing output between each**:
```js
// 4. Backfill (DRY-RUN) — writes nothing; returns {wouldWrite, generated, waiting, won, lost, skipped}
recommendationOps({op:'backfill', dryRun:true}, {auth:{token:{email:'start@najahchemist.com'}}})

// 5. Backfill (LIVE) — only after the dry-run counts look right
recommendationOps({op:'backfill', dryRun:false}, {auth:{token:{email:'start@najahchemist.com'}}})

// 6. Sync — mint/refresh records for active leads not covered by backfill
recommendationOps({op:'sync', dryRun:false}, {auth:{token:{email:'start@najahchemist.com'}}})

// 7. Integrity scan — first watchdog baseline → recommendation_integrity_reports
recommendationOps({op:'integrity'}, {auth:{token:{email:'start@najahchemist.com'}}})
```
**Alternative — from the Jarvis dashboard browser console (already authed as the admin):**
```js
const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js');
const { getApp } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
const fns = getFunctions(getApp());
const call = (op, dryRun) => httpsCallable(fns,'recommendationOps')({op, dryRun}).then(r=>console.log(op, r.data));
await call('backfill', true);    // dry-run → review
await call('backfill', false);   // live
await call('sync', false);
await call('integrity');
```

---

## C. Production verification checklist

> Surfaces with a UI today: Founder Focus, Today's Top Actions, Pending Outcomes, manual Won/Lost/Snooze. Items marked **(console)** are verified in the **Firebase console** or **browser console** because no dedicated UI panel exists yet (those — History view, Health dashboard, Watchdog UI — arrive with the Self-Healing service).

| # | Check | How | Pass criteria |
|---|---|---|---|
| 1 | Records created | Firestore `recommendations` count **(console)** | ≥1; ≈ honest active leads (+ resolved from backfill) |
| 2 | Permanent Rec IDs | Inspect a record id **(console)** | Matches `REC-XXXXXX-YYYYMMDD-TC-XXXX` (4-char suffix); **unchanged on reload/next day** |
| 3 | Founder Focus reads records | Reload Jarvis; console log | `recommendations loaded: N (platform AUTHORITATIVE)`; the pick shows the permanent ID |
| 4 | Today's Top Actions reads records | Visual | Same leads as before; converted-customers absent; IDs are permanent-format |
| 5 | Pending Outcomes reads records | Visual + **(console)** | Items correspond to records in `WaitingForCustomer`/`AutomationRunning`/`CustomerResponded` |
| 6 | Recommendation History reads records | `recommendations` where state∈{Won,Lost} **(console)** | Resolved backfill records present (no dedicated UI panel yet) |
| 7 | Manual **Won** | Click Won on a card → confirm | Record → `state:Won`, `resolvedBy:founder`, `actualRevenue` set; leaves active queue; `jarvis_outcomes` mirror row exists |
| 8 | Manual **Lost** | Click Lost | Record → `state:Lost`; leaves queue; mirror row exists |
| 9 | **Snooze** | Click Snooze | Record → `state:Snoozed` + `snoozeUntil`; drops from queue |
| 10 | Recommendation Timeline | Founder Focus card | Communication timeline renders from record/lead data |
| 11 | Recommendation Event History | `recommendations/<id>.history[]` **(console)** | Append-only entries `{at,from,to,reason,actor}` for each transition |
| 12 | Recommendation Health (per-rec) | `state` + age **(console)** | No active record stuck past expiry without an Expired/Superseded transition |
| 13 | Recommendation Platform Health | `recommendation_integrity_reports` latest **(console)** | `total` violations within expectation; `critical`=0 |
| 14 | Recommendation Watchdog | Run `recommendationOps({op:'integrity'})` | Report written; summary returned |
| 15 | Integrity reports | `recommendation_integrity_reports` **(console)** | A document exists with `summary`,`violations[]`,`scannedAt` |
| 16 | Resolution Proposals | `recommendation_resolution_proposals` **(console)** | (After a qualifying paid order) a doc with `mode:'shadow'` |
| 17 | Reconciliation (Shadow) | Place/verify a paid order for a matched lead | Proposal written; **NO** auto-Won; rec **not** auto-transitioned; no `auto-order-match` row in `jarvis_outcomes` |
| 18 | No duplicate recommendations | Integrity report | `summary.duplicate` = 0 (or each explained) |
| 19 | No completed orders in active queues | Integrity report | `summary['completed-order-still-active']` = **0** |
| 20 | No legacy code paths executing | Browser console: `PLATFORM_READY()` & `RECS.length` | `true` and `>0`; IDs carry the 4-char suffix (legacy IDs had none) |
| 21 | Replay Mode | `🎬 Recommendation Replay` → pick a resolved rec | Full lifecycle replays from `history[]` (timestamp/actor/source/eventType/from→to/data); order matches reality |
| 22 | Time Machine | Drag the Time Machine slider on a rec | "What Jarvis knew" shows the state + only the data known up to that event; later events dimmed; nothing fabricated |
| 23 | Enriched event schema | Inspect a fresh `history[]` entry **(console)** | New entries carry `eventType`/`source`/`data` (old entries gracefully show "—") |

### C2. Performance & cost checks (Jarvis is growing — verify it stays fast AND cheap)
| Metric | How | Pass criteria |
|---|---|---|
| Recommendation query time | Browser DevTools → Network → `recommendations` getDocs | < 1.5 s at current volume |
| Founder Focus render time | `performance.now()` around `renderFounderFocus()` (console) | < 300 ms |
| Dashboard load time | DevTools → Performance → load→interactive | < 4 s |
| Recommendation generation time | `[syncRecommendations]` log run duration | < 30 s |
| Cloud Function execution time | GCP/Firebase Functions metrics (sync/reconcile/integrity) | each run < 60 s; **no timeouts** |
| Firestore reads/writes per run | Functions metrics / Firestore usage | within expectation (sync ≈ leads+intel+recs reads) |
| Firestore cost | Firebase Console → Usage | **no step-change** vs the pre-deploy baseline |
| Cloud Function errors | Functions logs | **0 errors** |
| Retry rates | Functions metrics | ~0 retries |

**Record the pre-deploy baseline** (reads/writes/cost for a normal day) so the above are comparisons, not guesses.

---

## D. Success criteria (measurable pass/fail)

Deployment is **successful** only if **all** hold:
- **S1** `recommendations` count > 0 and within ±10% of honest active leads (active records) — else investigate sync. *(pass/fail)*
- **S2** Integrity: `missing-id = 0`, `completed-order-still-active = 0`, `critical = 0`. *(fail = block)*
- **S3** Permanent IDs: a sampled card's Rec ID is **identical** after a reload (and next day). *(pass/fail)*
- **S4** Console shows `platform AUTHORITATIVE`; **0** uncaught console errors on load. *(pass/fail)*
- **S5** Manual Won + Lost + Snooze each transition the record (state + `history[]` entry) and remove it from the active queue. *(pass/fail)*
- **S6** Shadow reconciliation: at least the next qualifying paid order produces a **proposal** and **0** automatic ledger conversions. *(pass/fail)*
- **S7** No customer-facing regression: storefront loads, checkout/order create works. *(pass/fail)*

**Any S1–S7 fail → do not proceed; execute rollback (Section E).**

---

## E. Rollback (exact)

The cutover is fail-safe (empty/denied `recommendations` ⇒ legacy). Roll back the smallest layer that failed.

**Instant UI mitigation (returns dashboard to legacy, no redeploy):**
```bash
firebase firestore:delete recommendations --recursive --project najah-chemist --force
# RECS empty ⇒ PLATFORM_READY()=false ⇒ legacy path resumes on next dashboard load.
```
**Roll back jarvis.html (UI):** Netlify → *Deploys* → previous deploy → **Publish deploy**; or `git revert <commit> && git push origin main`.

**Roll back rules:**
```bash
git checkout HEAD~1 -- firestore.rules
firebase deploy --only firestore:rules --project najah-chemist
```
**Roll back functions:**
```bash
git checkout HEAD~1 -- functions/
firebase deploy --only "functions:onOrderCreated" --project najah-chemist
firebase functions:delete syncRecommendations reconcileRecommendations recommendationIntegrityScan recommendationOps --project najah-chemist --force
```
**Purge platform data (full reset):**
```bash
firebase firestore:delete recommendations --recursive --project najah-chemist --force
firebase firestore:delete recommendation_resolution_proposals --recursive --project najah-chemist --force
firebase firestore:delete recommendation_integrity_reports --recursive --project najah-chemist --force
```
**`jarvis_outcomes`:** manual-test rows added during verification carry `source:'jarvis-dashboard'`/`resolvedBy:'founder'` with today's date — delete those few, or restore from the A2 snapshot if needed.

---

## F. Observation Mode — actively hunt for problems from Day 0

**No new features. No legacy removal. Reconciler stays SHADOW.** This is an *active* 7-day program, not passive waiting — you are looking for issues from the first hour. The **Recommendation Command Center** (the `🩺 Recommendation Platform Health` section in Jarvis) is the live instrument for all of this.

### Day 0 — Technical validation (does everything work?)
Run the full **Section C** checklist (correctness #1–20) **and Section C2** (performance/cost). Confirm **S1–S7**. Command Center shows **🟢 Healthy**, Health Score ≥ 95%, Integrity Errors = 0. *Gate: do not continue if any S-criterion fails → roll back.*

### Days 1–3 — Shadow reconciliation & integrity monitoring
Daily: review every new `recommendation_resolution_proposals` entry against the real order — mark match correct/incorrect, note method + confidence + `revenueVariance`. Run the integrity scan daily; watch the violation trend. Confirm **0** auto-Won writes (shadow holds). Watch function durations/errors/cost for drift.

### Days 4–7 — Business validation (does the *business* work?)
Use the platform for real daily work. Track the **business KPIs** below from the Command Center. Confirm recommendations reflect reality (right customers, right order, right state), founder actions transition records cleanly, and shadow matches keep being correct on live orders.

### After 7 days — Live Reconciliation decision
Enable Live Reconciliation **only if** shadow match accuracy is high on real orders, integrity is clean, and performance/cost are stable. Otherwise extend observation.

### Signals to record daily
| Signal | Where | Record |
|---|---|---|
| Recommendation creation/transitions | `[syncRecommendations]` logs; `recommendations/*.history[]` | counts; any illegal-transition warnings |
| Reconciliation accuracy | `recommendation_resolution_proposals` | per proposal: correct? method, confidence, variance |
| Watchdog / integrity | `[recommendationIntegrityScan]` logs; `recommendation_integrity_reports` | violation types + trend |
| Performance & cost | Functions metrics; Command Center; Firestore usage | durations, timeouts, reads/writes, cost vs baseline |
| Errors / retries | Functions logs + browser console | any uncaught error / retry |

### Business KPIs (the operational scorecard — surfaced in the Command Center)
Total Recommendations · Active Recommendations · Won today · Lost today · Shadow Reconciliation accuracy · Recommendation acceptance rate · Founder response time · Average time to Won · Average recommendation lifetime · Revenue captured · Revenue attributed · Revenue missed · Duplicate-prevention rate · Recommendation resolution rate.

```bash
# Handy daily log pulls
firebase functions:log --only syncRecommendations,reconcileRecommendations,recommendationIntegrityScan --project najah-chemist
```

**Exit criteria:** S1–S7 held all 7 days; shadow match accuracy high on real orders; no unexplained/critical integrity violations; no error/performance/cost regressions; business KPIs are sane and trending right.

---

## G. Recommendation Platform v1 — Certified (not frozen)

Once stability is confirmed, the platform is declared **v1 Certified**: a **stable API, stable data model, and stable lifecycle** that future AI agents may *extend* but **must not break compatibility** with. Certified ≠ frozen — improvements are welcome; backward-incompatible changes are not.

**v1 contract (must remain stable):** permanent `recommendationId` format; the canonical `state` enum + legal transitions; the `recommendations` record shape (read-model fields); append-only `history[]`; the `jarvis_outcomes` resolution-mirror; the matching-service interface; the integrity-report + proposal schemas.

No new AI capabilities until v1 is certified. Legacy recommendation code **remains** until all validation passes. Then, in this order (the agreed roadmap):
1. **Recommendation Platform Stabilization** (this package) → certify v1.
2. **Remove legacy** recommendation code + **Enable Live Reconciliation** (`RECONCILE_LIVE_ENABLED=true`).
3. **Recommendation Watchdog Self-Healing Engine**.
4. **Learning Engine (Shadow → Production)** — staged, advisory-first, explainable, reversible.
5. **Demand Hunter** — *elevated ahead of AI Sales* (market/trend intelligence feeds product+marketing+sales at once).
6. **AI Sales Agent** · 7. **AI Marketing Agent** · 8. **Customer Success AI** · 9. **Executive Orchestrator**.

Future agents plug into the certified v1 services rather than re-implementing logic. Correctness, traceability, and stability take priority over new functionality.
