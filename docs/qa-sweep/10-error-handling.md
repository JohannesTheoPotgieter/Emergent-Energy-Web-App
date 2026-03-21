# QA Sweep 10 — Error Handling + Edge Cases

**Date:** 2026-03-21
**Status:** PASS WITH OBSERVATIONS — Solid error handling foundation with specific gaps to address

---

## 1. Missing Data Scenarios

### 1.1 project_execution_state Row Missing

| Aspect | Detail |
|--------|--------|
| **Backfill guard** | `server/bootstrap/backfills/integrity-guard.ts:18-34` — On startup, inserts missing `project_execution_state` rows via `INSERT ... WHERE NOT EXISTS ... ON CONFLICT DO NOTHING` |
| **Runtime behaviour** | Routes use `LEFT JOIN` to `project_execution_state` (e.g. `server/quality-routes.ts:147-151`). If the row is absent, the spread `{ ...r.project_execution_state }` yields `undefined`, so `phase`, `ragStatus`, etc. become `undefined` on the merged project object |
| **Verdict** | **LOW RISK** — Backfill prevents the scenario at startup. A race window exists if a project is created and queried before the next backfill, but the `LEFT JOIN` pattern avoids crashes — fields will simply be `null`/`undefined` |

### 1.2 work_item With No Extension Table Row

| Aspect | Detail |
|--------|--------|
| **Query pattern** | `server/lib/work-item-queries.ts:96-108` — All queries use `LEFT JOIN` on `work_item_pm`, `work_item_engineering`, `work_item_scheduling` |
| **Verdict** | **PASS** — Extension columns are nullable when joined; General workstream items correctly return `null` for extension fields |

### 1.3 dashboard_project_metrics Not Refreshed

| Aspect | Detail |
|--------|--------|
| **Backfill** | `server/bootstrap/backfills/integrity-guard.ts:54-81` — Inserts placeholder rows with all-zero metric values for projects without metrics |
| **Refresh failures** | `server/services/dashboard-metrics.ts:260-277` — Catches per-project errors, logs warning, continues to next project. Silent failures mean stale/zero metrics are served |
| **Fire-and-forget** | `refreshProjectMetricsAsync()` (line 364) catches errors but never reports them to callers |
| **Verdict** | **OBSERVATION** — Zero-backfilled rows prevent crashes but can display misleading data. No mechanism to surface stale-metric warnings to the dashboard UI |

### 1.4 Corrupted JSON in import_snapshot

| Aspect | Detail |
|--------|--------|
| **CRITICAL** | `server/lib/inline-edit-helper.ts:113` — `JSON.parse(rows[0].import_snapshot)` has **no try-catch**. Corrupted JSON will throw an uncaught `SyntaxError` and crash the request |
| **Also unprotected** | `server/handover-routes.ts` at lines 175, 359, 427, 512 — multiple `JSON.parse()` calls on `checked_items`, `details`, `deliverables` without try-catch |
| **Good example** | `server/quality-routes.ts:128-138` — `normalizeHandoverRow()` wraps `JSON.parse()` in try-catch and falls back to `{}` |
| **Verdict** | **NEEDS FIX** — Unprotected `JSON.parse()` in `inline-edit-helper.ts` and `handover-routes.ts` can crash requests on corrupted data |

---

## 2. Auth + Permission Edge Cases

### 2.1 Permissions Object Missing From API Response

| Aspect | Detail |
|--------|--------|
| **V2 API guarantee** | `server/api/v2/controllers/v2-controller.ts:370-412` — All consolidated project endpoints call `computeProjectPermissions(req)` in parallel and embed result. Always returns an object |
| **Client fallback** | `client/src/components/PermissionGate.tsx:28-37` — If `serverPermissions` prop is null/undefined, falls back to `usePermission` hook which queries `/api/auth/permissions` independently |
| **Hook behaviour** | `client/src/hooks/use-permissions.ts:41-42` — Returns `{ allowed: false, loading: false }` when user is null |
| **Verdict** | **PASS** — Dual fallback ensures permission checks never crash even if server omits the permissions object |

