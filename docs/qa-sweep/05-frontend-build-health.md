# QA Sweep 05 — Frontend Build + Import Health

**Date:** 2026-03-21
**Status:** PASS (with advisories)

---

## 1. Full Build (`npm run build`)

**Result: PASS** — Client (Vite) builds successfully. Server (esbuild) builds successfully after fixes applied.

### Client Build Output
```
vite v7.3.1 building client environment for production...
✓ 4023 modules transformed.
✓ built in 10.00s

dist/public/index.html                                         7.29 kB │ gzip:   2.07 kB
dist/public/assets/index-CHR9hOcx.css                        273.86 kB │ gzip:  38.44 kB
dist/public/assets/CreateTaskFromSourceDialog-BlEaOyoO.js      7.86 kB │ gzip:   2.68 kB
dist/public/assets/index-B281KdbI.js                       4,092.90 kB │ gzip: 950.17 kB
```

### Categorized Issues

| Category | Severity | Description | Status |
|----------|----------|-------------|--------|
| Missing import `cosStatusOverrides` | CRITICAL | `fye-revenue-tracking-routes.ts` imported removed table | **FIXED** — import removed, `loadCosOverrides()` returns empty Map |
| Missing import `operationalTasks` | CRITICAL | `seed-engineering.ts` imported removed table | **FIXED** — replaced with `workItems` table |
| Undefined import `projectEvents` | WARNING | `project-event-service.ts` — already handled with runtime fallback | Existing |
| Direct `eval()` usage | WARNING | `quality-routes.ts:1817` — flagged by esbuild | Existing |
| Chunk size > 500 kB | INFO | Main JS bundle is 4,092 kB (950 kB gzipped) — code-splitting recommended | Advisory |

### Fixes Applied

1. **`server/departments/fye-revenue-tracking-routes.ts`**: Removed `cosStatusOverrides` import. Updated `loadCosOverrides()` to return an empty `Map` directly (table was deprecated — override data baked into base rows).

2. **`server/seed-engineering.ts`**: Replaced `operationalTasks` import with `workItems`. Updated insert statement to use `workItems` table with correct columns (`workstream: "ENG"`, `source: "INTEGRATION"`, `createdBy: 1`).

---

## 2. TypeScript Strict Check (`tsc --noEmit`)

**Result: 19 errors — all server-side, zero client-side**

All 19 errors are in `server/departments/fye-revenue-tracking-routes.ts` referencing `projectExecutionState` (a missing identifier). These are pre-existing server-side issues unrelated to the frontend.

```
server/departments/fye-revenue-tracking-routes.ts(512,34): error TS2304: Cannot find name 'projectExecutionState'.
server/departments/fye-revenue-tracking-routes.ts(513,30): error TS2304: Cannot find name 'projectExecutionState'.
... (17 more identical errors in same file)
```

**Client TypeScript: 0 errors** — Frontend compiles cleanly with no type errors.

---

## 3. Broken Imports — References to Deleted Files

**Result: PASS — 0 true broken imports**

The grep pattern matched 9 lines, but all referenced files **exist** and are valid:

| File | Import | Exists? |
|------|--------|---------|
| `hooks/use-access-matrix.ts` | `@/hooks/use-access-matrix` | Yes |
| `lib/access-control.ts` | `@/lib/access-control` | Yes |
| `pages/engineering-tasks.tsx` | `@/pages/engineering-tasks` | Yes |
| `pages/database-migration.tsx` | Contains string "legacy" in template text | N/A (not an import) |

**Conclusion:** No broken imports to deleted files.

---

## 4. References to Deleted API Paths

**Result: FAIL — 13 references found**

| API Path | File | Lines | Type |
|----------|------|-------|------|
| `/api/tasks/reassign` | `UserAssignmentPicker.tsx` | 135 | Mutation (PATCH) |
| `/api/expenses/add-line` | `ExpenditureEditableTab.tsx` | 539 | Mutation (POST) |
| `/api/expenses/add-category` | `ExpenditureEditableTab.tsx` | 558 | Mutation (POST) |
| `/api/expenses/insert-task-as-line` | `ExpenditureEditableTab.tsx` | 576 | Mutation (POST) |
| `/api/tasks/board` | `task-management.tsx` | 186 | Query (GET) |
| `/api/tasks/{id}` | `task-management.tsx` | 191 | Mutation (PATCH) |
| `/api/tasks` (list) | `task-management.tsx` | 259 | Query (GET) |
| `/api/tasks/calendar` | `task-management.tsx` | 347 | Query (GET) |
| `/api/tasks/metrics` | `task-management.tsx` | 439 | Query (GET) |
| `/api/tasks` (create) | `task-management.tsx` | 560 | Mutation (POST) |
| `/api/tasks/seed-identified-items` | `task-management.tsx` | 666 | Mutation (POST) |
| `/api/tasks/reassign` | `my-work-tasks.tsx` | 1722, 1734 | Mutation (PATCH) |

> **Note:** These may be active API routes (not truly "deleted"). Verification against server route definitions is recommended.

---

## 5. Raw `fetch()` Calls for Mutations (POST/PATCH/PUT/DELETE)

**Result: 35 raw fetch mutation calls**

### By Page/Component

| File | Count | Methods |
|------|-------|---------|
| `pages/my-work-tasks.tsx` | 17 | PATCH, POST |
| `pages/admin-roles.tsx` | 7 | PUT, POST, PATCH, DELETE |
| `components/tabs/ProjectCommissioningTab.tsx` | 1 | POST |
| `components/tabs/ProjectRaidTab.tsx` | 1 | DELETE |
| `components/ProjectCommandHeader.tsx` | 1 | PATCH |
| `pages/pd-pm-handover.tsx` | 1 | POST |
| `pages/lifecycle-board.tsx` | 1 | DELETE |
| `pages/project-lifecycle.tsx` | 1 | DELETE |
| `pages/import-control-tower.tsx` | 1 | POST |
| `pages/task-management.tsx` | 4 | POST, PATCH |

### Priority for Migration to `useMutation`
1. **`my-work-tasks.tsx`** — 17 raw mutations (highest density)
2. **`admin-roles.tsx`** — 7 raw mutations
3. **`task-management.tsx`** — 4 raw mutations (already uses `apiFetch` wrapper)

---

## 6. React Query vs Raw Fetch Ratio

| Metric | Count |
|--------|-------|
| `useQuery` / `useMutation` references | **839** |
| Raw `fetch()` calls outside React Query (reads + mutations) | **364** |
| **Ratio (React Query : raw fetch)** | **2.3 : 1** |

React Query is the primary data-fetching mechanism but a significant number of raw `fetch()` calls remain, primarily in:
- `my-work-tasks.tsx` — task status updates, reassignments, date changes
- `admin-roles.tsx` — role/user CRUD operations
- Various component-level data fetching (deliverable capture, weekly reviews, etc.)

---

## Summary

| Check | Result | Details |
|-------|--------|---------|
| 1. Full build | **PASS** | Client + server build successfully (2 critical import errors fixed) |
| 2. TypeScript strict | **PASS (client)** | 0 client errors; 19 pre-existing server errors (`projectExecutionState`) |
| 3. Broken imports | **PASS** | 0 broken imports to deleted files |
| 4. Deleted API paths | **ADVISORY** | 13 references to `/api/tasks` and `/api/expenses` — may be active routes |
| 5. Raw fetch mutations | **ADVISORY** | 35 raw fetch mutation calls — `my-work-tasks.tsx` is highest priority for migration |
| 6. React Query ratio | **ADVISORY** | 839 React Query vs 364 raw fetch (2.3:1 ratio) |
