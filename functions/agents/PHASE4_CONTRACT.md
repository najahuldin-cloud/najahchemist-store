# Phase 4 Contract — binding rules for every revenue surface

Per the Jarvis Constitution, **before** any Phase 4 UI ships, ALL of these surfaces
MUST honor the four rules below. This is a contract, not a guideline.

## Surfaces bound by this contract
- **Lead Command Center**
- **Revenue rankings / leaderboard**
- **Today's Lead Actions queue**
- **Marketing Commander** (campaign audience building)
- **Forecasts** (month-end, pipeline projections)

## The four rules (all four, every surface)

1. **Exclude `isTest === true`.** Test/owner/shared-contact/internal records never
   appear in rankings, queues, audiences, pipeline totals, or forecasts.
2. **Deduplicate by `duplicateClusterId`.** When a cluster has >1 member, keep only
   `isPrimaryRecord === true`; collapse the rest. Never count a cluster more than once
   in totals, rankings, or audiences.
3. **Use the Honest Pipeline.** Pipeline/forecast figures = sum over records that are
   `!isTest && isPrimaryRecord && !suspiciousLead`. Raw totals may be shown only when
   explicitly labeled "raw (unfiltered)".
4. **Warning banner at >10% inflation.** If `(rawExpected − honestExpected) / rawExpected
   > 0.10`, every affected surface must display a visible warning banner stating the
   inflation %, the test count, and the duplicate-cluster count. Per the Constitution:
   *"If data quality is low, Jarvis must warn instead of pretending certainty."*

## Fields available (already stored by the scorer)
`isTest`, `testReason`, `suspiciousLead`, `suspiciousReason`,
`duplicateClusterId`, `duplicateCount`, `isPrimaryRecord`,
`dataQuality.{emailKey,phoneKey,nameKey,hasName,missingContact}`.

A shared client-side helper (`leadFilters`) will encapsulate rules 1–3 so no surface
re-implements them. Current measured inflation (~27% expected) is **>10%**, so the
banner WILL be required on first launch.

## Phase 4 Success Criteria (sign-off checklist)

Phase 4 is COMPLETE only when every box passes:

- [ ] Lead Manager shows intelligence (score, label, offer, next action per lead)
- [ ] Lead Command Center loads
- [ ] Honest Pipeline displayed
- [ ] Duplicate records excluded (non-primary cluster members collapsed)
- [ ] Test leads excluded (`isTest` hidden from all surfaces)
- [ ] Top Opportunities ranked correctly (by expected value, real+primary only)
- [ ] Revenue totals match the audit (`v4-final-audit.js` Honest Pipeline figure)
- [ ] Refresh works (re-pull from Firestore updates the view)
- [ ] Mobile usable
- [ ] Founder identifies the best opportunity in under 30 seconds

## Phase 4 Design Principles (decision-first — binding)

**Phase 4 objective: turn intelligence into decisions, NOT build more charts.** Success
is measured by faster decisions, higher revenue influence, less founder effort, more
actions completed — never by dashboard complexity.

### Decision-First Rule
Jarvis is a decision system, not a reporting system. Every section must answer "What
should Najah do next?" A widget that only displays information without influencing a
decision must be hidden, moved, or removed. Every major section ends with:
**Recommended Action · Expected Revenue · Confidence · Time Required.**

### Action Over Insight Rule
Prefer actions over observations.
- ❌ "Total Leads", "Total Revenue", "Pipeline Value" (bare metrics)
- ✅ "Call Amoy Smith", "Launch Reorder Campaign", "Follow up 3 Hot Leads"

### 💰 Today's Money (first screen)
The first card answers "Where is today's money?" — Best Lead · Best Customer · Best
Campaign · Revenue Gap · Fastest Revenue Opportunity · Recommended Next Action. Each
item shows Expected Value · Confidence · Estimated Time Required. Najah knows what to
do in under 30 seconds.

### Today's Top Actions (ranking)
Rank by **(Expected Value × Close Probability) ÷ Time Required** — the founder-attention
formula from the Constitution. Highest-leverage action always first. Each row shows:
Action · Expected Value · Confidence · Estimated Time Required · Why It Matters.

### Opportunity Aging Rule
Surface (display-layer, derived from existing timeline fields — no new collection):
`daysSinceLastAction`, `daysSinceLastReply`, `daysSinceLastContact`. Warn on high-value
opportunities left untouched, e.g. "⚠ J$54,000 opportunity untouched for 14 days".
**Surface lost/aging opportunities BEFORE creating new ones.**

