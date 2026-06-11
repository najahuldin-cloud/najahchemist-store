# Jarvis OS — Agents

Every feature in the Jarvis Operating System belongs to an **agent**. Agents are
Firebase v2 Cloud Functions modules that deploy through the existing `functions`
codebase. They are aggregated into the deploy by a single additive line in
`functions/index.js`:

```js
Object.assign(exports, require('./agents'));
```

This line never touches the existing (do-not-touch) exports, including the AI email
auto-responder trio: `onLeadCreated`, `handleEmailReply`, `checkLeadFollowUps`.

## Agent contract

Each agent declares its **permissions** and **approval level** in
`_shared/permissions.js` (never a wildcard `*`). Before any write, an agent calls
`assertPermission(agent, 'write:collection')`. Before doing any work, an agent calls
`isKilled(agent)` (`_shared/killswitch.js`) and short-circuits if disabled. Any action
touching money, pricing, customer data, inventory, campaigns, or external publishing
is logged append-only via `_shared/audit.js` → `jarvis_audit_logs`.

| Agent | Level | Owns (collections) |
|---|---|---|
| `lead-agent` | L1 | `lead_intelligence`, `lead_recommendation_outcomes` |
| `reorder-agent` | L1 | (reorder opportunities) |
| `book-agent` | L1 | (book-sale opportunities) |
| `coaching-agent` | L1 | (coaching opportunities) |
| `marketing-commander` | L2 | `campaigns` (broadcasts need approval) |
| `demand-hunter` | L1 | `market_signals` |
| `ad-commander` | L2 | (ad spend — needs approval) |
| `content-commander` | L2 | `content_intelligence` (publishing needs approval) |

## Approval levels

- **L1 (auto):** scoring, reminders, drafts — agent executes directly.
- **L2 (approval):** broadcasts, campaigns, ad spend — agent writes a `pending_approvals`
  row and stops until a human approves.
- **L3 (always human):** pricing, refunds, contracts — agent may only draft/recommend
  into `pending_approvals`; never auto-executes.

## Status

**Phase 1 (current):** skeleton only. Every agent exports `{}` — zero deployed
functions. The security substrate (`permissions`, `audit`, `killswitch`) and the
write-locked `lead_intelligence` collection exist *before* any agent can write.
`lead-agent` gains its scoring functions in Phase 2.
