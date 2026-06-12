# Agent Safety — invariants for every autonomous agent

Binding on: Lead Agent, Reorder Agent, Book Agent, Marketing Commander,
Demand Hunter, Ad Commander, Content Commander (and any future agent).

## Hard invariants (no agent may violate)

1. **Never contact `isTest === true` leads.** A shared `contactGuard(lead)` must reject
   any outbound (WhatsApp/email/ad audience) where `isTest` is true — regardless of score.
2. **Never auto-contact `suspiciousLead === true`.** Suspicious records (e.g.
   `sentence_name`) require human confirmation before any outbound; never automatic.
3. **Never act without audit logging.** Every money/pricing/customer-data/inventory/
   campaign/publishing action routes through `_shared/audit.js` → append-only
   `jarvis_audit_logs` with before/after (reversible).
4. **Never bypass permission controls.** Every write is checked via
   `assertPermission(agent, perm)` (no wildcard `*`); approval levels enforced
   (L1 auto / L2 pending_approvals / L3 human-only); kill switch checked at entry
   via `isKilled(agent)`.
5. **Deduplicate before acting.** Outbound and audience building collapse clusters by
   `duplicateClusterId` (primary only) so a person is never contacted N times.

## Simulation mode (required before autonomous execution)

Every agent MUST support a dry-run/simulation mode that computes and logs its intended
actions WITHOUT executing them (the lead-agent's `scoreLeadsBackfill({dryRun:true})` and
the `DAILY_WRITE_ENABLED=false` gate are the reference pattern). An agent may only run
autonomously after its simulation output has been reviewed and the kill switch is off.

## Contactability precondition
No outbound is attempted against a record with `dataQuality.missingContact === true`
on the relevant channel (no email → no email send; no phone → no WhatsApp).