### 2.2 User's Role Deleted While Logged In

| Aspect | Detail |
|--------|--------|
| **Deletion guard** | `server/role-management.ts:492-495` — Refuses role deletion with `409 Conflict` if any users still assigned |
| **Null role fallback** | `server/permission-middleware.ts:108` → `shared/schema/users.ts:207-210` — `normalizeRoleForPermissions(null)` returns `""` (empty string) |
| **Minimal permissions** | `/api/auth/permissions` returns `{ sections: ["PROJECTS"], canManageUsers: false, canManageRoles: false, canEditData: false }` for unknown/empty roles |
| **Verdict** | **PASS** — Role deletion is blocked when users exist. Even if role somehow becomes invalid, system degrades gracefully to read-only project access |

### 2.3 Permission Audit Trail

| Aspect | Detail |
|--------|--------|
| **Audit events** | `server/permission-audit.ts` — Logs `role_created`, `role_updated`, `role_deleted`, `role_cloned`, `role_archived`, `user_role_changed` |
| **Failure logging** | `server/permission-middleware.ts:198` — `logPermissionFailure()` records entity, action, and reason |
| **Verdict** | **PASS** — Comprehensive audit trail for permission-related operations |

---

## 3. Concurrent Edit Handling

### 3.1 Last-Write-Wins on Financial Rows

| Aspect | Detail |
|--------|--------|
| **No optimistic locking** | `server/departments/finance-routes.ts:2759-2771` — Direct `UPDATE ... WHERE id = ?` with no version/timestamp check |
| **No transactions** | Finance inline edits use `db.update()` directly — not wrapped in transactions |
| **No ETags** | No `ETag`, `If-Match`, or `version` column anywhere in financial tables |
| **Verdict** | **NEEDS ATTENTION** — Concurrent edits silently overwrite each other. This is a **last-write-wins** pattern with no conflict detection |

### 3.2 Temporal Versioning (Import-Level)

| Aspect | Detail |
|--------|--------|
| **Schema** | All 8 financial tables have `effectiveFrom`, `effectiveTo`, `snapshotRunId` columns (`shared/schema/finance.ts`) |
| **Soft-close** | `server/lib/temporal-helpers.ts:38-53` — `softCloseRows()` sets `effective_to = NOW()` instead of deleting |
| **Point-in-time queries** | `server/services/financial-temporal.ts:55-85` — Supports querying historical state at any timestamp |
| **Verdict** | **PASS** — Import-level versioning is well-implemented, but this only applies to import operations, not to individual inline edits |

### 3.3 Manual Edit Protection

| Aspect | Detail |
|--------|--------|
| **Flags** | `shared/schema/imports.ts:527-539` — `manualEditFlags` table tracks fields edited by users with `isProtected` boolean |
| **Conflict resolution** | `shared/schema/imports.ts:542-554` — `conflictResolutionLog` records per-field decisions: `KEEP_MANUAL` vs `OVERWRITE_WITH_IMPORT` |
| **Re-import enforcement** | Protected fields force conflict resolution dialog on next import |
| **Verdict** | **PASS** — Import vs manual-edit conflicts are well-tracked |

---

## 4. Import Conflict Scenarios

### 4.1 Re-import When Rows Have Been Manually Edited

| Aspect | Detail |
|--------|--------|
| **Detection** | `server/smart-import-routes.ts:1368-1509` — Scans `normalizedCostLines` for manual confirmation fields (`cosRealised`, `invoiceDateConfirmed`, etc.) and checks `changeSets` for `MANUAL_EDIT` source |
| **Conflict response** | Returns **409 error** with conflict details if manual edits exist and no conflict resolution is provided (lines 1500-1507) |
| **Resolution options** | User chooses per-field: "keep" (preserves manual value, marks `isProtected = true`) or "import" (overwrites, deletes manual flag) |
| **Verdict** | **PASS** — Well-implemented field-level conflict detection and resolution |

