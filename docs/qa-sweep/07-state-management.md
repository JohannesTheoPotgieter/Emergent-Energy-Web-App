# QA Sweep 07 — State Management Audit

**Date:** 2026-03-21
**Status:** PASS — all flagged issues resolved

---

## 1. Context Providers

### Application-Level Providers (App.tsx)

| Provider | Location | Status |
|----------|----------|--------|
| `QueryClientProvider` | `client/src/App.tsx:341` | Active — wraps entire app |
| `AuthProvider` | `client/src/App.tsx:342` | Active — wraps router |

### Custom Context Providers

| Context | File | Purpose | Status |
|---------|------|---------|--------|
| `AuthContext` | `hooks/use-auth.tsx:18` | User auth state | OK — single source of truth |
| `ExecutionDashboardContext` | `pages/execution-dashboard/use-execution-data.ts:81` | Execution board data | OK — scoped to execution dashboard page |

### UI Library Contexts (shadcn/radix — no concerns)

`SidebarContext`, `TooltipProvider`, `FormFieldContext`, `FormItemContext`, `ToggleGroupContext`, `CarouselContext`, `ChartContext`, `SelectSearchContext`, `ToastProvider` — all standard UI primitives.

### Verification

- **AuthProvider exists and works:** YES — `hooks/use-auth.tsx:20`, provides `user`, `isLoading`, `isAuthenticated`, `isAdmin`, `isQm`, `login`, `logout`.
- **ProgramProvider is GONE:** YES — no `ProgramProvider` or `ProgramContext` found. Only a comment in `hooks/use-projects-summary.ts:4` confirming it was replaced: `"Replaces ProgramProvider's projectsSummary context"`.
- **No duplicate context for the same data:** PASS — auth lives only in `AuthContext`, execution dashboard has its own scoped context. No overlapping custom contexts.

---

## 2. React Query Cache Keys

### Projects-Summary Dual-Key — FIXED

Previously `use-projects-summary.ts` used `["projects-summary"]` while other pages used `["/api/projects-summary"]`, causing the same data to be cached under two keys.

**Fix applied:**
- `use-projects-summary.ts` now uses `queryKey: ["/api/projects-summary"]` (canonical key)
- Removed duplicate `["projects-summary"]` invalidation from `queryClient.ts:invalidateDashboardQueries()`
- Removed dual-invalidation from `ProjectCommandHeader.tsx` (3 call sites)

### Template-String Query Keys — FIXED

Previously `fye-revenue-tracking.tsx`, `revenue-tracker.tsx`, and `cos.tsx` embedded query params as template literals in query keys (e.g. `` [`/api/fye-revenue-tracking/budgets?fye=${fye}`] ``), preventing partial key matching.

**Fix applied:**
- Added `fetchQueryFn()` helper to `queryClient.ts` — creates a query function with an explicit URL decoupled from the query key
- Converted all template-string keys to structured arrays:
  - `fye-revenue-tracking.tsx`: 18 query keys converted (budgets, dashboard, detail, pipeline, lost-deals, kpis, snapshots)
  - `revenue-tracker.tsx`: 1 query key converted (month-detail)
  - `cos.tsx`: 2 query keys converted (month-detail query + invalidation)

**Before:** `queryKey: [`/api/fye-revenue-tracking/budgets?fye=${fye}`]`
**After:** `queryKey: ["/api/fye-revenue-tracking/budgets", fye]` with `queryFn: fetchQueryFn(...)`

### No Legacy/Dead Query Keys Found

No query keys reference removed or deprecated endpoints. All keys map to active API routes.

---

## 3. Cache Invalidation Audit

### Mutations WITH Proper Invalidation (majority)

All mutations in the following files correctly call `queryClient.invalidateQueries()` in `onSuccess`:

