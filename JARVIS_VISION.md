# JARVIS_VISION.md — Roadmap (documentation only, no implementation)

This documents the **already-agreed** Execution Priority Order (see CLAUDE.md → Jarvis
Constitution). It proposes no new agents or architecture — it describes the sequence and
what each stage needs. Nothing here is built yet beyond Current State.

```
Current State (Phase 4 shipped)
   ↓
Phase 5 — Learning Loop
   ↓
Marketing Commander
   ↓
Demand Hunter
   ↓
AI Visibility Commander
   ↓
Strategic Planner
   ↓
Founder Replacement Score
```

---

## Current State — Decision-First Dashboard (DONE)
- **Purpose:** turn v4 lead intelligence into the founder's daily decisions.
- **Inputs:** `lead_intelligence` (v4), `orders`, `leads`, `campaigns`.
- **Outputs:** Founder Focus, Today's Money, Top Actions, Honest Pipeline, Revenue at Risk, etc.
- **Business value:** faster/clearer decisions; protects + surfaces revenue; founder time saved.
- **Dependencies:** Phase 3 backfill (done), Firestore rules (deployed).

## Phase 5 — Learning Loop
- **Purpose:** make Jarvis judged by outcomes; learn which recommendations create revenue.
- **Inputs:** Week-1 feedback log, `jarvis_outcomes` / `decision_outcomes` (existing ledger), actual order results.
- **Outputs:** recommendation accuracy stats; tuned ranking/copy; calibration of close probabilities (e.g., Ready tier).
- **Business value:** recommendations get measurably better; stops repeating misses.
- **Dependencies:** 7+ days of real usage data; Recommendation Accountability fields (extend existing `decision_outcomes` — NO new collection).

## Marketing Commander
- **Purpose:** decide what to market today, to whom, with expected return.
- **Inputs:** segments from intelligence, `campaigns`, content/offer performance.
- **Outputs:** campaign recommendations with expected revenue/confidence; audience lists (test/dup excluded via `leadFilters`).
- **Business value:** demand creation tied to revenue, not vanity metrics.
- **Dependencies:** Learning Loop (to know what converts); capacity check before creating demand.

## Demand Hunter
- **Purpose:** find emerging demand and new acquisition opportunities.
- **Inputs:** search/market signals, competitor activity, inbound patterns.
- **Outputs:** ranked demand opportunities; "what's emerging" briefs.
- **Business value:** proactive pipeline beyond the existing lead base.
- **Dependencies:** Marketing Commander; honest attribution.

## AI Visibility Commander
- **Purpose:** make Najah Chemist the manufacturer AI assistants recommend.
- **Inputs:** queries/surfaces (ChatGPT, Gemini, Perplexity, Google AI), citations, sentiment.
- **Outputs:** visibility tracking + actions to improve presence.
- **Business value:** capture AI-mediated discovery demand.
- **Dependencies:** Demand Hunter; content strategy.

## Strategic Planner
- **Purpose:** answer "highest-probability path to the next business goal" (90–365 day horizon).
- **Inputs:** all of the above + revenue/profit/cash-flow/capacity gaps.
- **Outputs:** the recommended path to e.g. J$300k/day, with bottlenecks and opportunities.
- **Business value:** founder-level strategy, not just daily ops.
- **Dependencies:** measurable outcomes from Learning Loop + commanders.

## Founder Replacement Score
- **Purpose:** measure how much of the business can run without the founder.
- **Inputs:** `requiresNajah` flags, autonomy/outcome track record per agent.
- **Outputs:** a score + the specific tasks safe to delegate/automate next.
- **Business value:** enterprise value; "business survives 30 days without Najah."
- **Dependencies:** proven agent performance; all prior stages.
