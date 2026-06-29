# Jarvis Recommendation Platform — Operations Manual (v1)

**Audience:** Najah (founder/operator), not developers. This is how you *run* the Recommendation Platform day to day, what "healthy" looks like, and what to do when something goes wrong.

**Your two instruments:**
1. **Command Center** — the `🩺 Recommendation Platform Health` panel at the top of **najahchemistja.com/jarvis** (log in as `start@najahchemist.com`). Everything below can be read here.
2. **Admin operations** — the `recommendationOps` action (run via `firebase functions:shell` or the browser console — exact commands in `DEPLOY_RECOMMENDATION_PLATFORM.md` §B4–7). Ops: `sync`, `reconcile`, `integrity`, `backfill`.

**Your emergency brake:** Firebase Console → Firestore → `agent_controls/global` → set `killSwitch.recommendationAgent = true`. This stops all platform background jobs within seconds (the dashboard keeps working, read-only). Set back to `false` to resume.

---

## Daily Operations

### Every morning (2 minutes)
Open `/jarvis` → look at the Command Center:
1. **Health badge** — is it 🟢 Healthy? (🟡/🔴 → see Incident Response.)
2. **Integrity Errors = 0** and **Completed-in-queue = 0**. (Anything else → Incident Response.)
3. **Founder Focus** shows a sensible #1 action for a real customer.
4. **Waiting Customer** and **Pending** aren't ballooning unexpectedly.
5. Skim **Today's Top Actions** — do the top few make business sense?

Then do the work: action the top recommendations (WhatsApp/Email/Call), and mark **Won/Lost** as outcomes land.

### Every evening (2 minutes)
1. Did today's top actions get **actioned**? (Founder Focus / Pending should reflect it.)
2. Resolve anything that closed today — **Won** (with the real amount) or **Lost**.
3. **Won today / Lost today** on the Command Center match your day.
4. No new **Integrity Errors** appeared.
5. (During Observation) glance at **Shadow Matches** / **Review Required** — note any that look wrong.

### KPIs that matter most (daily)
- **Platform Health Score** (overall trust signal)
- **Integrity Errors** + **Completed-in-queue** (must stay 0)
- **Won today** + **Revenue captured**
- **Waiting Customer** (is follow-up keeping pace?)
- Any **🔴 tile**

---

## Weekly Operations (15 minutes)
- **Platform Health review** — Health Score trend across the week; any day it dipped and why.
- **Integrity review** — run `recommendationOps({op:'integrity'})`; compare the violation summary to last week. Duplicates/orphans should be 0; investigate any new type.
- **Recommendation aging** — how many active recs are >14 days old with no movement? These are the "Expired/Superseded soon" set; clear or let them age out.
- **Shadow reconciliation review** — for each `recommendation_resolution_proposals` entry this week, confirm the match was correct (right customer, right order). Tally an accuracy % — this is the gate for enabling Live Reconciliation.
- **Revenue attribution review** — Revenue captured vs attributed (Won w/ order link); does it reflect reality?
- **Performance review** — function durations/errors and Firestore cost vs the pre-deploy baseline (no step-changes).
- **Watchdog review** — read the latest `recommendation_integrity_reports`; confirm nothing critical lingering.

---

## Monthly Operations (30 minutes)
- **Recommendation success trends** — Won/Lost, resolution rate, avg time-to-Won over the month.
- **Integrity trends** — are violations trending to zero and staying there?
- **Performance trends** — durations/cost stable as lead/order volume grows?
- **Revenue trends** — captured/attributed/missed month over month.
- **Learning readiness** — how many *resolved* recommendations (Won+Lost) exist? The Learning Engine needs a meaningful resolved history before its shadow phase is worth starting (rule of thumb: dozens+ per recommendation type).
- **Platform certification review** — are C1–C8 (see Certification) still holding? Re-affirm or note regressions.

---

## Incident Response

> First instinct for anything scary: it's safe to pull the **emergency brake** (`killSwitch.recommendationAgent=true`) and/or roll back the UI (delete `recommendations` ⇒ dashboard reverts to the legacy path). Neither touches customer data or the storefront.

