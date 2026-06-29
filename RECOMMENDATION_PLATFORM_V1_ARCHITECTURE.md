# Recommendation Platform — v1 Architecture Specification

**Status:** architecturally complete, pending production validation. This is the permanent technical reference for Recommendation Platform v1. Future systems **extend** this architecture; they do not redesign it. Last updated 2026-06-29.

> Honesty markers used throughout: **[v1]** built & in this release · **[SHADOW]** built but gated off in production · **[v1.x]** designated extension point, not yet built.

---

## 1. Purpose

The Recommendation Platform is the **single source of truth** for "what should the founder do next, for whom, why, and what happened." It exists because recommendation *state* was previously recomputed independently by the dashboard on every render, which caused drift, date-changing IDs, and converted customers lingering in active queues (orders and recommendations lived in disconnected universes).

**Business problems it solves:**
- **Correctness** — a customer who has paid never remains an open recommendation (reconciliation closes the loop from objective order evidence).
- **Traceability** — every recommendation has a permanent ID and an append-only event history from creation to archive.
- **Trust** — the dashboard *reads* recommendation state; it never invents it, eliminating frontend/backend drift.
- **Leverage** — future AI agents (Sales, Marketing, Demand Hunter, Learning, …) plug into one shared lifecycle/matching/learning substrate instead of re-implementing it.

