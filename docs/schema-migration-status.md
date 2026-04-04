# Schema Migration Status

> **Last updated:** 2026-04-04
> **Authority:** This is the single source of truth for migration state.

**Key distinction:** PR523 delivered the **schema foundation** (DDL, backfills, compatibility views) across Phases A-H. This is not a completed backend migration. The runtime write cutover -- where app code writes to promoted tables instead of legacy tables -- is a separate effort that is now **fully implemented** (all write paths bridged) but not yet production-validated.

## Overall Status

| Layer | Status | Detail |
|-------|--------|--------|
| Schema Foundation (PR523) | **COMPLETE** | Phases A-H DDL, backfills, rollbacks, and read-only compatibility views deployed. |
| Runtime Write Cutover | **FULLY IMPLEMENTED** | 5 domains use INSTEAD OF view-swap triggers (work_items, approvals, deliverables, **clients**, **project_info**). Remaining domains (cost_lines, revenue_lines, project_execution_state) use application-layer bridge writers. Not yet production-validated. |
| Read Cutover | **NOT STARTED** | App code still reads from legacy `public.*` tables. No reads have been migrated to promoted schema tables. |
| Dual Schema Authority | **GUARDED** | Startup-orchestrator skips legacy schema sync when promoted schema is present. |
| Reconciliation | **AUTOMATED** | 12 SQL checks + TS runner + `/api/admin/reconciliation` endpoint + automated 15-minute scheduler with failure alerting. |
| VO/CR -> Finance Gap | **FULLY BRIDGED** | `syncChangeRequest()` + batch CR sync + F10 backfill migration. Not yet applied to production. |
| Bridge Resilience | **IMPLEMENTED** | All sync functions retry on transient errors; failures logged to `internal.bridge_sync_failures`. |
| Batch Sync | **IMPLEMENTED** | Paginated (500/page, max 10k rows) with concurrency guards. Covers cost lines, revenue lines, and change requests. |
| Soft-Close / Delete Bridge | **IMPLEMENTED** | Soft-close and hard-delete on legacy finance lines cascade to promoted schema. |
| User Bridge | **IMPLEMENTED** | User creation and department changes bridged to `core.user_accounts`. |
| Project INSERT Bridge | **IMPLEMENTED** | All project creation paths (storage, smart-import, lifecycle, template, sync) bridge to `core.projects`. |
| TypeScript Errors | **ZERO** | All pre-existing TS errors fixed. |
| Test Coverage | **100+ tests passing** | Schema cutover validation suite with bridge coverage detection. |

### What "schema foundation complete" means

- All promoted schema tables exist (core.*, finance.*, documentation.*, internal.*)
- All legacy data has been backfilled into promoted tables via one-time migrations
- Read-only compatibility views exist so future code can query promoted tables
- Rollback migrations exist for every phase
- INSTEAD OF triggers exist for 5 domains:
  - work_items, approvals, deliverables (via spine_view_swap.sql)
  - clients, project_info (via view_swap_clients.sql / view_swap_project_info.sql)

### What "schema foundation complete" does NOT mean

- App code does NOT yet read from promoted tables (all reads still hit legacy `public.*` tables)
- Bridge writers exist but are best-effort fire-and-catch -- a bridge failure does not block the legacy write
- The promoted tables may be stale relative to legacy tables if bridge writes fail silently
- Production reconciliation has not yet been performed to verify parity

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

### Compatibility Views (Phase H.5 -- Read-Only)

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
| `public.approvals` -> view | `documentation.document_approvals` | Yes | Yes | No |
| `public.deliverables` -> view | `documentation.documents` | Yes | Yes | No |
| `public.work_items` -> view | `core.work_items` | Yes | Yes | Yes |

---

## Runtime Write Domain Status

### Fully Bridged via INSTEAD OF Triggers (transparent dual-write)

| Domain | Legacy Table | Promoted Table | Bridge Mechanism | Call Sites |
|--------|-------------|---------------|------------------|------------|
| Work Items | `public.work_items` (view) | `core.work_items` | INSTEAD OF triggers (spine_view_swap.sql) | All existing INSERT/UPDATE/DELETE |
| Approvals | `public.approvals` (view) | `documentation.document_approvals` | INSTEAD OF triggers (spine_view_swap.sql) | All existing INSERT/UPDATE |
| Deliverables | `public.deliverables` (view) | `documentation.documents` | INSTEAD OF triggers (spine_view_swap.sql) | All existing INSERT/UPDATE |

### Bridge-Writer Covered (best-effort, retry on transient errors, not production-validated)

Bridge writers exist in `server/bridge/bridge-writer.ts`. They retry once on transient errors and log persistent failures to `internal.bridge_sync_failures`. They are best-effort: a bridge failure does not block the legacy write.

