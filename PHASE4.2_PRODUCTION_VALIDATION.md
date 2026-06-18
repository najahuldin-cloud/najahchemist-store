# Phase 4.2 — Production Validation

**Release:** Phase 4.2 — Validation Remediation (completes the Recommendation → Action → Outcome loop)
**Branch:** `phase4.2-validation-remediation`
**Commit:** `e48c55424d2b269ec4c6c2c8804a563924abad7a`
**Scope:** `jarvis.html` only (+137 / −26). No new features, collections, Cloud Functions, or Firestore rule changes.

---

## What this release does

- **Fix A** — Won/Lost leads are excluded from all 9 recommendation surfaces; pending leads stay (badged).
- **Fix B** — Won/Lost can be resolved inline on the action surface (no scrolling to Pending Outcomes).
- **Fix C** — resolvers write `outcome` + `executionStatus` (additive schema, no migration).
- **Fix D** — unresolved-outcomes alert (count, oldest, overdue, revenue awaiting).
- **Fix E** — pending outcomes age and flag "follow-up overdue" at ≥3 days.
- **Fix F** — audit only, no behavior change.

---

## Production validation checklist

Use a **never-purchased pending manufacturing lead** (e.g. Deona, Basilia Thompson, Amoy Smith, Timmoy, Ray, Ladania, Kimberly, Annika, Romona Henry). **Do NOT use Oneika** — she is an existing customer in reorder workflows.

Sign in at `/jarvis` as `start@najahchemist.com`, then:

- [ ] **1. Action a lead** — click the WhatsApp action on a recommendation card. A pending `jarvis_outcomes` record is created and the card swaps to `⏳ Actioned … awaiting outcome [Won] [Lost]`.
- [ ] **2. Pending alert appears** — `⚠ N unresolved outcomes` shows under Founder Focus with count, oldest, overdue, revenue awaiting.
- [ ] **3. Mark Won** — click **Won**, enter revenue/reason.
- [ ] **4. Lead disappears** from Founder Focus, Today's Top Actions, Top Opportunities, Lead Command Center.
- [ ] **5. Pending count −1** in both the alert and the Pending Outcomes section.
- [ ] **6. Leaderboard updates** — Jarvis Generated revenue rises; hit-rate recomputes.
- [ ] **7. Refresh persists** — click Refresh (or reload); the won lead stays excluded.
- [ ] **8. Mark Lost (separate lead)** — confirm a Lost lead is also removed from recommendations.
- [ ] **9. No duplicate pending** — re-open the dashboard next session; an already-pending lead shows the badge (no WhatsApp link) and cannot create a second pending record.

Record each run in the log below.

---

## Validation log

| Date | Lead | Action Taken | Pending Created | Won/Lost | Removed From Recommendations | Leaderboard Updated | Notes |
|------|------|--------------|-----------------|----------|------------------------------|---------------------|-------|
|      |      |              |                 |          |                              |                     |       |

---

## Rollback

**Before merge/deploy (current state):** nothing is live.
- Abandon: `git checkout main && git branch -D phase4.2-validation-remediation` (also delete remote branch on GitHub if desired).

**After deploy (for reference):**
- Git: `git revert e48c554` then redeploy, **or**
- Netlify dashboard → site `najahchemist` → Deploys → select previous ready deploy (commit `97fa887`) → **Publish deploy** (instant, no code change).