### 4.2 Re-import When Rows Have Been Deleted

| Aspect | Detail |
|--------|--------|
| **Soft-delete pattern** | Rows are soft-closed (`effective_to = NOW()`) rather than hard-deleted |
| **Re-import** | New rows are inserted with `effective_from = NOW()`, `effective_to = NULL`. Deleted rows remain in history |
| **Rollback** | `server/smart-import-routes.ts:2536-2599` — Can roll back committed imports by soft-closing imported rows |
| **Verdict** | **PASS** — Temporal versioning handles deleted rows cleanly |

### 4.3 Import With Mismatched Columns

| Aspect | Detail |
|--------|--------|
| **File validation** | `server/smart-import-routes.ts:469-475` — Detects corrupted, password-protected, and wrong-format files |
| **Column mapping** | Smart import preview stage performs detection and mapping before commit |
| **Unresolved blockers** | Lines 1511-1523 — Commit is blocked if any `BLOCKER` severity issues remain unresolved |
| **Verdict** | **PASS** — Preview-then-commit workflow catches column mismatches before data is written |

### 4.4 Silent Overwrite of imported_edited Rows

| Aspect | Detail |
|--------|--------|
| **Warning only** | `server/smart-import-routes.ts:1929-1932, 2178-2180` — Logs `console.warn()` for overwriting user-edited `program_inflows`/`program_expense` rows |
| **Not surfaced** | Warning is not returned to the user — only server console |
| **Verdict** | **OBSERVATION** — User-edited program_inflows/expense rows can be silently overwritten during re-import. The conflict detection only covers `normalizedCostLines` manual confirmation fields |

---

## 5. Empty State Handling

### 5.1 Reusable Components

| Component | File | Description |
|-----------|------|-------------|
| `EmptyState` | `client/src/components/ui/empty-state.tsx` | Standardized empty state with icon, title, description, optional CTA |
| `Empty` (composite) | `client/src/components/ui/empty.tsx` | Flexible multi-slot empty state for complex layouts |
| `AdminQueryState` | `client/src/components/admin/admin-shell.tsx:141-207` | Handles loading/error/empty states with retry button |
| `LoadingState` | `client/src/components/ui/loading-state.tsx` | 6 variants: page, section, inline, skeleton-card, skeleton-table, skeleton-chart |
| `CommandEmpty` | `client/src/components/ui/command.tsx:70` | For searchable lists — "No results found" |

### 5.2 Page-Level Empty States

| Page | Pattern | Message |
|------|---------|---------|
| Dashboard | `EmptyState` component | "No projects match current filters" |
| PM Dashboard | Custom card + Briefcase icon | "No projects assigned yet — Projects will appear here once they are linked to your account" |
| Portfolio Detail | Card with message | "No projects assigned yet" |
| Cashflow | Inline text | "No inflows this week" |
| Project Detail — Tasks | Icon + message | "No engineering tasks yet — Add tasks manually or generate from templates" |
| Financial Data Grid | Table cell message | "No data available" (configurable via `emptyMessage` prop) |

### 5.3 Loading & Error States

| Pattern | Coverage |
|---------|----------|
| **Skeleton loaders** | 15+ files — Dashboard KPIs, tables, charts, FYE tracking, meetings |
| **ErrorBoundary** | `client/src/components/ErrorBoundary.tsx` — Wraps major sections with Go Back / Reload / Home buttons, auto-clears on route change |
| **Suspense** | Used in `collaboration.tsx` for lazy components (fallback = `null`) |
| **Optional chaining** | Extensively used: `data?.property`, `value ?? fallback`, `items?.length === 0` |

### 5.4 Verdict

**PASS** — Comprehensive empty state handling with reusable components, consistent messaging, skeleton loaders, and error boundaries. Coverage across 50+ pages.

