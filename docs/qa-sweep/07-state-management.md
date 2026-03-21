# QA Sweep 07 — State Management Audit

**Date:** 2026-03-21
**Status:** PASS with observations

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

### Naming Convention Inconsistency (Observation)

The codebase uses **two naming conventions** interchangeably:

| Convention | Example | Approx. Usage |
|------------|---------|---------------|
| URL-path format | `["/api/projects-summary"]` | ~40% of keys |
| Descriptive format | `["projects-summary"]` | ~60% of keys |

**Notable conflict:** The projects-summary data uses BOTH conventions:
- `hooks/use-projects-summary.ts:16` → `queryKey: ["projects-summary"]`
- `pages/cashflow.tsx:569`, `pages/portfolio-detail.tsx:357` → `queryKey: ["/api/projects-summary"]`
- `lib/queryClient.ts` and `components/ProjectCommandHeader.tsx` invalidate BOTH keys as a workaround

**Impact:** Low — the dual-invalidation workaround prevents stale data, but this is technical debt.

### Query Parameters Embedded in Key Strings

Several keys in `fye-revenue-tracking.tsx` embed query params via template literals:
```
queryKey: [`/api/fye-revenue-tracking/budgets?fye=${fye}`]
```
Best practice is `["/api/fye-revenue-tracking/budgets", fye]` for proper partial invalidation. Same pattern in `revenue-tracker.tsx` and `cos-tracker.tsx`.

**Impact:** Medium — prevents partial key matching with `invalidateQueries({ queryKey: ["/api/fye-revenue-tracking"] })`.

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
| `standups.tsx` | schedule/entry mutations | Most use `invalidateQueries` |
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

### Mutations Missing Direct Invalidation (Flagged)

| File | Mutation | What it does | Missing |
|------|----------|-------------|---------|
| `pm-on-the-go-project.tsx:781` | procurement `mutation` | POST to `/api/procurement` | Calls `onSuccess()` callback only — parent component should invalidate procurement queries |
| `standups.tsx:140` | `submitMutation` | POST standup entries | Calls `onSubmitted()` callback — parent's `handleRefresh()` does the invalidation |

**Risk:** LOW — both delegate to parent callbacks that handle refresh. However, if the callback chain is broken, stale data would persist.

---

## 4. Duplicated State Check

### Auth/User Data

- `authApi.me()` called ONLY in `AuthProvider` (`hooks/use-auth.tsx:51`).
- No other component re-fetches `/api/auth/me`. All auth consumers use `useAuth()` hook.
- **PASS — no duplicated auth state.**

### Project Data

The projects-summary data is fetched via:
1. `hooks/use-projects-summary.ts` — shared hook using `queryKey: ["projects-summary"]`
2. Direct `useQuery` calls with `queryKey: ["/api/projects-summary"]` in `cashflow.tsx`, `portfolio-detail.tsx`, `clients.tsx`

These are the **same endpoint** but cached under **different keys**, meaning duplicate network requests can occur.

**Recommendation:** Consolidate to a single query key. Use the `useProjectsSummary()` hook everywhere, or standardize the key.

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

2. **`lifecycle-board.tsx:456`**: `canEditRag` is computed purely client-side:
   ```ts
   const canEditRag = ["COO_ADMIN", "CEO_ADMIN", "CCO"].includes(role);
   ```
   **Flagged** — this should ideally use `usePermission` for consistency, but the hardcoded role list is a deliberate business rule.

3. **`EngineeringStagesTab.tsx:1242`**: `canApprove` computed client-side from role checks. Similar deliberate pattern for stage-specific approval logic.

4. **`CompanyOverviewMap.tsx:459`**: `canEdit` reads from a project-specific editors array fetched via API — acceptable pattern.

**PASS — all permissions primarily read from API response cache. Minor client-side fallbacks are additive, not replacing server authority.**

---

## Summary

| Check | Result | Notes |
|-------|--------|-------|
| AuthProvider exists and works | PASS | Single context, no duplication |
| ProgramProvider removed | PASS | Fully replaced by `useProjectsSummary()` hook |
| No duplicate contexts | PASS | Only AuthContext + scoped ExecutionDashboardContext |
| Query key conflicts | OBSERVATION | `"projects-summary"` vs `"/api/projects-summary"` dual-key issue |
| Query key conventions | OBSERVATION | Mixed URL-path and descriptive naming; query params in template strings |
| Legacy query keys | PASS | None found |
| Mutation cache invalidation | PASS | All mutations invalidate or delegate to parent refresh |
| Mutations missing invalidation | LOW RISK | 2 mutations delegate via callback (acceptable) |
| Duplicated auth state | PASS | `authApi.me()` only in AuthProvider |
| Duplicated project data | OBSERVATION | Same endpoint cached under 2 different keys |
| Permissions from API cache | PASS | All use `usePermission()` / `PermissionGate` reading from cache |
| No client-side permission computation | PASS (minor exceptions) | 2-3 pages add client-side OR fallbacks — additive, not replacing server |

### Recommended Follow-ups

1. **Standardize query key naming** — pick one convention (suggest descriptive names) and migrate all keys
2. **Consolidate `projects-summary` key** — use single key everywhere to avoid dual-invalidation workaround
3. **Extract query params from key strings** — change `[`/api/foo?bar=${val}`]` to `["/api/foo", val]`
4. **Consider a centralized query key registry** — e.g. `queryKeys.ts` with constants to prevent drift
