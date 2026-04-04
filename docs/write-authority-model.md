# Write Authority Model

## Overview

This document describes the write authority model for the eight core domains that bridge legacy and promoted schemas.

The primary mechanism is **view-swap (INSTEAD OF triggers):** The legacy table is renamed to `_<table>_legacy`, replaced by a view reading from the promoted table, and all writes are transparently routed to both promoted AND legacy tables at the database level. This provides **100% write coverage** with zero application code changes.

A secondary **application-layer bridge** provides complementary sync for existing call sites. These are now redundant with the DB-level triggers but retained as a safety net during the transition period.

## Domains

| Domain | Legacy Table | Promoted Table | Mechanism | Coverage |
|---|---|---|---|---|
| Projects | `project_info` | `core.projects` | **View-swap** | **100%** |
| Execution State | `project_execution_state` | `core.projects` + `core.project_state_history` | **View-swap** | **100%** |
| Clients | `clients` | `core.clients` | **View-swap** | **100%** |
| Cost Lines | `normalized_cost_lines` | `finance.cost_lines` | **View-swap** | **100%** |
| Revenue Lines | `normalized_revenue_lines` | `finance.revenue_lines` | **View-swap** | **100%** |
| Work Items | `work_items` | `core.work_items` | **View-swap** | **100%** |
| Approvals | `approvals` | `documentation.document_approvals` | **View-swap** | **100%** |
| Deliverables | `deliverables` | `documentation.documents` | **View-swap** | **100%** |

## Write Flow (All Domains — View-Swap)

1. **Caller** issues INSERT/UPDATE/DELETE to the legacy table name (e.g. `public.normalized_cost_lines`)
2. These are now **views** backed by promoted tables
3. **INSTEAD OF triggers** intercept the DML and:
   - Write to the promoted table (e.g. `finance.cost_lines`)
   - Also write to `_<table>_legacy` for rollback safety
4. **No application code changes required.** Every legacy write path is automatically covered.

### Special Behaviors by Domain

**project_execution_state:** The UPDATE trigger also creates a snapshot in `core.project_state_history` (matching the existing `syncProjectExecutionState()` + `snapshotProjectState()` behavior). Previous snapshots are marked `is_current = false`.

**normalized_cost_lines / normalized_revenue_lines:** The INSERT and UPDATE triggers derive:
- `invoice_date_typed`, `approved_date_typed`, `paid_date_typed` — parsed from TEXT date columns via `_safe_parse_date()` helper
- `fiscal_period_id` — looked up from `finance.fiscal_periods` matching the typed invoice date
- `project_id` — resolved from `project_name` via `core.projects` when not provided directly

**normalized_cost_lines / normalized_revenue_lines DELETE:** Performs soft-close (sets `effective_to = NOW()`) in the promoted table rather than hard-delete, preserving audit trail.

## Application-Layer Bridge Writers (Complementary)

Bridge writers in `server/bridge/bridge-writer.ts` provide a secondary sync path. With DB-level triggers now handling all writes, these are retained during transition but are no longer the primary sync mechanism.

### Project
- `syncProjectInsert(row)` — full upsert after INSERT
- `syncProject(partialRow)` — partial UPDATE after field changes
- `syncProjectDelete(projectId)` — marks promoted project deleted/archived
- `syncProjectExecutionState(projectId, fields)` — syncs execution state columns + creates snapshot
- `snapshotProjectState(projectId)` — full re-read and sync

### Client
- `syncClient(row)` — full upsert after INSERT or UPDATE

### Finance Lines
- `syncCostLine(row)` — full upsert after INSERT
- `syncRevenueLine(row)` — full upsert after INSERT
- `syncCostLineFieldUpdate(legacyId, fields)` — targeted UPDATE using COALESCE
- `syncRevenueLineFieldUpdate(legacyId, fields)` — targeted UPDATE using COALESCE
- `syncCostLineCounterpartyBulk(oldName, newName)` — bulk counterparty rename
- `softClosePromotedCostLines(projectId, projectName)` — soft-close promoted cost lines
- `softClosePromotedRevenueLines(projectId, projectName)` — soft-close promoted revenue lines
- `batchSyncFinanceByProject(projectId, projectName)` — full re-sync after legacy bulk import

### Bridge Catch Handler
All bridge calls use `.catch(bridgeCatch)` instead of bare `.catch(() => {})`. The `bridgeCatch` handler:
- Logs a `console.warn` message for visibility
- Increments `_bridgeFailureCount` counter queryable via `getBridgeFailureCount()`

## Legacy-Only Fields (Now Promoted)

With the view-swap approach, all legacy columns are now present in the promoted tables. The following were added specifically for view-swap completeness:

### Cost Lines (added to `finance.cost_lines`)
- `pattern_rule_id` — pattern matching rule reference
- `pattern_classified_at` — classification timestamp
- `pattern_inferred_type` — inferred cost type
- `admin_date_override`, `admin_date_override_reason`, `admin_date_override_by`, `admin_date_override_at`
- `amount_ex_vat_legacy` — original TEXT column preserved for rollback

### Revenue Lines (added to `finance.revenue_lines`)
- `admin_date_override`, `admin_date_override_reason`, `admin_date_override_by`, `admin_date_override_at`
- `amount_ex_vat_legacy`, `vat_legacy` — original TEXT columns preserved for rollback

### Project Execution State (added to `core.projects`)
- `legacy_execution_state_id` — preserves the PK mapping from the legacy table

## Rollback Strategy

Each view-swap migration has a corresponding rollback script:

| Migration | Rollback |
|-----------|----------|
| `20260403_spine_view_swap.sql` | Drop triggers/views, rename `_legacy` back |
| `20260404_view_swap_clients.sql` | `20260404_view_swap_clients_rollback.sql` |
| `20260404_view_swap_project_info.sql` | `20260404_view_swap_project_info_rollback.sql` |
| `20260404_view_swap_project_execution_state.sql` | `20260404_view_swap_project_execution_state_rollback.sql` |
| `20260404_view_swap_normalized_cost_lines.sql` | `20260404_view_swap_normalized_cost_lines_rollback.sql` |
| `20260404_view_swap_normalized_revenue_lines.sql` | `20260404_view_swap_normalized_revenue_lines_rollback.sql` |

Rollback procedure: Run the rollback SQL, which drops triggers/functions/views and renames `_<table>_legacy` back to the original name. The legacy table has been kept in sync by the INSTEAD OF triggers, so it contains all data.

## Cutover Roadmap

1. **Current (Phase 2)**: All 5 legacy base tables use view-swap triggers for 100% transparent dual-write. Reads still come from legacy table names (which are now views).
2. **Phase 3**: Shadow reads — read from both legacy views and promoted tables directly, compare results, log discrepancies.
3. **Phase 4**: Promoted-first reads — switch reads to promoted tables, keep legacy backup.
4. **Phase 5**: Full cutover — promoted tables become sole authority, legacy `_legacy` tables and views removed.