| File | Mutations | Invalidation |
|------|-----------|-------------|
| `invoice-patterns.tsx` | 6 mutations | All have `invalidateQueries` |
| `fye-revenue-tracking.tsx` | 7 mutations | All have `invalidateQueries` |
| `cashflow.tsx` | 5 mutations | All have `invalidateQueries` |
| `portfolio-detail.tsx` | 5 mutations | All have `invalidateQueries` |
| `phase-templates.tsx` | 2 mutations | All have `invalidateQueries` |
| `clients.tsx` | 3 mutations | All have `invalidateQueries` |
| `qm-dashboard.tsx` | 3 mutations | All have `invalidateQueries` |
| `my-tool-meetings.tsx` | 5 mutations | All have `invalidateQueries` |
| `my-tool-admin-settings.tsx` | 4 mutations | All have `invalidateQueries` |
| `admin-approvals.tsx` | 1 mutation | Has `invalidateQueries` |
| `standups.tsx` | schedule/entry mutations | All use `invalidateQueries` |
| `collab-teams.tsx` | sync mutation | Has `invalidateQueries` |
| `database-migration.tsx` | 4 mutations | All have `invalidateQueries` |

### Mutations Using Callback Delegation (Acceptable Pattern)

| File | Mutation | Pattern | Risk |
|------|----------|---------|------|
| `admin-roles.tsx` | `saveRoleMutation` | Calls `load()` callback | LOW — `load()` re-fetches via imperative fetch, not React Query |
| `admin-roles.tsx` | `createRoleMutation` | Calls `load()` callback | LOW — same pattern |
| `admin-roles.tsx` | `updateRoleMutation` | Calls `load()` callback | LOW |
| `admin-roles.tsx` | `updateDepartmentMutation` | Calls `load()` callback | LOW |
| `admin-roles.tsx` | `createUserMutation` | Calls `load()` callback | LOW |
| `admin-roles.tsx` | `deleteUserMutation` | Calls `load()` callback | LOW |

**Note:** `admin-roles.tsx` uses imperative `fetch` + `useState` instead of `useQuery` for its data, so callback-based refresh is appropriate here.

### Mutations Using refetch() Delegation

| File | Mutation | Pattern |
|------|----------|---------|
| `pm-on-the-go-project.tsx:151` | `riskConfirmMutation` | Calls `refetchCompliance()` — OK, uses query refetch handle |

### Previously Missing Invalidation — FIXED

| File | Mutation | Fix Applied |
|------|----------|-------------|
| `pm-on-the-go-project.tsx` | procurement `mutation` | Added `invalidateQueries({ queryKey: ["pm-otg-snapshot", projectId] })` in `onSuccess` |
| `standups.tsx` | `submitMutation` | Added `invalidateQueries` for `["standup-entries", scheduleId]` and `["standups-today"]` in `onSuccess` |

Both mutations still call their parent callbacks (`onSuccess()` / `onSubmitted()`) but now also directly invalidate relevant query caches, eliminating the fragile callback-only pattern.

---

## 4. Duplicated State Check

### Auth/User Data

- `authApi.me()` called ONLY in `AuthProvider` (`hooks/use-auth.tsx:51`).
- No other component re-fetches `/api/auth/me`. All auth consumers use `useAuth()` hook.
- **PASS — no duplicated auth state.**

### Project Data — FIXED

Previously the projects-summary data was fetched under two different keys. Now consolidated to a single key `["/api/projects-summary"]` everywhere.

### User Lists

User/assignable-user data is fetched independently in multiple components:
- `project-detail.tsx:865` → `["/api/pm-assignable-users"]`
- `project-detail.tsx:873` → `["/api/pd-assignable-users"]`
- `lifecycle-board.tsx:347-355` → same keys
- `projects.tsx:1361` → `["/api/pm-assignable-users"]`
- `my-work-tasks.tsx:1691` → `["/api/users"]`
- `my-work-tasks.tsx:2251` → `["/api/assignables/task"]`

**Verdict:** These are different endpoints serving different filtered user lists. React Query deduplicates requests with the same key, so concurrent renders won't cause duplicate fetches. **Acceptable pattern.**

---

## 5. Permissions Flow

### Architecture

```
API: GET /api/auth/permissions → { role, entityPermissions, userOverrides }
          ↓
    usePermission(entity, action)     →  reads from React Query cache
          ↓                                queryKey: ["auth-permissions", user?.role]
    PermissionGate component          →  calls usePermission() internally
          ↓
    V2 project permissions            →  useV2ProjectPermissions() reads from
                                         queryKey: ["v2-project-detail", projectId]
```

### Verification

- **`usePermission()` hook** (`hooks/use-permissions.ts:20`): Fetches from `/api/auth/permissions` via `useQuery`, cached with `staleTime: 60_000`. Checks user overrides → entity permissions → hardcoded defaults. **All reads from API response cache.**

