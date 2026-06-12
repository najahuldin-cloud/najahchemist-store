# Future Collections — SCHEMA DEFINITIONS ONLY (do NOT implement)

Schemas for collections referenced by the roadmap. No code, no writes, no rules yet.
All monetary/assumption values follow the `{ value, source, confidence }` rule pattern.

## customer_memory/{customerId}
Durable per-customer memory (mirrors/links Mem0; see netlify/functions/jarvis.js).
```
customerId, leadIds[], personId,
facts: [{ text, source, capturedAt, confidence }],
preferences: { preferredChannel, products[], cadenceDays },
lastInteractionAt, mem0Ref, updatedAt
```

## decision_outcomes/{id}
Cross-agent generalization of lead_recommendation_outcomes — the learning ledger for
EVERY agent decision.
```
agent, decisionId, subjectType ("lead"|"order"|"campaign"|"content"|"customer"),
subjectId, recommendation, recommendationVersion, action,
outcome ("pending"|"actioned"|"won"|"lost"|"no_response"),
wonLost, revenue (J$), predictedExpectedValue, costToActOf (J$), timestamp, resolvedAt
```

## content_performance/{id}
Revenue attribution per content asset (NOT vanity metrics — views only as a funnel input).
```
contentId, hook, topic, platform, publishedAt,
views, leads, sales, revenue (J$), spend (J$), roi,
attributedLeadIds[], capturedAt
```

## ai_visibility/{id}
Brand presence in AI assistants / answer engines (demand-hunter / future).
```
query, surface ("chatgpt"|"gemini"|"perplexity"|"google_ai"|"copilot"),
appeared (bool), position, sentiment ("positive"|"neutral"|"negative"),
citationUrl, capturedAt
```

## people/{personId}
Canonical person entity — the eventual home for duplicate resolution. A person unifies
many lead/customer records (the duplicateClusterId clusters roll up here).
```
personId, emailKeys[], phoneKeys[], names[],
primaryLeadId, leadIds[], customerIds[],
lifetimeValue (J$), orderCount, firstSeenAt, lastSeenAt, mergedFrom[]
```
Note: `people` is read/derived — leads are never mutated or deleted to build it.

## revenue_attribution/{id}
What actually caused a sale. Probabilistic, evidence-based — never assume attribution
without supporting data.
```
customerId, revenue (J$), profit (J$),
touchpoints: [{ type, ref, channelOrAgent, occurredAt, weight, evidence }],
  // type: "channel" | "agent"; channelOrAgent e.g. "TikTok"|"Instagram"|"WhatsApp"|
  // "Email"|"Website"|"Book" | "Lead Agent"|"Reorder Agent"|"Marketing Commander"|
  // "Demand Hunter"|"Content Commander"|"Ad Commander"
firstTouch, lastTouch, primaryDriver,
attributionConfidence (0..1), capturedAt
```

## executive_memory/{id}
Institutional business knowledge — remembered lessons, not rediscovered. Future agents
query this before making recommendations.
```
category ("seasonal_demand"|"product_demand_shift"|"pricing"|"promotion"|"funnel"|
  "conversion"|"customer_behavior"|"market"|"operations"),
lesson, evidence, source, confidence (0..1),
firstObservedAt, lastConfirmedAt, relatedSubjectIds[], capturedAt
```

## agent_performance/{id}
Measurable per-agent outcome tracking. No agent is "successful" without business outcomes.
```
agent, periodStart, periodEnd,
recommendationsMade, actionsExecuted,
expectedRevenue (J$), actualRevenue (J$),
expectedProfit (J$), actualProfit (J$),
attributionConfidence (0..1), successRate (0..1), capturedAt
```
