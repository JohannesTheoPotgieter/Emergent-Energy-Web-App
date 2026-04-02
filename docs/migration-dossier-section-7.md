# Migration Dossier — Section 7 (Recommended Staged Migration Plan: Phase 0–8)

## Completed scope

Section 7 from the chunked plan: live-safe phased migration plan (Phase 0 to Phase 8) with purpose, scope, dependencies, validation, rollback, and go/no-go gates.

---

## Phase 0 — Discovery freeze and control policy

- **Purpose:** Lock migration safety rules and baseline metrics.
- **Scope:** finalize inventory/mapping docs, define feature flags, define data parity KPIs.
- **Dependencies:** Sections 1–6 complete.
- **What changes:** process controls only.
- **What does NOT change:** schema, routes, runtime behavior.
- **Validation:** baseline snapshots of approval counts, finance totals, stage statuses, auth route matrix.
- **Rollback:** N/A (no runtime changes).
- **Go/No-Go:** proceed only after baseline artifacts are approved.

## Phase 1 — Target schema introduction (additive only)

- **Purpose:** Introduce target-spine tables without affecting current paths.
- **Scope:** add new tables (`workspace`, `department`, `role_definition`, `user_account`, etc.) and non-breaking indexes.
- **Dependencies:** Phase 0 controls.
- **What changes:** additive DDL only.
- **What does NOT change:** existing table contracts, routes, imports, auth behavior.
- **Validation:** migration success + no change in current API response contracts.
- **Rollback:** disable usage of new tables; retain additive objects.
- **Go/No-Go:** no API/UI regression and DDL health checks pass.

## Phase 2 — Compatibility/bridge layer enablement

- **Purpose:** Introduce adapters between legacy and target models.
- **Scope:** identity resolver (`projectName`↔`projectId`), party bridges, approval/evidence bridge reads, route adapters.
- **Dependencies:** Phase 1 tables live.
- **What changes:** new adapter codepaths guarded by feature flags.
- **What does NOT change:** default read/write source for critical domains.
- **Validation:** side-by-side read parity checks (legacy vs bridge).
- **Rollback:** disable bridge flags; revert to legacy-only reads.
- **Go/No-Go:** parity within tolerance for targeted endpoints.

## Phase 3 — Backfill and mapping

- **Purpose:** populate target tables from legacy data safely.
- **Scope:** incremental backfill by domain (identity, party, project, lifecycle, work, finance, resources).
- **Dependencies:** Phase 2 adapters and reconciliation scripts.
- **What changes:** target table population + lineage metadata (`legacy_id_map`).
- **What does NOT change:** production write authority remains legacy.
- **Validation:** row-count parity, key-field parity, unresolved mapping report.
- **Rollback:** truncate/rebuild affected target partitions from checkpoint.
- **Go/No-Go:** backfill completeness and mapping error rate under threshold.

## Phase 4 — Dual-read / dual-write (domain-by-domain)

- **Purpose:** prove target model can mirror production behavior.
- **Scope:** start with low-risk reads; then controlled dual-write for selected entities.
- **Dependencies:** Phase 3 backfill parity.
- **What changes:** selective dual-read and shadow dual-write.
- **What does NOT change:** user-facing routes and primary write source for critical flows until parity proven.
- **Validation:** drift monitors, checksum comparisons, queue/finance/lifecycle parity.
- **Rollback:** disable dual-write switch and reconcile from legacy source.
- **Go/No-Go:** zero critical drift over agreed observation window.

## Phase 5 — API adaptation

- **Purpose:** move API internals to target-backed services while preserving contracts.
- **Scope:** behind-the-scenes service swaps; keep route paths and payloads stable.
- **Dependencies:** Phase 4 drift stability.
- **What changes:** service implementation and data access layer.
- **What does NOT change:** external API contracts, auth semantics, imports.
- **Validation:** API regression suite + contract tests + latency SLO checks.
- **Rollback:** route-level feature flags revert endpoints to legacy handlers.
- **Go/No-Go:** all contract and performance gates pass.

## Phase 6 — Front-end cutover by department

- **Purpose:** transition to target department-based UI while retaining compatibility links.
- **Scope:** move navigation to target sections (Home, Project Development, Project Management, Engineering, Quality, Finance, Parties, Admin).
- **Dependencies:** stable APIs from Phase 5.
- **What changes:** nav grouping and default landing behavior.
- **What does NOT change:** legacy deep-link support and permission enforcement.
- **Validation:** role-by-role navigation smoke tests + deep-link tests.
- **Rollback:** switch nav config back to legacy section map.
- **Go/No-Go:** no role-access regressions and deep links remain functional.

## Phase 7 — Validation and shadow testing

- **Purpose:** production-like verification before deprecation.
- **Scope:** run shadow traffic comparisons, workflow replay tests, financial reconciliation windows.
- **Dependencies:** Phases 4–6 complete.
- **What changes:** monitoring and validation depth.
- **What does NOT change:** compatibility bridges and rollback capability.
- **Validation:** must-pass packs for auth, projects, tasks, approvals, finance, imports, audit.
- **Rollback:** maintain dual-path fallback until validation signoff.
- **Go/No-Go:** all must-pass suites green for agreed duration.

## Phase 8 — Controlled deprecation

- **Purpose:** retire legacy-only paths safely after sustained stability.
- **Scope:** deprecate unused aliases/routes/tables in controlled batches with observation windows.
- **Dependencies:** Phase 7 signoff + zero-traffic evidence for deprecated paths.
- **What changes:** staged deprecation toggles and cleanup migrations.
- **What does NOT change:** data retention, audit lineage, rollback snapshots.
- **Validation:** no consumer traffic on deprecated interfaces + no operational errors.
- **Rollback:** re-enable deprecated route aliases/table adapters from prior release bundles.
- **Go/No-Go:** explicit production change-approval gate.

---

## Section 7 feedback

- Completed scope: phased 0–8 migration blueprint with explicit non-change guarantees and rollback gates.
- Key findings: API and UI cutovers should happen only after prolonged dual-read/write validation.
- Risks identified now: sequence violations (especially moving UI before API parity) are the most likely source of production incidents.
- Recommendation before proceeding: Section 8 should finalize migration order and must-pass test packs plus Prompt 2 implementation brief.
- Ready for next section: **Yes**.