---

## 6. Global Error Handling Infrastructure

### 6.1 Express Error Middleware

| Layer | File | Behaviour |
|-------|------|-----------|
| JSON parse errors | `server/bootstrap/security-middleware.ts:130-138` | Returns `400 { error: "Invalid request format" }` |
| Multer / API errors | `server/routes.ts:9849-9879` | Catches upload and generic API errors |
| Global catch-all | `server/bootstrap/error-handling.ts:1-16` | Returns status + message + stack trace |
| Final fallback | `server/routes.ts:15401-15403` | Uses `sendError(res, err)` |

### 6.2 ApiError Utility

**File:** `server/lib/api-error.ts`
- `ApiError` class with `statusCode`, `code`, `message`, `details`, `nextAction`
- Helpers: `badRequest()`, `unauthorized()`, `forbidden()`, `notFound()`, `conflict()`, `validationError()`, `serverError()`
- `sendError()` function — debug details only exposed when `NODE_ENV !== 'production'` or `EXPOSE_ERROR_DETAIL === 'true'`

### 6.3 Issues Found

| Issue | Severity | Location |
|-------|----------|----------|
| Stack traces in production responses | **HIGH** | `server/bootstrap/error-handling.ts:14` — `_stack` field sent in response regardless of environment |
| Two error handlers may conflict | **MEDIUM** | `server/routes.ts` — Handlers at lines 9849 and 15401 |
| Inconsistent error response formats | **MEDIUM** | Some routes return `{ error }`, others use `sendError()` with `{ error, code, details }` |

---

## Summary

### Risk Matrix

| Category | Severity | Issue | Location |
|----------|----------|-------|----------|
| Corrupted JSON | **CRITICAL** | Unprotected `JSON.parse()` on `import_snapshot` | `server/lib/inline-edit-helper.ts:113` |
| Corrupted JSON | **HIGH** | Unprotected `JSON.parse()` on handover data | `server/handover-routes.ts:175,359,427,512` |
| Stack trace leak | **HIGH** | `_stack` exposed in production error responses | `server/bootstrap/error-handling.ts:14` |
| Concurrent edits | **MEDIUM** | Last-write-wins on financial rows, no optimistic locking | `server/departments/finance-routes.ts` |
| Silent overwrites | **MEDIUM** | Re-import silently overwrites `imported_edited` program_inflows/expense rows | `server/smart-import-routes.ts:1929,2178` |
| Stale metrics | **MEDIUM** | Zero-backfilled metrics served when refresh fails silently | `server/services/dashboard-metrics.ts` |
| Error format | **LOW** | Inconsistent error response structure across routes | Various |

### What Works Well

1. **Startup integrity guard** — Backfills missing `project_execution_state` and `dashboard_project_metrics` rows automatically
2. **Permission system** — Dual fallback (server V2 → client hook), role deletion prevention, graceful degradation to minimal permissions
3. **Import conflict detection** — Field-level conflict tracking with `manualEditFlags`, `conflictResolutionLog`, and `isProtected` enforcement
4. **Temporal versioning** — Soft-close pattern preserves full history, supports point-in-time queries and rollback
5. **Empty state UI** — Reusable components, skeleton loaders, error boundaries, and consistent messaging across 50+ pages
6. **ApiError utility** — Structured error class with appropriate helpers and environment-aware detail exposure

### Recommended Fixes (Priority Order)

1. **Wrap `JSON.parse()` in try-catch** in `inline-edit-helper.ts:113` and `handover-routes.ts` (4 locations)
2. **Remove `_stack` from production error responses** in `error-handling.ts` — gate behind `NODE_ENV !== 'production'`
3. **Surface re-import overwrite warnings** to the API response instead of just `console.warn()`
4. **Consider optimistic locking** for high-contention financial fields (version column or `updated_at` check)
5. **Add stale-metric indicator** to dashboard when metrics refresh fails
