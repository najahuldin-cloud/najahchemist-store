# Backfill Pre-Mortem — v4 `lead_intelligence` full backfill

Required before any full backfill (per Approval Policy). Target: write one
`lead_intelligence/{leadId}` doc per lead via `scripts/backfill-lead-scores.js`.
The `leads` collection is NEVER written. Backfill is idempotent (keyed by leadId,
deterministic scoring) and fully reversible from the snapshot.

**Scope of blast radius:** only the `lead_intelligence` collection. No `leads`, no
Firestore rules, no functions, no env/flags, no outbound communication.

---

## Failure scenarios → detection → recovery

### 1. Token expires mid-run
- **Cause:** Firebase CLI access token (~60 min TTL) lapses during the write loop.
- **Detection:** script throws `write <id> 401`; run aborts; partial writes only.
- **Recovery:** refresh token (`firebase projects:list --project najah-chemist`), re-run.
  Idempotent — already-written docs overwrite cleanly, unwritten docs get created.
- **Recovery time:** ~2 min (refresh + re-run). No data loss.

### 2. Partial write (network drop / process killed)
- **Detection:** "lead_intelligence written" count < total leads; `failures[]` may list ids.
- **Recovery:** re-run the full backfill — idempotent, converges to complete state.
  If abandoning, run rollback to restore the pre-write snapshot.
- **Recovery time:** ~3–5 min re-run for ~605 leads.

### 3. `leads` accidentally modified
- **Detection:** built-in guard — after writing, the script re-lists `leads` and compares
  `updateTime` against the snapshot baseline; prints "leads w/ changed updateTime: N".
  Any N>0 is a red flag.
- **Recovery:** investigate immediately; `leads` is the source of truth and is NOT in the
  backfill write path, so N should always be 0. If non-zero, stop and inspect before any rollback.
- **Recovery time:** N/A (should never occur; write path only touches `lead_intelligence`).

### 4. Bad scores written (logic regression)
- **Detection:** post-backfill `v4-final-audit.js` Honest Pipeline / Ready% diverges from the
  pre-backfill projection (expected: Honest ≈ J$10.1M, Ready real ≈ 0.7%, inflation ≈ 26.8%).
- **Recovery:** rollback to snapshot, fix scorer, re-validate offline (`test-v4-scoring.js`), re-run.
- **Recovery time:** ~5 min rollback + fix time.

### 5. Snapshot stale (leads added/changed after snapshot)
- **Detection:** `project-v4-distribution.js` snapshot-currency check ("snapshot leads vs current");
  backfill aborts if no snapshot exists at all.
- **Recovery:** re-run `backup-lead-intelligence.js` to take a fresh snapshot, then backfill.
- **Recovery time:** ~1 min re-snapshot.

### 6. Wrong project targeted
- **Detection:** all scripts hardcode `PROJECT_ID = 'najah-chemist'` (live). Verify the banner
  in output. The dead `najah-chemist-362ad` and `najah-chemist-staging` are never referenced.
- **Recovery:** N/A — project is not parameterized.

### 7. Duplicate/test fields missing or wrong (the bug fixed this session)
- **Detection:** post-backfill spot-check that `isPrimaryRecord`/`duplicateClusterId`/`isTest`
  exist and that non-primary + shared_contact records are populated; audit inflation ≈ 26.8%.
- **Recovery:** rollback; the script now builds the dup index and passes `ctx` (verified). Re-run.
- **Recovery time:** ~5 min.

---

## Rollback commands

```bash
# 1. Always dry-run first — shows what WILL change, writes nothing:
node scripts/rollback-lead-intelligence.js

# 2. Execute the rollback (restores lead_intelligence to the snapshot; deletes
#    anything the backfill created; NEVER touches `leads`):
node scripts/rollback-lead-intelligence.js --commit

# Roll back to a specific snapshot instead of the latest:
node scripts/rollback-lead-intelligence.js --commit --file=scripts/_snapshots/<snapshot>.json
```

**Snapshot of record:** `scripts/_snapshots/lead-intelligence-snapshot-2026-06-12T18-30-23-571Z.json`
(605 leads + 602 lead_intelligence; verified restorable — dry-run: delete 0 / restore 602 / leads untouched).

---

## Pre-flight checklist (run immediately before full backfill)

1. Token valid (>5 min TTL).
2. Fresh snapshot exists and is current (snapshot leads == current leads).
3. `node scripts/rollback-lead-intelligence.js` dry-run is sane.
4. Sample backfill (`--limit 10`) completed + `v4-final-audit.js` re-validated.
5. Explicit Level-3 approval obtained.

**Total estimated recovery time for the worst realistic case (full rollback):
~5–7 minutes**, no `leads` data at risk under any scenario.
