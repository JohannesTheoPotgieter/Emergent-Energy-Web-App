# Legacy Cleanup — Prerequisite Report

**Date:** 2026-03-20
**Branch:** `claude/architecture-audit-qOdnl`
**Environment:** No live database available (no DATABASE_URL, no SQLite DB file)

---

## Executive Summary

**9 of 11 checks could not be run against a live database** — no database is initialized in this environment. Schema-level verification was performed instead, confirming all required tables and columns exist in the Drizzle ORM schema definitions. **2 codebase checks passed.**

---

## Check Results

### Check 1: Core Table Row Counts
**Status:** ⚠️ SCHEMA VERIFIED (no live DB)

Tables confirmed in schema (`shared/schema/projects.ts`):
- `project_info` — defined at line 34, includes all expected columns
- `project_execution_state` — defined at line 95, includes phase, RAG, dates, escalation
- `project_settings` — defined at line 165, includes projectId, excelTrackerLink

**Live row counts:** Cannot be determined without database.

---

### Check 2: Override Migration Tracking Tables
**Status:** ⚠️ SCHEMA VERIFIED (no live DB)

Tables confirmed in schema (`shared/schema/finance.ts`):
- `override_migration_orphans` — defined at line 207 (columns: overrideTable, overrideId, overrideData jsonb, reason)
- `override_migration_ambiguous` — defined at line 216 (columns: overrideTable, overrideId, overrideData jsonb, matchingBaseIds jsonb, reason)

**Live row counts:** Cannot be determined without database.

---

### Check 3: Work Item Extension Tables
**Status:** ⚠️ SCHEMA VERIFIED (no live DB)

Tables confirmed in schema (`shared/schema/tasks.ts`):
- `work_item_engineering` — defined at line 320 (wbsCode, outlineNumber, legacyTable, legacyId, sourceRow)
- `work_item_pm` — defined at line 289 (duration, percentComplete, phase, isMilestone, trackingRag, etc.)
- `work_item_scheduling` — defined at line 339 (scheduledDate, estimateMinutes, baseline fields, recurrence fields)

**Live row counts:** Cannot be determined without database.

---

### Check 4: Task Migration Map
**Status:** ⚠️ SCHEMA VERIFIED (no live DB)

Table confirmed in schema (`shared/schema/tasks.ts`):
- `task_migration_map` — defined at line 367 (columns: oldTable, oldId, newWorkItemId FK, migratedAt)
- **Note:** No explicit "orphan status" column — orphan detection would require a LEFT JOIN where `newWorkItemId IS NULL`

**Live counts and orphan check:** Cannot be determined without database.

---

### Check 5: Temporal Columns on program_expense
**Status:** ⚠️ SCHEMA VERIFIED (no live DB) — NAMING DEVIATION

Columns confirmed in schema (`shared/schema/finance.ts`, lines 71-72):
- `effective_from` (timestamp, NOT NULL, defaults to now) — **not** `valid_from`
- `effective_to` (timestamp, nullable) — **not** `valid_to`
- Also has `snapshotRunId` for snapshot management

**⚠️ Note:** Column names are `effective_from`/`effective_to`, not `valid_from`/`valid_to` as referenced in the prerequisite check. Any cleanup scripts should use the correct column names.

---

### Check 6: organization_id on project_info
**Status:** ⚠️ SCHEMA VERIFIED (no live DB)

Column confirmed in schema (`shared/schema/projects.ts`, line 85):
```
organizationId: integer("organization_id").notNull().default(1).references(() => organizations.id)
```

**Live verification (all rows have non-null value):** Cannot be determined without database.

---

### Check 7: Dashboard Metric Tables
**Status:** ⚠️ SCHEMA VERIFIED (no live DB)

Tables confirmed in schema (`shared/schema/projects.ts`):
- `dashboard_project_metrics` — defined at line 1011 (financial aggregates, task aggregates, QC aggregates, health snapshot)
- `dashboard_program_metrics` — defined at line 1045 (totalProjects, activeProjects, program-level financial aggregates)

