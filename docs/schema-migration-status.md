# Schema Migration Status

> **Last updated:** 2026-04-03
> **Authority:** This is the single source of truth for migration state.

**Key distinction:** PR523 delivered the **schema foundation** (DDL, backfills, compatibility views) across Phases A–H. This is not a completed backend migration. The runtime write cutover — where app code writes to promoted tables instead of legacy tables — is a separate effort that is partially implemented via bridge writers but not yet production-validated.

## Overall Status

| Layer | Status | Detail |
|-------|--------|--------|
| Schema Foundation (PR523) | **COMPLETE** | Phases A-H DDL, backfills, rollbacks, and read-only compatibility views deployed. |
| Runtime Write Cutover | **PARTIALLY IMPLEMENTED** | Bridge writer code exists for all 8 domains. 3 domains use INSTEAD OF triggers (work_items, approvals, deliverables). 5 domains use best-effort bridge writers (not yet production-validated). |
| Read Cutover | **NOT STARTED** | App code still reads from legacy `public.*` tables. No reads have been migrated to promoted schema tables. |
| Dual Schema Authority | **GUARDED** | Startup-orchestrator skips legacy schema sync when promoted schema is present. |
| Reconciliation | **IMPLEMENTED** | SQL checks + TS runner + `/api/admin/reconciliation` health endpoint. Not yet run against production data. |
| VO/CR → Finance Gap | **BRIDGE CODE WRITTEN** | `syncChangeRequest()` + F10 backfill migration exist. Not yet applied to production. |
| Bridge Resilience | **IMPLEMENTED** | All sync functions retry on transient errors; failures logged to `internal.bridge_sync_failures`. |
| Batch Sync Pagination | **IMPLEMENTED** | Paginated (500/page, max 10k rows). |
| TypeScript Errors | **ZERO** | All pre-existing TS errors fixed. |
| Test Coverage | **85 tests passing** | Schema cutover validation suite. |

### What "schema foundation complete" means

- All promoted schema tables exist (core.*, finance.*, documentation.*, internal.*)
- All legacy data has been backfilled into promoted tables via one-time migrations
- Read-only compatibility views exist so future code can query promoted tables
- Rollback migrations exist for every phase
- INSTEAD OF triggers exist for 3 domains (work_items, approvals, deliverables) via spine_view_swap.sql

### What "schema foundation complete" does NOT mean

- App code does NOT yet write primarily to promoted tables (legacy tables are still the write target for most domains)
- App code does NOT yet read from promoted tables (all reads still hit legacy `public.*` tables)
- Bridge writers exist but are best-effort fire-and-catch — a bridge failure does not block the legacy write
- The promoted tables may be stale relative to legacy tables if bridge writes fail silently
- No production reconciliation has been performed to verify parity between legacy and promoted data

---

## PR523 Phases Delivered

| Phase | Domain | DDL | Backfill | Rollback | Compat View |
|-------|--------|-----|----------|----------|-------------|
| A | Parties, Users, Roles | Yes | Yes | Yes | N/A |
| B | Project Types, Instances, Info, Party Links, Phase Defs | Yes | Yes | Yes | N/A |
| C | Work Packages, Work Items, Dependencies | Yes | Yes | Yes | N/A |
| D | Governed Processes | Yes | Yes | Yes | N/A |
| E | Deliverables, Approvals | Yes | Yes | Yes | N/A |
| F | Unified Finance (finance_records, budget_lines) | Yes | Yes | Yes | N/A |
| G | External Resources, Activity/Audit Logs | Yes | Yes | Yes | N/A |
| H | Strategic Priorities, Import Batches, Compatibility Views | Yes | Yes | Yes | Yes |

### Compatibility Views (Phase H.5 — Read-Only)

| View | Schema | Source Tables | INSTEAD OF Triggers |
|------|--------|---------------|---------------------|
| `core.v_projects` | core | project_instances, projects, project_types, phase_definitions | No |
| `core.v_work_items` | core | work_items_clean, work_packages, parties | No |
| `finance.v_finance_records` | finance | finance_records, project_instances, projects, parties, fiscal_periods | No |
| `core.v_deliverables` | core | deliverable_instances, deliverable_definitions, parties | No |
| `core.v_approvals` | core | approval_instances, parties | No |
| `core.v_governed_processes` | core | governed_processes, phase_definitions, parties | No |

### View-Swap INSTEAD OF Triggers (spine_view_swap.sql)

These replace legacy `public.*` tables with views that write-through to promoted tables:

