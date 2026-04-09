# Soft-Delete Migration: isActive → deletedAt

## Status

All 17 tables already have `deletedAt` columns. The remaining work is:
1. Backfill `deletedAt = NOW()` where `isActive = false`
2. Update queries from `isActive = true` → `deletedAt IS NULL`
3. Mark `isActive` deprecated (30-day observation → drop)

## Migration Order

One table per PR. Priority order based on query frequency and risk:

| # | Table | Schema File | isActive Filters | SELECT Refs | Has deletedAt | Status |
|---|-------|------------|-----------------|-------------|---------------|--------|
| 1 | project_execution_state | projects.ts:161 | 9 | 6 | Yes | **This PR** |
| 2 | project_info | projects.ts (via joins) | Many | Many | Yes | Pending |
| 3 | counterparties | finance.ts:399 | Few | Few | Yes | Pending |
| 4 | users | users.ts:11 | Few | Few | Yes | Pending |
| 5 | working_plan_scenario | finance.ts:231 | Few | Few | Yes | Pending |
| 6 | invoice_pattern_rules | finance.ts:563 | Few | Few | Yes | Pending |
| 7 | qc_template | quality.ts:15 | Few | Few | Yes | Pending |
| 8 | eng_stage_templates | engineering.ts:127 | Few | Few | Yes | Pending |
| 9 | sp_files | imports.ts:47 | Few | Few | Yes | Pending |
| 10 | intake_task_templates | imports.ts:368 | Few | Few | Yes | Pending |
| 11 | counterparty_contacts | finance.ts:432 | Few | Few | Yes | Pending |
| 12 | financial_integration_rules | finance.ts:803 | Few | Few | Yes | Pending |
| 13 | standup_schedules | collaboration.ts:780 | Few | Few | Yes | Pending |
| 14 | event_subscriptions | collaboration.ts:842 | Few | Few | Yes | Pending |
| 15 | phase_template | projects.ts:609 | Few | Few | Yes | Pending |
| 16 | stage_gate_definitions | projects.ts:734 | Few | Few | Yes | Pending |
| 17 | stage_gate_overrides | projects.ts:767 | Few | Few | Yes | Pending |

## PR 1: project_execution_state

### Affected Queries (isActive filters)

| File | Line | Usage | Migration |
|------|------|-------|-----------|
| server/api/v2/repositories/project-v2-repository.ts | 7 | `eq(projectExecutionState.isActive, true)` | → `isNull(projectExecutionState.deletedAt)` |
| server/api/v2/repositories/project-v2-repository.ts | 352-353 | `eq(projectExecutionState.isActive, true)` | → `isNull(projectExecutionState.deletedAt)` |
| server/services/project-access-service.ts | 74, 94 | `eq(projectExecutionState.isActive, true)` | → `isNull(projectExecutionState.deletedAt)` |
| server/services/exception-dashboard-service.ts | 123 | `eq(projectExecutionState.isActive, true)` | → `isNull(projectExecutionState.deletedAt)` |
| server/storage.ts | 1055 | `eq(projectExecutionState.isActive, true)` | → `isNull(projectExecutionState.deletedAt)` |
| server/storage.ts | 1041 | `SET is_active = true` | → `SET deleted_at = NULL` |
| server/storage.ts | 1045 | `SET is_active = false` | → `SET deleted_at = NOW()` |
| server/template-routes.ts | 699, 833 | `eq(projectExecutionState.isActive, true)` | → `isNull(projectExecutionState.deletedAt)` |
| server/routes.ts | 1786 | `isActive IS NOT FALSE` | → `deleted_at IS NULL` |

### SELECT-only references (read isActive field, no filtering)

These SELECT fields that just read `isActive` for the response payload are left
temporarily — they'll return the deprecated column value during the observation window.

| File | Line | Usage |
|------|------|-------|
| server/portfolio-routes.ts | 56, 513 | SELECT isActive |
| server/lifecycle-routes.ts | 289 | SELECT isActive |
| server/template-routes.ts | 830 | SELECT isActive |
| server/pm-routes.ts | 54 | SELECT isActive |
| server/departments/fye-revenue-tracking-routes.ts | 627, 1259 | SELECT isActive |
| server/services/project-lifecycle-workspace-service.ts | 610 | SELECT isActive |

## Rules

- `isActive = true` is replaced by `deletedAt IS NULL`
- `isActive = false` is replaced by `deletedAt IS NOT NULL`
- `SET is_active = true` becomes `SET deleted_at = NULL`
- `SET is_active = false` becomes `SET deleted_at = NOW()`
- `isActive` column stays in schema for 30 days (marked @deprecated)
- Drop `isActive` in separate cleanup PR after zero query dependencies confirmed