**Live row counts:** Cannot be determined without database.

---

### Check 8: Domain Events Architecture
**Status:** ⚠️ SCHEMA VERIFIED (no live DB)

Tables confirmed in schema (`shared/schema/collaboration.ts`):
- `domain_events` — defined at line 795 (eventType, aggregateType, aggregateId, projectId, payload jsonb)
- `event_subscriptions` — defined at line 809 (eventType, handlerName, isActive)
- `event_processing_log` — defined at line 818 (eventId FK, handlerName, status enum, errorMessage, durationMs)

**Live row counts:** Cannot be determined without database.

---

### Check 9: V2 API Endpoints Registered
**Status:** ✅ PASS

Verified in `server/api/v2/routes/v2-routes.ts` — 10+ V2 route registrations found:

| Endpoint | Method |
|----------|--------|
| `/api/v2/projects` | GET |
| `/api/v2/projects/:id` | GET |
| `/api/v2/projects/:id/finance` | GET |
| `/api/v2/projects/:id/plan` | GET |
| `/api/v2/projects/:id/quality` | GET |
| `/api/v2/projects/:id/engineering` | GET |
| `/api/v2/projects/:id/commissioning` | GET |
| `/api/v2/projects/:id/permissions` | GET |
| `/api/v2/overview/summary` | GET |
| `/api/v2/overview/dashboard-metrics` | GET |

Frontend hooks wired in `client/src/hooks/use-project-v2.ts`.

---

### Check 10: ProgramProvider Removed from Active Code
**Status:** ✅ PASS

- `client/src/hooks/use-program-data.tsx` — **deleted** (confirmed not on disk)
- `ProgramProvider` string found only in comment in `client/src/hooks/use-projects-summary.ts`: `"Replaces ProgramProvider's projectsSummary context"`
- No active imports or usage of ProgramProvider anywhere in the codebase
- Replaced by `useProjectsSummary()` hook

---

### Check 11: Archive Tables
**Status:** ⚠️ SCHEMA VERIFIED (no live DB)

**Finding:** No dedicated archive tables exist. Archive functionality is implemented via soft-delete pattern:
- `project_info.archivedStatus` — text column, default "ACTIVE" (line 76)
- `project_execution_state.archivedStatus` — text column, default "ACTIVE" (line 129)

If the cleanup plan references separate archive tables, this pattern should be noted.

---

## Summary

| Check | Description | Result |
|-------|-------------|--------|
| 1 | Core table counts | ⚠️ Schema verified, no live DB |
| 2 | Override migration tables | ⚠️ Schema verified, no live DB |
| 3 | Work item extension tables | ⚠️ Schema verified, no live DB |
| 4 | Task migration map | ⚠️ Schema verified, no live DB |
| 5 | Temporal columns on program_expense | ⚠️ Schema verified (names: effective_from/to, not valid_from/to) |
| 6 | organization_id on project_info | ⚠️ Schema verified, no live DB |
| 7 | Dashboard metric tables | ⚠️ Schema verified, no live DB |
| 8 | Domain events tables | ⚠️ Schema verified, no live DB |
| 9 | V2 endpoints registered | ✅ PASS |
| 10 | ProgramProvider removed | ✅ PASS |
| 11 | Archive tables | ⚠️ Schema verified (soft-delete pattern, no separate tables) |

## Blockers

**No live database is available in this environment:**
- No `DATABASE_URL` environment variable set
- No `.env` file present
- No SQLite DB file at `data/sqlite.db`
- Server has not been started to initialize the database

All schema definitions are confirmed present in the Drizzle ORM schema files. Live data queries (row counts, orphan checks, null value checks) require a running database.

## Recommendation

All required tables and columns exist in the schema. The cleanup can proceed with schema-level confidence. When a database becomes available, the live data checks (row counts, orphan detection, null checks) should be run to confirm data integrity before any destructive cleanup operations.