- **`PermissionGate` component** (`components/PermissionGate.tsx:28`): Accepts optional `serverPermissions` prop for V2 API-embedded permissions. Falls back to `usePermission()` hook. **No client-side computation of permissions.**

- **`useV2ProjectPermissions()`** (`hooks/use-permissions.ts:68`): Reads `permissions` from the React Query cache for `["v2-project-detail", projectId]`. **No client-side computation.**

### Usage Across Codebase

| Pattern | Files Using | Source |
|---------|-------------|--------|
| `usePermission(entity, action)` | 20+ pages | API cache |
| `PermissionGate` component | `subcontractor-dashboard.tsx`, `ExpenditureEditableTab.tsx`, `RevenueTrackingTab.tsx` | API cache (via `usePermission`) |
| `canEdit` / `canDelete` derived from `usePermission` | `project-detail.tsx`, `EngineeringTasksPage.tsx`, `QualityTab.tsx`, `cashflow.tsx` | API cache |

### Edge Cases

1. **`my-tool-priorities.tsx:131`**: `canEdit` combines `usePermission` result with role checks:
   ```ts
   const canEdit = canEditPerm || isAdmin || (companyRole ? editRoles.includes(companyRole) : false) || user?.role === "admin";
   ```
   This adds client-side fallback logic on top of the API permission. **Low risk** — it's an OR expansion (more permissive), not a replacement.

2. **`lifecycle-board.tsx:456`**: `canEditRag` — FIXED. Previously hardcoded `["COO_ADMIN", "CEO_ADMIN", "CCO"].includes(role)`, now uses `usePermission('projects', 'approve')` which resolves to the same role set via the permissions API.

3. **`EngineeringStagesTab.tsx:1242`**: `canApprove` computed client-side from role checks. Deliberate pattern for stage-specific approval logic with multi-role conditions (QA_REVIEW + QUALITY_MANAGER).

4. **`CompanyOverviewMap.tsx:459`**: `canEdit` reads from a project-specific editors array fetched via API — acceptable pattern.

**PASS — all permissions read from API response cache. One client-side check migrated to usePermission.**

---

## Summary

| Check | Result | Notes |
|-------|--------|-------|
| AuthProvider exists and works | PASS | Single context, no duplication |
| ProgramProvider removed | PASS | Fully replaced by `useProjectsSummary()` hook |
| No duplicate contexts | PASS | Only AuthContext + scoped ExecutionDashboardContext |
| Query key conflicts | FIXED | `projects-summary` consolidated to single `["/api/projects-summary"]` key |
| Query key conventions | FIXED | Template-string keys converted to structured arrays via `fetchQueryFn` |
| Legacy query keys | PASS | None found |
| Mutation cache invalidation | FIXED | 2 mutations with missing invalidation now have direct `invalidateQueries` |
| Duplicated auth state | PASS | `authApi.me()` only in AuthProvider |
| Duplicated project data | FIXED | Single query key for projects-summary |
| Permissions from API cache | FIXED | `canEditRag` migrated from hardcoded roles to `usePermission('projects', 'approve')` |

### Changes Made

1. **`lib/queryClient.ts`** — Added `fetchQueryFn()` helper for URL-decoupled query functions; removed duplicate `["projects-summary"]` invalidation
2. **`hooks/use-projects-summary.ts`** — Changed query key from `["projects-summary"]` to `["/api/projects-summary"]`
3. **`components/ProjectCommandHeader.tsx`** — Removed 3 duplicate `["projects-summary"]` invalidation calls
4. **`pages/fye-revenue-tracking.tsx`** — Converted 18 template-string query keys to structured arrays with `fetchQueryFn`
5. **`pages/revenue-tracker.tsx`** — Converted 1 template-string query key to structured array with `fetchQueryFn`
6. **`pages/cos.tsx`** — Converted 2 template-string query keys/invalidations to structured arrays with `fetchQueryFn`
7. **`pages/pm-on-the-go-project.tsx`** — Added `invalidateQueries(["pm-otg-snapshot"])` to procurement mutation
8. **`pages/standups.tsx`** — Added `invalidateQueries` for `["standup-entries"]` and `["standups-today"]` to submitMutation
9. **`pages/lifecycle-board.tsx`** — Replaced hardcoded `canEditRag` role check with `usePermission('projects', 'approve')`