### Founder Test (acceptance gate)
On opening Jarvis, Najah can identify Best Lead · Best Customer · Best Campaign · Revenue
Gap · Next Action within 30 seconds. If not, simplify — the founder must never hunt for
the answer.

### 15-Minute Rule
Jarvis answers "What is the highest-ROI thing Najah can do in the next 15 minutes?" with a
**specific** action — "Call Amoy Smith", "Send MOQ quote", "Follow up Timmoy", "Launch reorder
campaign" — never "Review dashboard" / "Check leads" / "Analyze opportunities". Each carries
Expected Value · Confidence · Estimated Time Required · Why it matters.

### Revenue Gap Rule
Display a **🎯 Revenue Goal** block: Daily Goal · Forecast · Revenue Gap · Confidence — AND how
Jarvis recommends closing the gap. The objective is not reporting the gap; it is **closing** it.

### Dashboard Visual Priority Order (refined 2026-06-12)
The founder's first question is "Where is today's money?" — not "How many leads exist?" Order:
1. 💰 Today's Money  2. ⚡ Today's Top Actions  3. 🎯 Revenue Target / Gap  4. ⚠ Honest Pipeline
5. 🎯 Top Opportunities  6. 💼 Lead Command Center  7. 📊 Revenue by Offer.
Supporting cards: **⏱ Next 15 Minutes** (top-3 ROI actions, sits in the actions zone) and
**⚠ Revenue at Risk** (aging hot leads — protection before creation, sits by Revenue Target).
Legacy self-computed sections remain BELOW until migrated onto `lead_intelligence`.

### Confidence Visibility Rule
Every recommendation shows a confidence %. For a lead action, confidence = `closeProbability`.
For forecasts, an aggregate confidence. Recommendations without confidence are harder to trust.

### Card specs
- **💰 Today's Money** — Best Lead · Best Customer · Best Campaign · Revenue Gap · Fastest
  Revenue Opportunity · Recommended Next Action. Each shows EV · Confidence · Time (no drill-down).
- **🎯 Revenue Target** — Daily Goal · Forecast · Revenue Gap · Confidence + "Recommended path to
  close gap" (checklist of specific actions). The operational heartbeat.
- **⚠ Revenue at Risk** — Estimated revenue at risk · # aging hot leads · # aging opportunities
  (aging = `>14d` since `lastMeaningfulActivity`, derived at render — never stored).
- **⏱ Next 15 Minutes** — top-3 actions by `(EV ÷ Time)` with combined Expected Revenue Influence,
  confidence, total time. Direct implementation of the Jarvis Success Test.
- **🎯 Top Opportunities** — each row carries "WHY THIS LEAD" (from `whyRecommended` / intent
  signals / offer) so ranking is understood without another screen.

### Ranking formula (DECIDED 2026-06-12 — keep EV ÷ Time)
Rank actions by **expected revenue ÷ time-required**. Since stored `expectedValue` already equals
`potentialValue × closeProbability`, EV÷time IS the "(Expected Value × Close Probability) ÷ Time"
founder-attention formula — applying closeProbability once. Evaluated `(EV × Confidence) ÷ Time` on
live data: top-10 **identical** (10/10 overlap, same EV captured) and it double-applies probability
(`potential × closeProb²`). **Kept EV÷Time.** Time estimates are founder-accepted derived defaults
(WhatsApp 5 / MOQ quote 10 / call 10 / email 7 / campaign review 15 / campaign launch 30 / research
15 / check-in 5 min) — **derived at render, never stored.**

### Daily goal & revenue influence (refined 2026-06-12)
`DAILY_REVENUE_GOAL = J$300,000` (founder-set, presentation only). Every major recommendation shows
**Revenue Influence = EV ÷ daily goal** (Founder Focus, Today's Money, Today's Top Actions, Top
Opportunities). Revenue Target shows Daily Goal · Forecast · Gap · **Progress %** · Confidence.

### 🔥 Founder Focus (hero, very top — above Today's Money)
If Najah does ONE thing today: the single highest EV÷time action — Action · Lead · EV · Confidence ·
Time · Revenue Influence · Reason.

### 💸 Money Missed This Week
Revenue at risk + # aging opportunities (>14d) + **Top 3 causes** (derived from existing intel
state — `opportunitySource` / replied / offer; e.g. "No follow-up", "No quote sent", "No response
after pricing"). No new fields/collections/scoring.

### ⚠ Revenue at Risk — Worst Offender
Adds the single worst aging hot/ready lead: Name · Revenue at Risk · Days Inactive · next action.
