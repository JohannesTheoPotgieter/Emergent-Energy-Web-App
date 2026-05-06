# Migration Dossier — Section 6 (Risk Register and Rollback Design)

## Completed scope

Section 6 from the chunked plan: formal migration risk register with failure modes, severity, mitigations, rollback approaches, and pause gates for a live production system.

---

## 1) Migration risk register

| ID | Risk | Why it matters | Likely failure mode | Severity | Mitigation | Rollback approach |
|---|---|---|---|---|---|---|
| R1 | Project identity cutover regression (`projectName` ↔ `projectId`) | Active UI/API contracts still use both identities | `/project/:projectName` pages and legacy APIs fail or map to wrong project | Critical | Maintain `legacy_id_map` + bidirectional resolver; dual-read adapters for all project lookups | Feature-flag off new resolver; revert adapter routing to legacy name-based path |
| R2 | Orphaned FKs during table split/merge | Project, work, finance, and lifecycle tables are heavily linked | inserts/updates fail or silently lose linkage | Critical | Add preflight FK integrity checks and post-write reconciliation | Disable new writes; replay from backup snapshot + import batch rollback |
| R3 | Approval queue regressions | Approvals are spread across multiple models and UI queues | pending items disappear, wrong approver gets action rights | Critical | Build unified approval read model first; parity-test queue counts by type | Switch queue reads back to legacy aggregation endpoints |
| R4 | Evidence/document link loss | Evidence exists in multiple domain stores | attachments appear missing in stage/quality/eng views | High | Introduce resource-link bridge with immutable legacy references | Revert evidence read path to source-domain tables |
| R5 | Role/auth mismatch | Frontend nav and backend permission checks are split | users see routes but receive 403, or lose critical access | Critical | Lockstep role mapping migration, shadow auth checks, role-diff report before cutover | Revert role-assignment mapping and nav section mapping to prior release |
| R6 | Import pipeline breakage | Smart import commit/rollback is operationally critical | ingestion stops, partial commits, no rollback confidence | Critical | Keep existing import routes/tables untouched until import_batch bridge is parity-validated | Freeze new import features; revert to current smart-import commit code path |
| R7 | Finance integrity drift | finance tables include lineage, temporal, and dual-id compatibility columns | reports disagree, reconciliation fails, audit issues | Critical | Dual-write with variance checks (row count, amount totals, status totals) | Disable new finance writes; backfill-repair from last consistent snapshot |
| R8 | Stage lifecycle divergence | lifecycle state exists across execution state, stage tables, and gate views | conflicting stage status/readiness across dashboards | High | Define authority matrix per endpoint before writes; single-writer rule per lifecycle field | Revert writer to legacy lifecycle source and rehydrate derived states |
| R9 | Route alias/redirect regression | legacy redirects and aliases still power deep links | broken bookmarks and external shared links | Medium | Keep legacy redirects until traffic analysis shows zero use | Restore redirect table and route aliases from previous build |
| R10 | Duplicate truth drift in dual-write phases | old and new tables can diverge rapidly under production load | inconsistent records and non-deterministic UI | Critical | Add reconciliation jobs + drift alerts + write checksum columns | Disable dual-write, continue single-write to legacy while reconciling |
| R11 | Audit trail fragmentation | audit data is currently distributed across many tables | incomplete forensic and compliance history | High | Federated audit read model before any consolidation | Re-enable legacy audit feeds and discard partial merged projection |
| R12 | Performance regressions from compatibility joins | bridge adapters can add expensive joins | slow dashboards and timeout spikes | High | Add indexes/materialized projections before enabling broad dual-read | Route high-volume endpoints back to optimized legacy query paths |
| R13 | Backfill corruption | large historical migrations can mis-map IDs or statuses | long-tail data quality issues | High | Idempotent backfill batches + checkpoints + row-level diff reports | Restore from checkpoint, rerun corrected batch on bounded window |
| R14 | Sequence errors between departments | migration crosses shared objects for all department screens | one department cutover breaks another | High | Department cutover only after shared-object parity and cross-department smoke tests | Roll back department routing toggle to previous navigation map |

---

## 2) Pause/stop gates (operational go/no-go)

Immediately pause rollout if any occur:
- Approval queue delta > 0.5% between legacy and bridge models for 2 consecutive checks.
- Finance totals mismatch by project/day between source and bridge models.
- Stage status mismatch for any project in active execution pipeline.
- Auth regression where any admin or PM role loses required baseline route access.
- Import commit success rate drops below agreed baseline.

---

## 3) Rollback architecture principles

1. **Config-first rollback:** disable new read/write paths via feature flags before restoring binaries.
2. **Data-safe rollback:** never drop legacy tables in active migration phases; rollback means re-pointing reads/writes.
3. **Checkpointed rollback:** each backfill/dual-write phase must have a checkpoint timestamp and reversible delta scope.
4. **Operational rollback drills:** execute dry-run rollback in staging before each production phase gate.

---

## Section 6 feedback

- Completed scope: structured risk register with mitigation + rollback design.
- Key findings: highest-risk zones are identity bridging, approvals, finance integrity, import reliability, and auth/role alignment.
- Risks identified now: dual-write drift and lifecycle authority conflicts are likely unless explicitly controlled.
- Recommendation before proceeding: Section 7 should lock phase-by-phase scope, non-change guarantees, validation, and go/no-go criteria.
- Ready for next section: **Yes**.