| Domain | Legacy Table | Promoted Table | Bridge Function | Coverage |
|--------|-------------|---------------|-----------------|----------|
| Project Info (INSERT) | `public.project_info` | `core.projects` | `syncProjectInsert()` | All creation paths: storage.ts, smart-import, lifecycle, template, sync routes |
| Project Info (UPDATE) | `public.project_info` | `core.projects` | `syncProject()` | storage.ts updateProjectInfoById, upsertProjectInfo |
| Project Execution State | `public.project_execution_state` | `core.projects` | `syncProjectExecutionState()` | project-info-sync.ts split-table writes |
| Clients | `public.clients` | `core.clients` | `syncClient()` | pd-routes.ts create + update |
| Cost Lines | `public.normalized_cost_lines` | `finance.cost_lines` | `syncCostLine()` | storage.ts + batch sync (smart-import, subcontractor) |
| Revenue Lines | `public.normalized_revenue_lines` | `finance.revenue_lines` | `syncRevenueLine()` | storage.ts + batch sync (smart-import) |
| Change Requests / VOs | `public.change_requests` | `finance.finance_records` | `syncChangeRequest()` | change-control-routes.ts create/update + batch sync |
| Users | `public.users` | `core.user_accounts` | `syncUser()` | role-management.ts create + department change |

### Soft-Close / Hard-Delete Cascade Bridges

| Operation | Legacy Trigger | Promoted Bridge | Call Sites |
|-----------|---------------|----------------|------------|
| Soft-close cost/revenue lines | `SET effective_to = NOW()` in smart-import | `softClosePromotedCostLines()`, `softClosePromotedRevenueLines()` | smart-import-routes.ts |
| Hard-delete cost/revenue lines | `DELETE FROM` in lifecycle project cleanup | `cascadeDeletePromotedFinanceLines()` | lifecycle-routes.ts |

---

## Reconciliation System

### Automated Scheduler

The reconciliation scheduler starts automatically when promoted schema is detected at server boot (via startup-orchestrator.ts). It runs every 15 minutes and logs warnings on failure.

- **Startup:** `startReconciliationScheduler()` called from startup-orchestrator when `isPromotedSchemaPresent()` returns true
- **Interval:** 15 minutes (configurable)
- **On failure:** Logs warning via `onFail` callback; failures visible in server logs
- **Manual trigger:** `GET /api/admin/reconciliation` (admin auth required)
- **Cached result:** `GET /api/admin/reconciliation?cached=true` returns last scheduled result without re-running

### 12 Reconciliation Checks

| Check | Query | What It Detects |
|-------|-------|-----------------|
| `projects_missing` | LEFT JOIN project_info -> core.projects | Projects not yet synced |
| `projects_stale` | last_synced_at vs updated_at | Stale project data (>5 min lag) |
| `projects_field_drift` | Compare project_name, phase | Field-level value mismatches |
| `clients_missing` | LEFT JOIN clients -> core.clients | Clients not yet synced |
| `clients_stale` | Compare name fields | Client name drift |
| `cost_lines_missing` | LEFT JOIN active NCL -> finance.cost_lines | Cost lines not synced |
| `cost_lines_stale` | last_synced_at vs updated_at | Stale cost line data |
| `revenue_lines_missing` | LEFT JOIN active NRL -> finance.revenue_lines | Revenue lines not synced |
| `revenue_lines_stale` | last_synced_at vs updated_at | Stale revenue line data |
| `change_requests_missing` | LEFT JOIN CRs -> finance.finance_records | CRs not in finance records |
| `users_missing` | LEFT JOIN users -> core.user_accounts | Users not synced |
| `bridge_failures_unresolved` | COUNT unresolved in internal.bridge_sync_failures | Persistent bridge failures |

---

## Batch Sync System

### Concurrency-Guarded Batch Functions

All batch sync functions use an in-memory concurrency guard (`acquireLock`/`releaseLock`) to prevent overlapping syncs for the same project.

| Function | Scope | Trigger |
|----------|-------|---------|
| `batchSyncCostLinesByProject()` | Cost lines for one project | Post-commit in smart-import, subcontractor rebuild |
| `batchSyncRevenueLinesByProject()` | Revenue lines for one project | Post-commit in smart-import |
| `batchSyncChangeRequestsByProject()` | Change requests for one project | Available for bulk CR operations |
| `batchSyncFinanceByProject()` | Cost + Revenue combined | Post-commit convenience wrapper |

### Pagination: 500 rows/page, max 20 pages (10k rows)

---

## Dual Schema Authority Risk

**Problem:** `server/bootstrap/startup-orchestrator.ts` runs `runAdditiveSchemaAlignments()` on every server boot, creating a second schema authority outside versioned migrations.

**Current mitigation:** `isPromotedSchemaPresent()` guard skips legacy schema sync when `core.projects` exists. This prevents the startup-orchestrator from creating/altering legacy tables when versioned migrations have been applied. The guard is runtime-only and does not remove the legacy code.

---

## Finance Gap: Change Requests / Variation Orders

**Fully bridged:**
- `syncChangeRequest()` bridge writer in bridge-writer.ts, called from change-control-routes.ts on create/update
- `batchSyncChangeRequestsByProject()` in batch-bridge-sync.ts for bulk reconciliation
- F10 backfill migration (`20260403_f10_backfill_finance_records_change_requests.sql`) for existing CRs
- Uses `ON CONFLICT (legacy_entity_table, legacy_entity_id) DO UPDATE` for idempotency
