# DEPLOY_PHASE4.md — Jarvis Phase 4 Deployment Runbook

Audience: anyone, even unfamiliar with this project. Phase 4 ships the decision-first
Jarvis dashboard at **`/jarvis`** (admin-only page). It is **read-only** — it reads the
`lead_intelligence` Firestore collection and renders cards. It writes no lead data.

- **Repo:** najahuldin-cloud/najahchemist-store · **Branch for this release:** `phase4-jarvis-ui`
- **Hosting:** Netlify (auto-deploys when `main` is pushed). **Firebase project:** `najah-chemist`
- **Page:** https://najahchemistja.com/jarvis (redirects to `/admin.html` unless signed in as `start@najahchemist.com`)

---

## 1. Pre-deployment checklist
- [ ] On branch `phase4-jarvis-ui`; `git diff --cached --name-only` shows exactly the 27 Phase 4 files (see PHASE4_COMPLETION.md / commit-prep).
- [ ] `git status` shows NO snapshot, service-account, or unrelated storefront file staged.
- [ ] Firestore rules already permit admin reads of `lead_intelligence` (verified live ruleset `1bbd5f93…`, `allow read: if request.auth != null`). No rules deploy needed.
- [ ] Fresh backup exists: `node scripts/backup-lead-intelligence.js` (writes a local snapshot only).
- [ ] Offline gates green: `node scripts/test-v4-scoring.js` (30/30), `node scripts/reconcile-honest-pipeline.js` (UI = audit).

## 2. Deployment steps
1. Merge `phase4-jarvis-ui` → `main` (PR or fast-forward).
2. `git push origin main` → **Netlify auto-builds and deploys** (atomic; static file swap).
   - `jarvis.html` is NOT in `inject-env.js` FILES → the build does not modify it.
3. (Optional, deferred) Cloud Functions stay v3; do NOT deploy v4 functions unless explicitly decided. `DAILY_WRITE_ENABLED=false` means the daily job writes nothing regardless.

## 3. Verification steps (right after deploy)
1. Open https://najahchemistja.com/jarvis and sign in as `start@najahchemist.com`.
2. Confirm cards render: Founder Focus, Today's Money, Top Actions, Next 15, Revenue Target, Revenue at Risk, Money Missed, Honest Pipeline, Top Opportunities, Lead Command Center, Revenue by Offer.
3. Confirm **Honest Pipeline ≈ J$10,143,353** (matches the audit baseline) and the inflation banner shows ~27.4%.
4. Open browser console → no errors; the `[Jarvis] lead_intelligence loaded: N` log appears (N≈606).
5. Click 🔄 Refresh → page re-pulls and re-renders.
6. Open on a phone (or 390px) → cards stack to one readable column.

## 4. Rollback steps (planned)
- **Fastest (UI):** Netlify dashboard → Deploys → previous build → **"Publish deploy"** (instant, 1-click).
- **Via git:** `git revert <commit-sha> && git push origin main`.
- **No data rollback needed** — the page writes no lead data. (For lead_intelligence data, `node scripts/rollback-lead-intelligence.js --commit` restores the latest snapshot, but Phase 4 deploy does not touch data.)

## 5. Emergency rollback / kill (under 60 seconds)
Goal: stop anything autonomous immediately. See KILL-SWITCH below.
1. **Disable scoring agents (fastest):** Firebase Console → Firestore → `agent_controls/global` → set field `killSwitch.leadAgent = true`. (~30s. Fail-safe: if controls can't be read, agents are treated as killed.)
2. **Pull the dashboard:** Netlify → Deploys → publish a prior build without `/jarvis` (or Netlify → Site → "Stop auto publishing"). The page is admin-gated + read-only, so this is rarely urgent.
3. **Disable functions (if ever deployed):** `firebase functions:delete scoreLeadsDaily scoreLeadsBackfill --project najah-chemist`.
4. **Writes:** already OFF — `DAILY_WRITE_ENABLED=false` (compile-time). No runtime writes occur.

## 6. Post-deployment validation (Day 0)
- Founder can answer the 5 questions in <30s (Founder Test).
- No console errors over a normal session.
- Firestore read volume looks sane (one `lead_intelligence` read per load/refresh).

## 7. Success criteria (deploy is "good")
- Page renders for the admin with zero errors.
- Honest Pipeline value matches the audit baseline (J$10,143,353 on 2026-06-12 data).
- Test/duplicate leads do NOT appear in any ranking.
- Founder Test passes; mobile usable; refresh works.
- No increase in storefront/admin/ checkout errors (Phase 4 touches none of them).
