# Write Authority Model

## Overview

This document describes the write authority model for the five core domains that bridge legacy and promoted schemas.

Two mechanisms are used:
- **View-swap (INSTEAD OF triggers):** The legacy table is renamed, replaced by a view, and all writes are transparently routed to the promoted table at the database level. This provides **100% write coverage** with zero application code changes.
- **Application-layer bridge (legacy-first dual-write):** Every mutation hits the legacy table first, then a fire-and-forget bridge call syncs to the promoted schema. Coverage depends on how many write paths call the bridge.

## Domains

| Domain | Legacy Table | Promoted Table | Mechanism | Coverage |
|---|---|---|---|---|
| Projects | `project_info` | `core.projects` | **View-swap** | **100%** |
| Execution State | `project_execution_state` | `core.projects` (subset) | Application bridge | Partial |
| Clients | `clients` | `core.clients` | **View-swap** | **100%** |
| Cost Lines | `normalized_cost_lines` | `finance.cost_lines` | Application bridge | Partial |
| Revenue Lines | `normalized_revenue_lines` | `finance.revenue_lines` | Application bridge | Partial |

## Write Flow (View-Swap Domains)

1. **Caller** issues INSERT/UPDATE/DELETE to `public.project_info` or `public.clients`
2. These are now **views** backed by promoted tables
3. **INSTEAD OF triggers** intercept the DML and:
   - Write to the promoted table (core.projects / core.clients)
   - Also write to `_<table>_legacy` for rollback safety
4. **No application code changes required.** Every legacy write path is automatically covered.

## Write Flow (Bridge Domains)

1. **Caller** invokes a write-service function (e.g. `createCostLine`)
2. **Write service** performs the legacy INSERT/UPDATE/DELETE via Drizzle ORM
3. **Write service** calls the appropriate bridge-writer function (e.g. `syncCostLine`)
4. **Bridge writer** maps legacy columns to promoted columns and issues a SQL upsert/update
5. Bridge calls are best-effort (`.catch(() => {})`) and never block the legacy write

All write services accept a `txOrDb` parameter so they can participate in existing transactions.

## Bridge Writer Functions

### Project
- `syncProjectInsert(row)` — full upsert after INSERT
- `syncProject(partialRow)` — partial UPDATE after field changes
- `syncProjectDelete(projectId)` — marks promoted project deleted/archived
- `syncProjectExecutionState(projectId, fields)` — syncs current_stage_code, gate_status, financial review status
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

## Legacy-Only Fields

The following fields exist only in the legacy schema and are **not** synced to promoted tables. They require no bridge calls:

### Cost Lines
- `patternRuleId` — pattern matching rule reference
- `patternClassifiedAt` — classification timestamp
- `patternInferredType` — inferred cost type
- `adminDateOverride` — admin-overridden date
- `adminDateOverrideReason` — reason for override
- `adminDateOverrideBy` — user who applied override
- `adminDateOverrideAt` — timestamp of override
- `counterpartyId` — legacy FK to counterparties
- `counterpartyType` — legacy counterparty type enum

### Revenue Lines
- `patternRuleId`, `patternClassifiedAt`, `patternInferredType` — same as cost lines
- `adminDateOverride`, `adminDateOverrideReason`, `adminDateOverrideBy`, `adminDateOverrideAt` — same as cost lines

## Deferred Paths

The following write paths are deferred to a future backfill phase:

### Template Instantiation
- `template-routes.ts` creates projects from templates. These use `INSERT INTO project_info` followed by `syncProjectInsert`, but template-specific metadata columns are not yet part of the promoted schema.

### Bulk Data Migration
- Historical data backfill from CSV/Excel imports is handled by `batchSyncFinanceByProject` which does a full re-read and sync after bulk insert. This is a reconciliation approach rather than per-row bridging.

### Soft-Delete Reconciliation
- When legacy soft-deletes (setting `effective_to`) are performed in bulk, the promoted side uses `softClosePromoted*Lines` functions. A periodic backfill job should verify consistency between legacy and promoted soft-close states.

## Cutover Roadmap

1. **Current (Phase 2)**: Legacy-first with bridge sync. All reads still come from legacy tables.
2. **Phase 3**: Shadow reads — read from both legacy and promoted, compare results, log discrepancies.
3. **Phase 4**: Promoted-first reads — switch reads to promoted tables, keep legacy writes as backup.
4. **Phase 5**: Full cutover — promoted tables become sole authority, legacy tables archived.