**Recommendations stop generating** (Active count flat/empty, no new records)
1. Check `firebase functions:log --only syncRecommendations` for errors.
2. Confirm the kill switch is **off** (`agent_controls/global.killSwitch.recommendationAgent` ≠ true).
3. Confirm the upstream scorer ran (`lead_intelligence` freshness; `leadAgent` not killed).
4. Manually run `recommendationOps({op:'sync', dryRun:false})`; watch the result counts.

**Recommendations duplicate** (Command Center "Duplicate Recs" > 0)
1. Run `recommendationOps({op:'integrity'})` → note the `duplicate` entries (lead+type).
2. In v1, resolve by hand: mark the extra rec **Lost**/**Snooze**, or let supersession age it out.
3. Record it — duplicates should be rare; a pattern signals a sync bug for the next dev cycle. (Self-Healing will auto-dedupe in a later phase.)

**Recommendation IDs fail** (Command Center "Integrity Errors" includes `missing-id`)
1. Run integrity scan; identify the affected records.
2. These came from a bad write — **do not edit IDs**. Mark affected recs terminal and re-run `sync` to mint clean ones. Escalate to a dev if it recurs.

**Reconciliation fails** (paid orders not producing proposals)
1. `firebase functions:log --only reconcileRecommendations` for errors.
2. Confirm the order is **paid** and dated **on/after** the recommendation (the qualifying rule).
3. Check the match: shared email/phone can make it **Review Required** rather than auto. Look in `recommendation_resolution_proposals` for a `review-required` entry.
4. Manually run `recommendationOps({op:'reconcile'})`.

**Shadow accuracy drops** (matches look wrong during Observation)
1. **Do NOT enable Live Reconciliation.** Keep `RECONCILE_LIVE_ENABLED=false`.
2. Log the wrong matches (which method/confidence). A pattern (e.g. name+phone false positives) is tuning input for the matching thresholds — hand to a dev before going live.

**Watchdog reports Critical** (`critical` > 0; usually `missing-id` or `completed-order-still-active`)
1. `completed-order-still-active` means a paid customer is still an open rec → mark it **Won** immediately (attach the amount).
2. `missing-id` → handle as "IDs fail" above.
3. If many at once, pull the emergency brake and call a dev.

**Platform Health turns Red** (Score < 80)
1. Read which violations drove it (Command Center + integrity report).
2. Clear the criticals first (above). Re-run integrity to recompute the score.
3. If it won't recover, roll back the UI (delete `recommendations` ⇒ legacy) and escalate.

**Recommendation queues disagree** (Founder Focus vs Pending vs History show conflicting state)
1. Hard-refresh `/jarvis` (the dashboard rebuilds from records on load).
2. Run `recommendationOps({op:'integrity'})` — disagreement implies a record in an unexpected state.
3. If it persists, it indicates a read-model bug → roll back to legacy and escalate. (By design there is only one state per record, so true disagreement should be impossible once records are correct.)

---

## Maintenance

- **Backups** — before any live write/upgrade, snapshot per `DEPLOY_RECOMMENDATION_PLATFORM.md` §A2 (`jarvis_outcomes` export; reference `lead_intelligence` via `scripts/backup-lead-intelligence.js`). New platform collections need no snapshot (rollback = delete).
- **Restore / rollback** — runbook §E. The instant, safe move is deleting the `recommendations` collection: the dashboard auto-reverts to the legacy path with no redeploy. Full reset purges the three platform collections.
- **Rollback of code** — rules/functions via `git checkout` + redeploy; UI via Netlify "Publish previous deploy."
- **Platform upgrades** — never hand-edit records. Ship changes as code (functions/rules/jarvis.html) following the deploy order; snapshot first; verify with the checklist; keep the kill switch handy.

---

## Health Thresholds

| KPI | 🟢 Green | 🟡 Yellow | 🔴 Red |
|---|---|---|---|
| Platform Health Score | ≥ 95 | 80–94 | < 80 |
| Integrity Errors (critical) | 0 | — | ≥ 1 |
| Completed-order-still-active | 0 | — | ≥ 1 |
| Duplicate / Orphan recs | 0 | 1–2 | ≥ 3 |
| Oldest pending (Waiting Customer) | ≤ 7 days | 8–21 days | > 21 days (auto-Expire) |
| Shadow match accuracy (Observation) | ≥ 90% | 75–89% | < 75% → do not go live |
| Cloud Function errors / timeouts | 0 | rare/transient | recurring |
| Firestore cost vs baseline | flat | mild rise | step-change |
| Founder response time | < 24 h | 1–3 days | > 3 days |
| Resolution rate (resolved/total) | rising | flat | falling |

> Calibrate the business KPIs (response time, resolution rate) against your real baseline after the first weeks — the starting bands are guidelines, not laws. The integrity/health bands are firm.

---

## Observation Procedures (post-deploy)
Run the active program in `DEPLOY_RECOMMENDATION_PLATFORM.md` §F:
- **Day 0** — technical validation (checklist #1–23, S1–S7). Health 🟢, Integrity 0.
- **Days 1–3** — review every shadow proposal vs the real order; daily integrity scan; confirm **0** auto-Won writes.
- **Days 4–7** — use it for real work; track the business KPIs from the Command Center.
- **After 7 days** — decide on Live Reconciliation (only if shadow accuracy 🟢 and integrity clean).

Each day: Command Center screenshot/notes + the daily log pull (`firebase functions:log --only syncRecommendations,reconcileRecommendations,recommendationIntegrityScan`).

---

## Certification Procedures (how v1 becomes officially Certified)
Certify when **C1–C8** (architecture spec §15) hold through the observation window:
C1 records authoritative + permanent IDs · C2 integrity criticals = 0 · C3 all surfaces agree · C4 manual Won/Lost/Snooze transition records · C5 shadow accuracy high, 0 auto-Won while shadow · C6 performance/cost stable, no regression · C7 legacy path removed (after C1–C6) · C8 this doc + the architecture spec match reality.

**On certification, in order:** (1) remove the legacy recommendation code (one path only); (2) enable **Live Reconciliation** (`RECONCILE_LIVE_ENABLED=true`, redeploy). Record the certification date + who signed off. Then begin the next phase.

---

## Future Upgrade Procedures (v1 → v2 without breaking compatibility)
The v1 contract is stable: **permanent ID format, the `state` enum + legal transitions, the record read-model fields, the append-only `history[]`/event schema, the matching interface, and the report/proposal schemas.** To evolve:
- **Additive only** — new states/event-types/fields are fine; never repurpose or remove existing ones.
- **Feature-flagged** — every new behavior behind its own flag, reversible.
- **Shadow-first** — anything consequential (auto-actions, learning-driven changes) runs in shadow and is measured before it influences production.
- **Never** rewrite history, regenerate IDs, overwrite manual decisions, or let the dashboard recompute state.
- **Version this doc + the architecture spec** when the contract is extended; bump to v2 only when a genuinely new contract is introduced (with a migration + compatibility plan).

---

## Roadmap (operational sequence)
1. ✅ **Recommendation Platform** — deploy → validate → observe → **certify v1** (you are here)
2. **Self-Healing Watchdog** — automated repairs + escalation
3. **Learning Engine (Shadow → Production)** — advisory-first, staged, explainable, reversible
4. **Demand Hunter** — *elevated ahead of AI Sales* (market/trend intelligence: trending ingredients, new-product & underserved-niche opportunities, search trends, competitor & pricing moves — feeds product, marketing, and sales at once)
5. AI Sales Agent
6. AI Marketing Agent
7. Customer Success AI
8. Executive Orchestrator

Each plugs into the certified v1 platform via the §13 extension contract — read the read-model, act through the interfaces, emit events — without modifying platform internals.

---

*Companion documents:* `RECOMMENDATION_PLATFORM_V1_ARCHITECTURE.md` (the spec), `DEPLOY_RECOMMENDATION_PLATFORM.md` (deploy/rollback/observation), Jarvis Constitution in `CLAUDE.md` (governance).
