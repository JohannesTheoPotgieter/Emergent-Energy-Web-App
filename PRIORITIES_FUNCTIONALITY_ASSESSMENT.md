# Priorities Functionality – Full Assessment (March 24, 2026)

## Scope Assessed
- Strategic priorities API + project-linking layer (`/api/priorities*`).
- Legacy/admin company priorities API (`/api/mytool/company-priorities*`).
- Priorities UI pages (`/priorities`, `/priorities/:id`, `/company-priorities`).
- Existing automated tests for the strategic priorities feature set.

---

## Executive Summary
The priorities capability is **partially production-ready** and has a strong strategic foundation, but there are **critical consistency gaps** caused by running two parallel implementations (new strategic endpoints + older MyTool endpoints) against related but different linking models. The result is that users can successfully create/update priorities, but some views and metrics can disagree depending on which screen was used.

**Overall status:** 🟠 **Usable with notable correctness and governance risks**.

---

## What Is Working


## Current Runtime Status (What Runs Today)

| Area | Current status | Notes |
|---|---|---|
| `GET /api/priorities` | Working | Returns enriched strategic priorities for authenticated users. |
| `GET /api/priorities/:id` | Working | Returns enriched detail + linked project context. |
| `POST/PUT/DELETE /api/priorities*` | Working with role gates | Write actions require priority-admin roles; delete is soft-close. |
| `POST/DELETE /api/priorities/:id/projects*` | Working | Link/unlink uses `priority_projects`. |
| `GET /api/priorities/:id/tasks|approvals|updates` | Working | Returns task/approval/update rollups for linked projects. |
| `/priorities` UI page | Working | Filters/rendering and create dialog work for admin-recognized roles. |
| `/priorities/:id` UI page | Working | Detail tabs, link/unlink UI and KPI cards render from API. |
| `/company-priorities` legacy page | Working but legacy-path risk | CRUD and link UX work, but uses legacy link model behavior. |
| Strategic priorities unit suite | **Not fully working** | 4 current failures due to page registry contract drift in tests. |

---


### 1) Strategic priorities API is implemented end-to-end
- Strategic list/detail/create/update/delete and project link/unlink endpoints exist and are wired through department route registration. (`server/departments/priority-strategic-routes.ts`, `server/routes/register-department-routes.ts`).
- Detail endpoint returns linked projects + financial/progress metrics for priority drill-down. (`server/departments/priority-strategic-routes.ts`).

### 2) Derived KPI model exists for priority health/progress
- `priority_derived_metrics` view is created by startup schema orchestration and used by strategic routes.
- Logic supports health rollup (critical/at_risk/healthy), progress aggregation, blocker count, and open task count. (`server/bootstrap/startup-orchestrator.ts`, `migrations/20260342_company_priorities_strategic_layer.sql`, `server/departments/priority-strategic-routes.ts`).

### 3) User-facing strategic pages are implemented
- `/priorities` page lists priorities with filters and health/severity sorting.
- `/priorities/:id` detail page supports linked-project visibility and project link/unlink actions for admins.
- Both pages query the strategic endpoints and invalidate cache keys properly. (`client/src/pages/priorities.tsx`, `client/src/pages/priority-detail.tsx`).

### 4) Legacy manage screen still functions
- `/company-priorities` (MyTool priorities page) provides CRUD + inline edit + link handling for legacy operations.
- API routes are available and connected to storage methods. (`client/src/pages/my-tool-priorities.tsx`, `server/departments/exco-routes.ts`, `server/storage.ts`).

---

## What Is Not Working / High-Risk Issues

### 1) **Split-brain data model between strategic links and legacy links (Critical)**
- Strategic endpoints link priorities to projects through `priority_projects`.
- Legacy MyTool manage endpoints still use `priority_links`.
- Strategic metrics depend on `priority_projects`; therefore links created via legacy flows may not appear in strategic metrics or detail behavior.
- This creates inconsistent outcomes depending on which page users used.

**Evidence:** `priority_projects` usage in strategic routes and startup schema vs `priority_links` usage in MyTool routes. (`server/departments/priority-strategic-routes.ts`, `server/bootstrap/startup-orchestrator.ts`, `server/departments/exco-routes.ts`).

### 2) **Role mismatch between backend authorization and frontend admin checks (High)**
- Backend `requirePriorityAdmin` allows: `COO_ADMIN`, `CEO_ADMIN`, `CCO`, `CFO`, `PROGRAM_MANAGER`.
- Strategic UI (`/priorities`, `/priorities/:id`) only treats `COO_ADMIN`, `CEO_ADMIN`, `PROGRAM_MANAGER` as admin-capable.
- CCO/CFO can be authorized server-side but blocked in UI affordances.