| Legacy Table | Promoted Table | INSERT Trigger | UPDATE Trigger | DELETE Trigger |
|-------------|---------------|----------------|----------------|----------------|
| `public.approvals` → view | `documentation.document_approvals` | Yes | Yes | No |
| `public.deliverables` → view | `documentation.documents` | Yes | Yes | No |
| `public.work_items` → view | `core.work_items` | Yes | Yes | Yes |

---

## Runtime Write Domain Status

### Fully Bridged (writes propagate to promoted schema)

| Domain | Legacy Table | Promoted Table | Bridge Mechanism | Call Sites |
|--------|-------------|---------------|------------------|------------|
| Work Items | `public.work_items` (view) | `core.work_items` | INSTEAD OF triggers (spine_view_swap.sql) | All existing INSERT/UPDATE/DELETE |
| Approvals | `public.approvals` (view) | `documentation.document_approvals` | INSTEAD OF triggers (spine_view_swap.sql) | All existing INSERT/UPDATE |
| Deliverables | `public.deliverables` (view) | `documentation.documents` | INSTEAD OF triggers (spine_view_swap.sql) | All existing INSERT/UPDATE |

### Bridge-Writer Covered (best-effort, retry on transient errors, not production-validated)

Bridge writers exist in `server/bridge/bridge-writer.ts`. They retry once on transient errors and log persistent failures to `internal.bridge_sync_failures`. However, they are best-effort: a bridge failure does not block the legacy write.

| Domain | Legacy Table | Promoted Table | Bridge Function | Coverage Notes |
|--------|-------------|---------------|-----------------|----------------|
| Project Info | `public.project_info` | `core.projects` | `syncProject()` | UPDATE only; called from storage.ts on project updates |
| Project Execution State | `public.project_execution_state` | `core.projects` | `syncProjectExecutionState()` | Called via project-info-sync.ts on split-table writes |
| Clients | `public.clients` | `core.clients` | `syncClient()` | Called from routes.ts and pd-routes.ts on client create/update |
| Cost Lines | `public.normalized_cost_lines` | `finance.cost_lines` | `syncCostLine()` | Called from storage.ts + batch sync from smart-import and subcontractor routes |
| Revenue Lines | `public.normalized_revenue_lines` | `finance.revenue_lines` | `syncRevenueLine()` | Called from storage.ts + batch sync from smart-import routes |
| Change Requests / VOs | `public.change_requests` | `finance.finance_records` | `syncChangeRequest()` | Called from change-control-routes.ts on create/update |

### Outstanding gaps in bridge coverage

- `syncProject()` covers UPDATE only — no INSERT bridge for new projects
- Bulk imports (smart-import, subcontractor rebuild) use post-commit batch sync, which means promoted tables are briefly stale during the transaction
- Soft-close / delete operations on cost/revenue lines are not explicitly bridged
- No bridge writer for `users` → `core.user_accounts`

---

## Dual Schema Authority Risk

**Problem:** `server/bootstrap/startup-orchestrator.ts` runs `runAdditiveSchemaAlignments()` on every server boot which executes:
1. `script/pre-push-enums.sql` — creates/updates enum types
2. `script/full-schema-alignment.sql` — adds columns via ALTER TABLE IF NOT EXISTS
3. Inline `CREATE TABLE IF NOT EXISTS` statements for ~20 legacy tables

This creates a second schema authority outside versioned migrations. Risks:
- Column definitions may drift between startup-orchestrator and migrations
- Table structure can change without migration history
- Promoted schema tables are NOT managed by startup-orchestrator (only legacy public.* tables)

**Current mitigation:** `isPromotedSchemaPresent()` guard in startup-orchestrator.ts skips legacy schema sync when `core.projects` exists. This prevents the startup-orchestrator from creating/altering legacy tables when versioned migrations have been applied. The guard is runtime-only and does not remove the legacy code — it can be bypassed if the promoted schema is dropped.

---

## Finance Gap: Change Requests / Variation Orders

**Previous gap:** Change requests / variation orders were not represented in the unified finance view.

**Current state (code written, not production-validated):**
- `syncChangeRequest()` bridge writer exists in bridge-writer.ts, called from change-control-routes.ts on create/update
- F10 backfill migration (`20260403_f10_backfill_finance_records_change_requests.sql`) exists to backfill existing CRs into `finance.finance_records`
- F10 backfill has not been applied to production
- Bridge writes to `finance.finance_records` use `ON CONFLICT (legacy_entity_table, legacy_entity_id) DO UPDATE` for idempotency