**Why single source of truth:** with one canonical `state` per recommendation and one identity, every surface (Founder Focus, Today's Top Actions, Pending Outcomes, History, Learning, Command Center) agrees by construction.

---

## 2. System Architecture

```
                 leads (public funnel)        orders (storefront)
                      │                              │
                      ▼                              │
        Lead Intelligence Engine  (lead-agent)       │
            scoreLeadsDaily → lead_intelligence       │
                      │                              │
                      ▼                              │
        ┌─────────────────────────────────────┐     │
        │      RECOMMENDATION PLATFORM         │     │
        │  recommendation-agent (backend)      │     │
        │   • syncRecommendations (generate)   │     │
        │   • Matching Engine (_shared/identity)│◄────┘  (reconcile orders→recs)
        │   • reconcileRecommendations [SHADOW]│
        │   • recommendationIntegrityScan      │
        │  collection: recommendations         │
        └─────────────────────────────────────┘
                      │ (read-model)
                      ▼
        jarvis.html  (declarative dashboard)
           Founder Focus · Today's Top Actions · Pending ·
           Command Center · Replay · Time Machine
                      │
            ┌─────────┴─────────┐
            ▼                   ▼
         Founder             Customer
            │                   │
            ▼                   ▼
        action (WhatsApp/Email/Call)   reply / Order → Payment
            │                   │
            └─────────┬─────────┘
                      ▼
                  Revenue  →  jarvis_outcomes (resolution ledger)
                      │
                      ▼
              Learning Engine  [v1.x — shadow first]
```

**Component ownership**
| Component | Code | Role |
|---|---|---|
| Lead Intelligence Engine | `functions/agents/lead-agent/` | scores leads → `lead_intelligence` (input; unchanged by this platform) |
| Recommendation model | `functions/agents/_shared/recommendation-model.js` | IDs, states, transitions, expiry, qualifying-order rule (pure) |
| Matching Engine | `functions/agents/_shared/identity.js` | order↔lead resolution + confidence (pure) |
| Generator | `recommendation-agent/sync.js` + `syncRecommendations` | persist-at-generation |
| Reconciler | `recommendation-agent/reconcile.js` + `reconcileRecommendations` | order→Won (shadow) |
| Watchdog | `recommendation-agent/integrity.js` + `recommendationIntegrityScan` | integrity detection |
| Service/orchestration | `recommendation-agent/service.js` | I/O, flags, audit, kill-switch |
| Triggers | `recommendation-agent/index.js` | Cloud Functions only |
| Read-model + UI | `jarvis.html` | declarative dashboard, Command Center, Replay, Time Machine |

All backend writes are **permission-gated** (`_shared/permissions.js`), **kill-switchable** (`agent_controls/global`), **audit-logged** (`jarvis_audit_logs`), and **idempotent**.

---

## 3. Data Model

### Collection: `recommendations/{recommendationId}` — canonical record
| Field | Type | Notes |
|---|---|---|
| `recommendationId` | string (doc id) | **permanent**, never regenerated. `REC-<lead6>-<YYYYMMDD>-<TC>-<rand4>` |
| `leadId` | string | join key to `leads`/`lead_intelligence` |
| `customerId` | string | stable identity: `c:e:<email>` or `c:p:<phone>` |
| `recommendationType` | enum key | `moq-quote`/`followup-overdue`/`hot-followup`/`reactivation`/`email-followup`/`wa-followup` (learning grouping key) |
| `recommendationLabel`, `typeCode`, `recommendedChannel` | string | display + ID type code (`MQ/FO/HF/RA/EM/WA`) |
| `state` | enum | canonical lifecycle state (see §4) |
| `stateReason` | string | why the current state |
| `name`, `recommendedOffer`, `suggestedProduct`, `leadSource`, `opportunitySource`, `urgencyScore`, `score`, `scoreLabel`, `closeProbability`, `potentialValue`, `expectedValue` | derived read-model | refreshed each sync; never affects ID/state |
| `action`, `minutes`, `roi`, `why[]`, `replied`, `lastMeaningfulActivity` | derived read-model | so a dashboard row builds from the record alone |
| `generatedAt` | ISO | **frozen** at first creation |
| `baselineActivityAt` | ISO | lead activity at generation → qualifying-order cutoff |
| `lastSyncedAt`, `lastStateChangeAt` | ISO/ts | bookkeeping |
| `orderId`, `outcomeId`, `actualRevenue`, `expectedRevenue`, `revenueVariance`, `accuracyScore`, `resolvedAt`, `resolvedBy`, `matchMethod`, `matchConfidence` | resolution | filled on Won/Lost |
| `reviewRequired`, `reviewReason`, `reviewCandidates` | review flag | set when a match is ambiguous/below threshold |
| `history[]` | array | **append-only** event log (see §5) |
| `agentOwner`, `scorerVersion` | meta | provenance |

### Other collections
| Collection | Writer | Reader | Role |
|---|---|---|---|
| `recommendation_resolution_proposals/{recId}` | reconciler (functions) | Command Center | shadow/live reconciliation proposals (auto-won / review-required) |
| `recommendation_integrity_reports/{auto}` | watchdog (functions) | Command Center | `{violations[], summary, total, scannedAt}` |
| `jarvis_outcomes/{auto}` | reconciler + dashboard | Learning/leaderboard | **resolution ledger** mirror (continuity); carries `recommendationId` |
| `lead_intelligence/{leadId}` | lead-agent only | platform (read) | scorer output (input) |
| `leads`, `orders` | funnel/storefront | platform (read) | source data |
| `jarvis_audit_logs` | all agents (append-only) | admin | immutable audit |
| `agent_controls/global` | admin | all agents | kill switch |

### Relationships
`leads 1—1 lead_intelligence` (shared doc id = `leadId`). `leads 1—N recommendations` (multiple cycles/types over time; permanent IDs distinguish them). `recommendations 1—0..1 jarvis_outcomes` on resolution (`recommendationId` + `outcomeId` cross-link). `orders ↔ leads` resolved **only** via the Matching Engine (orders carry no `leadId`).

---

## 4. Lifecycle

```
Generated → WaitingForFounder → AutomationRunning → WaitingForCustomer → CustomerResponded
   └────────────────────────────── → Won / Lost ──────────────────────────────┘
                                          │
                          (also: Snoozed, Expired, Superseded)
                                          ▼
                                      Archived
```

**States** (`_shared/recommendation-model.js` `STATE`): `Generated`, `WaitingForFounder`, `AutomationRunning`, `WaitingForCustomer`, `CustomerResponded`, `Won`, `Lost`, `Snoozed`, `Expired`, `Superseded`, `Archived`.

- **Active** (may appear in work queues): `Generated`, `WaitingForFounder`, `AutomationRunning`, `WaitingForCustomer`, `CustomerResponded`.
- **Terminal/parked**: `Won`, `Lost`, `Expired`, `Superseded`, `Archived`. `Snoozed` is active-but-hidden until the snooze expires.

Transitions are validated by `canTransition(from,to)` against the `TRANSITIONS` map — illegal transitions are refused and logged. Every transition appends a `history[]` entry + a `jarvis_audit_logs` row. **Expiration** (§ policy): `Generated`/`WaitingForFounder` with no action ≥ `ACTIVE_NO_ACTION_DAYS` (30) → `Expired`; `WaitingForCustomer` with no response ≥ `WAITING_CUSTOMER_DAYS` (21) → `Expired`; a newer active rec of a *different* type for the same lead supersedes an untouched older one → `Superseded`.

---

## 5. Event Model

Each `history[]` entry is self-describing:
```
{ at, from, to, reason, actor, eventType, source, data }
```
| eventType | Created when | By (source) |
|---|---|---|
| `generated` | record first minted | scorer / backfill |
| `surfaced` | → WaitingForFounder | sync |
| `automation` | → AutomationRunning | (v1.x automation) |
| `actioned` | founder opens WhatsApp/Email/Call → WaitingForCustomer | founder-dashboard (`recMarkActioned`) |
| `customer-responded` | → CustomerResponded | (v1.x reply detection) |
| `resolved-won` | → Won | founder-dashboard (`jRecWon`) or reconciler (live) or backfill |
| `resolved-lost` | → Lost | founder-dashboard (`jRecLost`) or backfill |
| `snoozed` | → Snoozed | founder-dashboard (`jRecSnooze`) |
| `expired` / `superseded` | expiry/supersession sweep | sync |
| `archived` | post-terminal | reconciler / sweep |

`actor` is the raw writer; the UI maps `source`+`actor` → **Founder / Jarvis / Jarvis (reconciler) / Jarvis (backfill)**. `data` carries event-specific facts (e.g. `{channel}`, `{orderId, actualRevenue, matchMethod, matchConfidence}`). Entries written before this schema (none in a fresh deploy) render `—`. **Write-on-action only** — there is no `viewed` event (recording views would be write-on-render, which is forbidden).

---

## 6. Matching Engine (`_shared/identity.js`)

Resolves an order (or any contact) to a lead. **Priority order, each with a confidence score:**
| # | Method | Confidence |
|---|---|---|
| 1 | Lead ID (explicit FK) | 1.00 |
| 2 | Customer ID | 0.98 |
| 3 | Email (normalized) | 0.95 |
| 4 | Normalized phone | 0.90 |
| 5 | Name + phone | 0.80 |
| 6 | Name + email | 0.80 |

Ambiguity (one contact → several leads, e.g. shared email across duplicate leads) multiplies confidence by **0.6**, pushing it below the auto threshold. **Thresholds:** `AUTO_RESOLVE = 0.90`, `REVIEW_FLOOR = 0.50`. Decision: `auto` (≥0.90) / `review` (0.50–0.90 or ambiguous) / `none` (<0.50, ignored). The service **never silently guesses** — sub-threshold matches become **Review Required**. `customerId` is the stable identity (`c:e:<email>` preferred, else `c:p:<phone>`).

---

## 7. Reconciliation (`reconcile.js` + `reconcileRecommendations`)

**Qualifying order** (founder-approved rule): an order that is **paid** (`isPaid`) **AND dated on/after** the recommendation's `baselineActivityAt`. The date guard prevents an *old* purchase from auto-winning a *new* inquiry from a returning customer. Earliest qualifying order wins.

- **[SHADOW] (current: `RECONCILE_LIVE_ENABLED = false`)** — for each active rec with a qualifying order, writes a `recommendation_resolution_proposals/{recId}` entry (`kind: auto-won` or `review-required`) + audit log. **No state change, no ledger write.** This is the validation period's evidence.
- **[v1] Live mode** (after certification) — `auto` matches: transition rec → **Won** (attach `orderId`, `actualRevenue`=order total, `revenueVariance`=actual−expected, `accuracyScore`, `matchMethod`/`matchConfidence`) → mirror a `converted` row to `jarvis_outcomes` → transition → **Archived**. Sub-threshold/ambiguous → `reviewRequired` flag (no auto-Won). Idempotent: skips any rec already converted in the ledger.
- **Triggers:** hourly sweep + the `onOrderCreated` hook (`reconcileForOrder`) for immediacy on prepaid orders; the sweep is the backstop for pay-later.
- **Revenue attribution (v1):** realized — `actualRevenue` from the matched order, variance + accuracy vs the rule-based expectation, linked by `orderId`+`recommendationId`.

---

## 8. Watchdog (`integrity.js` + `recommendationIntegrityScan`)

**Integrity rules (detection) [v1]** → `recommendation_integrity_reports`:
| Rule | Severity | Meaning |
|---|---|---|
| `missing-id` | critical | invalid/missing Recommendation ID |
| `completed-order-still-active` | critical | active rec has a qualifying paid order (should be Won) |
| `duplicate` | high | >1 active rec for the same lead+type |
| `orphan` | high | rec's lead no longer exists |
| `customerless` | high | no `customerId` and no `leadId` |
| `expired` | medium | active rec past the §4 expiry policy |

Report shape: `{ violations[], summary{type:count}, total, scannedAt }`. Runs daily (06:00 America/Jamaica) + on demand via `recommendationOps`.

**Repairs & escalation [v1.x — Self-Healing Engine, next phase]:** automated remediation (auto-expire, auto-resolve completed-order recs, dedupe) and severity-based founder escalation are *designated but not built in v1*. v1 detects and reports; humans/the next phase repair.

---

## 9. Command Center (`renderRecCommandCenter`, read-only)

Mission-control health page (section `sec-rec-command-center`). **Health Score** = `100 − Σ(weight × violationCount)` from the latest integrity report, weights: `missing-id 10, completed-order-still-active 15, duplicate 5, orphan 3, customerless 5, expired 1`; bands 🟢 ≥95 / 🟡 80–94 / 🔴 <80 (⚪ until first scan).

**Platform metrics [v1, real]:** Recommendations, Active, Waiting Founder, Waiting Customer, Shadow Matches, Review Required, Integrity Errors, Duplicate Recs, Orphans, Completed-in-queue.
**Business KPIs [v1, real]:** Won today, Lost today, Resolution rate, Acceptance rate, Avg time to Won, Avg rec lifetime, Founder response time, Revenue captured (Won·actual), Revenue attributed (Won w/ order link), Revenue missed (Lost·expected ⚖ estimate), Active duplicates.
**Honest placeholders ("—") [v1.x]:** Sync Errors (function logs), Watchdog Repairs (pending Self-Healing), Learning Events (pending Learning), Platform Uptime (not instrumented), Shadow accuracy (manual review). These never display fabricated numbers.

---

## 10. Replay Mode (`renderRecReplay`, read-only)

Select any recommendation → its complete lifecycle is replayed **directly from `history[]`**, sorted by timestamp. Each event shows: timestamp · actor (mapped) · source · eventType (icon) · previous→new state · reason · supporting `data`. Nothing is reconstructed from guesses; events the platform does not record (e.g. founder views) are intentionally absent. Purpose: debugging, auditing, training, understanding why a recommendation succeeded or failed.

---

## 11. Time Machine (`renderRecReplay` cursor, read-only)

A cursor/slider over the event list reconstructs **"what did Jarvis know at moment T?"** using **only events with `at ≤ T`**: state-as-of = the cursor event's `to`; known-data = the merge of `data` from all events up to the cursor; later events are dimmed as "had not happened yet." No future knowledge. Purpose: debugging, model evaluation, Learning Engine validation, explainability, future AI training.

---

## 12. Deployment

Full runbook: **`DEPLOY_RECOMMENDATION_PLATFORM.md`**. Summary:
1. **Snapshot** affected/appended collections (`jarvis_outcomes`; reference `lead_intelligence`). New collections need none (rollback = delete).
2. **Order:** Firestore rules → Cloud Functions (targeted) → Netlify (jarvis.html) → backfill (dry-run→live) → sync → integrity scan. Rules-before-UI (UI fails safe to legacy if records absent).
3. **Backfill:** `recommendationOps({op:'backfill'})` reconstructs records from current `lead_intelligence` + `jarvis_outcomes` (idempotent, dry-run default).
4. **Validation:** correctness checklist (#1–23) + performance/cost (§C2) + success criteria **S1–S7**.
5. **Rollback:** layered; instant fail-safe = delete `recommendations` ⇒ dashboard reverts to legacy with no redeploy.
6. **Observation Mode:** active Day 0 (technical) → Days 1–3 (shadow + integrity) → Days 4–7 (business) → decide Live Reconciliation. ~15–25 min deploy, **zero downtime, zero customer impact**.

---

## 13. Future Extension Points

Future systems plug in **without modifying platform internals**:
- **Identity Resolution Service [v1.x — FOUNDATIONAL, scheduled before the Learning Engine]** — the canonical customer-identity layer the Recommendation Platform deliberately does **not** implement itself. Unifies today's two partial mechanisms (`_shared/duplicates.js` clustering + `_shared/identity.js` email/phone matching) into one shared `resolve(contact)` service producing a **stable canonical customer id** (e.g., a persisted `people` collection) + cluster members + primary. Will provide: canonical customer identity, customer clustering, duplicate resolution, **cross-lead** recommendation chains, cross-lead replay, cross-lead timelines, cross-lead order reconciliation, cross-lead Gmail history, cross-lead WhatsApp history, and future omnichannel identity. Until it exists, the Recommendation Platform is **single-lead** (see Known Limitations).
- **Demand Hunter / AI Marketing** — read `lead_intelligence` + `recommendations`; create new recommendation *types* (extend `recType`) and/or campaigns; never mutate existing records' identity/state directly.
- **AI Sales / Customer Success** — consume active recs via the read-model; act through the same transition API (`recMarkActioned`/`jRec*` analogues or a callable), producing `actioned`/`resolved` events.
- **Learning Engine [v1.x]** — read resolved records + `history[]` (+ Time Machine for point-in-time truth); write *advisory* confidence/ranking adjustments behind staged flags; **must not** rewrite history, IDs, or manual decisions. (See the staged shadow-first philosophy.)
- **Executive Orchestrator [v1.x]** — coordinates multiple agents using the existing kill-switch/permissions/audit substrate; sequences agents, never bypasses the lifecycle.
- **Self-Healing Watchdog [v1.x]** — consumes integrity reports; performs bounded auto-repairs as audited transitions; escalates by severity.

Extension contract: **read the read-model; act via the transition/matching/proposal interfaces; write your own collections; emit events into `history[]` with your `source`.** Never fork recommendation state.

---

## 14. Architectural Constraints (invariants future work must never violate)

1. **Single source of truth** — recommendation state lives only in `recommendations`; no surface recomputes it.
2. **Permanent Recommendation IDs** — never regenerated; stable across renders/days/screens.
3. **Append-only event history** — `history[]` is never rewritten or deleted; corrections are new events.
4. **Stable lifecycle** — the `state` enum + legal transitions are the v1 contract; extend via new event types/states additively, never break existing ones.
5. **Backend business logic** — generation, matching, reconciliation, integrity live server-side; the dashboard is **declarative**.
6. **No duplicate recommendation state** — the legacy compute path is removed at certification; one path only.
7. **No silent automation** — consequential autonomous writes ship shadow-first, flag-gated, audit-logged.
8. **Auditability** — every transition writes `jarvis_audit_logs`; every write is permission-gated + kill-switchable.
9. **Explainability** — every recommendation answers why-this/now/customer/channel/not-another; every learning adjustment must explain itself.
10. **Reversibility** — every capability is flag-controlled and rollback-able; historical outcomes are never overwritten.
11. **Honest data** — estimates are labelled; unknowns show "—"; nothing is fabricated.
12. **Single-lead scope (v1)** — the Recommendation Generator depends **only on evidence within a single `lead` record**. It must never infer that two different lead documents belong to the same customer, and must never read duplicate clusters to make generation decisions. Cross-lead behavior is owned exclusively by the future Identity Resolution Service. (The generator may still *exclude* non-primary duplicates via the scorer's stored `isPrimaryRecord` flag — that is exclusion, not cross-lead inference.)

---

## 14a. Known Limitations (intentional — not bugs)

Cross-lead recommendation chaining is **out of scope for Recommendation Platform v1.** Until the Identity Resolution Service exists:
- Recommendation **chains** are per lead.
- **Replay Mode** is per lead.
- **Time Machine** is per lead.
- **Recommendation generation** is per lead.
- Recommendation replay must **never infer relationships between different lead documents**.

> **Technical debt (intentional):** *"If a returning customer creates a new lead after reaching a terminal recommendation on a previous lead, Recommendation Platform v1 intentionally treats the new lead independently until the Identity Resolution service is implemented."*

This is a deliberate scoping decision so the regeneration-defect fix stays single-lead, deterministic, and free of unproven dependencies — **not** an oversight. The returning-customer / cross-lead case is deferred to the Identity Resolution Service (roadmap item 3, before the Learning Engine).

---

## 15. Recommendation Platform v1 — Certification Criteria

v1 is **Certified** when, in production:
- **C1** Records exist and the dashboard reads them (`PLATFORM_READY` AUTHORITATIVE); permanent IDs stable across reloads/days.
- **C2** Integrity: `missing-id = 0`, `completed-order-still-active = 0`, `critical = 0`; no unexplained duplicates/orphans.
- **C3** Founder Focus, Today's Top Actions, Pending Outcomes, History, Learning, Command Center, Replay, Time Machine all read records and agree.
- **C4** Manual Won/Lost/Snooze transition the record (state + history + audit) and leave the active queue; ledger mirror written.
- **C5** Shadow reconciliation produces correct proposals on real orders with high match accuracy and **zero** auto-Won writes while shadow.
- **C6** Performance & cost within baseline; no function errors/timeouts; no customer-facing regression.
- **C7** Legacy recommendation code removed (one path only) after C1–C6 hold through the observation window.
- **C8** This document accurately reflects the deployed system.

On certification, the v1 **API / data model / lifecycle** are stable. Future development **extends** this architecture rather than redesigning it.

---

*Companion documents:* `DEPLOY_RECOMMENDATION_PLATFORM.md` (operations), `functions/agents/PHASE4_CONTRACT.md` / `PHASE4_COMPLETION.md` (lineage), and the Jarvis Constitution in `CLAUDE.md` (governance).