**Evidence:** role list mismatch in middleware vs page checks. (`server/departments/shared-middleware.ts`, `client/src/pages/priorities.tsx`, `client/src/pages/priority-detail.tsx`).

### 3) **Automated test drift indicates contract confusion (High)**
- Strategic unit suite currently fails because tests expect `PAGES` export + redirect semantics no longer aligned with current `PAGE_REGISTRY` implementation.
- This means CI signal for priorities routing is currently unreliable.

**Evidence:** failed tests and page-registry export mismatch.
- Command: `npm run test -- qa/tests/unit/priority-strategic-layer.test.ts qa/tests/unit/sheet-priority-system.test.ts`
- Failures in `priority-strategic-layer.test.ts`; `page-registry.ts` exports `PAGE_REGISTRY` not `PAGES`. (`qa/tests/unit/priority-strategic-layer.test.ts`, `client/src/config/page-registry.ts`).

### 4) **Delete semantics are inconsistent across APIs (Medium/High)**
- Strategic delete is soft close (`status = closed`).
- Legacy MyTool delete is hard delete from `mytool_company_priorities`.
- This can cause data retention and reporting inconsistency depending on endpoint used.

**Evidence:** delete handlers differ in behavior. (`server/departments/priority-strategic-routes.ts`, `server/departments/exco-routes.ts`, `server/storage.ts`).

### 5) **Validation is strong in strategic API but weak in legacy API (Medium)**
- Strategic routes validate severity/manual health/progress and referenced IDs.
- MyTool legacy CRUD handlers pass request bodies directly to storage without equivalent guardrails.
- Risk: malformed records entering same table from one path and rejected by another.

**Evidence:** validation present in strategic route create/update; absent in MyTool route create/update. (`server/departments/priority-strategic-routes.ts`, `server/departments/exco-routes.ts`).

### 6) **N+1 query pattern in priority enrichment (Medium, performance)**
- `enrichPriority` resolves owner and accountable exec with per-priority user lookups.
- At scale this will increase API latency linearly.

**Evidence:** repeated `getUserById` calls inside per-priority enrichment. (`server/departments/priority-strategic-routes.ts`).

---

## What Needs to Be Fixed (Prioritized)

## P0 (Fix immediately)
1. **Unify linking model**: migrate all active read/write paths to `priority_projects`; treat `priority_links` as deprecated/legacy-only read compatibility.
2. **Align role checks**: update strategic UI admin checks to mirror backend allowed roles (`CCO`, `CFO` included).
3. **Repair tests**: update priority strategic unit tests to current route registry contracts (`PAGE_REGISTRY`, and explicit chosen behavior for `/company-priorities`: redirect vs managed page).

## P1 (Next sprint)
4. **Unify delete semantics**: decide one policy (recommended: soft-close) and enforce across both API families.
5. **Apply consistent validation layer** to `/api/mytool/company-priorities` writes or route all writes through strategic service.
6. **Remove split UI pathways confusion**: decide canonical management surface (`/priorities` + detail, or `/company-priorities`) and make the other explicit redirect/deprecated shell.

## P2 (Hardening)
7. **Optimize enrichment query** with joins for owner/accountable exec to remove N+1 pattern.
8. **Add integration tests** for strategic routes (permissions, create/update validations, link/unlink, derived metrics fallback).
9. **Add observability**: route-level metrics/logging for priority endpoints (latency, errors, role-denied counts).

---

## What Needs to Be Added

1. **Canonical priorities service contract** document (single source of truth):
   - lifecycle states,
   - link model,
   - visibility/permissions,
   - delete/archival behavior,
   - health/progress derivation fallback rules.
2. **Data reconciliation script** to compare `priority_links` vs `priority_projects` and auto-heal or report differences.
3. **E2E UI coverage** for:
   - create priority,
   - link projects,
   - view derived metrics,
   - role-based admin controls (including CCO/CFO).
4. **Backward-compatibility plan** for legacy `/company-priorities` path, with timeline to deprecate.

---

## Current Confidence by Area

- Strategic endpoint correctness: **Medium-High** (good validation + routing).
- Data consistency across whole product: **Low-Medium** (dual-link model risk).
- UI/permission consistency: **Medium** (role mismatch known).
- Test confidence: **Medium-Low** (strategic suite drift currently failing).

---

## Validation Performed During This Assessment
- Static code review across server routes, client pages, storage layer, schema/migrations, and unit tests.
- Targeted unit test run for priority suites:
  - `qa/tests/unit/priority-strategic-layer.test.ts` (**failed: 4 tests**)
  - `qa/tests/unit/sheet-priority-system.test.ts` (**passed: all tests**)
