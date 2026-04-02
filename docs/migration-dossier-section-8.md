# Migration Dossier — Section 8 (Migration Order, Test Strategy, and Prompt 2 Handoff)

## Completed scope

Section 8 from the chunked plan: finalize safest migration order, per-phase test strategy, and exact Prompt 2 implementation handoff.

---

## 1) Recommended migration order (safest sequence)

1. **Identities and roles first**
   - Foundation for every permissioned route/screen.
   - Includes role definition mapping, role assignment bridges, and auth parity checks.

2. **Parties second**
   - Build `party` graph from users/clients/counterparties/stakeholders while preserving legacy lookups.

3. **Projects third**
   - Establish project-instance and project-info bridge while preserving projectName route compatibility.

4. **Phases/lifecycle fourth**
   - Migrate stage/phase semantics only after project identity bridge is stable.

5. **Work packages/work items fifth**
   - Map existing work_item + extensions to target structure with dependency parity.

6. **Governed processes sixth**
   - Move checklist/requirement models with lifecycle-aware authority controls.

7. **Deliverables/approvals seventh**
   - Consolidate approval/evidence flows only after lifecycle + work parity is proven.

8. **Finance eighth**
   - Delay until identity, approvals, and import bridges are stable; preserve lineage and dual-id compatibility.

9. **Resources/evidence ninth**
   - Complete external resource + resource link harmonization once owning entities stabilize.

10. **Front-end navigation last**
   - Department-based UI cutover only when backend model and API contracts are stable.

---

## 2) Must-pass test strategy (pre-migration + per phase)

## A. Universal test packs
- **Schema validation:** FK integrity, nullability, unique constraints, index presence.
- **Data reconciliation:** source vs target row counts, key fields, status distributions, checksum samples.
- **API regression:** contract snapshots for high-traffic endpoints.
- **Route regression:** legacy redirects, aliases, deep links, role-based route access.
- **UI smoke tests:** role-based nav, project detail, approvals, gates, finance pages.
- **Critical workflow tests:** create/edit project, task lifecycle, gate transition, approval action.
- **Import tests:** upload → detect → resolve issues → commit → rollback.
- **Finance integrity tests:** revenue/cos/cashflow totals by project/time.
- **Approval/gate tests:** queue parity and action side-effects.
- **Audit trail tests:** events logged in both legacy and target feeds.

## B. Per-phase must-pass gates

- **Phase 0:** baseline metric capture complete.
- **Phase 1:** additive DDL passes; no API shape change.
- **Phase 2:** bridge reads parity >= agreed threshold.
- **Phase 3:** backfill parity and unresolved mappings below threshold.
- **Phase 4:** dual-write drift = 0 for critical entities across observation window.
- **Phase 5:** API contract tests 100% pass; latency within SLO.
- **Phase 6:** role-by-role UI + deep link tests pass.
- **Phase 7:** shadow testing parity and workflow replay pass.
- **Phase 8:** zero-traffic proof for deprecated interfaces and no operational alerts.

---

## 3) Exact next implementation prompt for Prompt 2

Use the following prompt verbatim for implementation planning/execution kickoff:

```text
You are implementing Phase 1 and Phase 2 of a live-safe migration in an already working production app.

NON-NEGOTIABLE:
- No data loss.
- No destructive migrations.
- No dropping tables/columns/routes.
- Preserve existing auth, navigation, API contracts, and imports.
- Use additive schema changes + compatibility adapters + feature flags.

CONTEXT:
- The migration dossier Sections 1–8 exists in docs/migration-dossier-section-*.md.
- Active compatibility requirements include:
  - users bridge retention
  - project_execution_state retention
  - project_stage_requirements/evidence/decisions retention
  - workstream filters retention
  - project_info.projectName route compatibility retention

YOUR TASKS:
1) Produce additive SQL/Drizzle migrations for Phase 1 target-spine introduction only.
2) Implement Phase 2 compatibility adapters for:
   - projectName↔projectId resolver
   - route-level compatibility wrappers for legacy projectName endpoints
   - read adapters for approval/evidence aggregate queries
3) Add feature flags controlling every new read/write path.
4) Add reconciliation scripts and checks for parity (counts + key fields) without changing primary write authority.
5) Add tests:
   - migration/app startup sanity
   - API contract regression for touched endpoints
   - compatibility route tests for legacy paths
   - parity checks for resolver/adapter outputs
6) Provide rollback instructions per change (flag-off + handler fallback + data checkpoint).

OUTPUT FORMAT:
A. Files changed
B. Migrations added (with safety notes)
C. Adapters/flags added
D. Tests added and results
E. Rollback runbook
F. Open risks

Do not proceed beyond Phase 2 in this implementation step.
```

---

## Section 8 feedback

- Completed scope: finalized migration order, phase-gated test strategy, and exact Prompt 2 handoff.
- Key findings: UI cutover must be last; finance and approvals should be late-phase after stable identity/project/lifecycle groundwork.
- Risks identified now: skipping parity gates between phases will create hidden production drift.
- Recommendation: begin Prompt 2 with Phase 1–2 only, feature-flagged and reversible.
- Ready for dossier assembly: **Yes**.
