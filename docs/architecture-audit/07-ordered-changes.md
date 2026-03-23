# Section 7: Ordered List of Changes Needed

## Priority Ordering Rationale

Changes are ordered by: (1) data integrity fixes first, (2) then API consolidation, (3) then frontend cleanup. Within each layer, dependencies are respected — foundational changes before dependent ones.

---

## Phase 1: Data Layer Foundations (Weeks 1-4)

### 1.1 Split schema file (Low risk, high dev-productivity payoff)

**Current**: `shared/schema.ts` — 5,936 lines, 200+ tables in one file.

**Action**:
- Create `shared/schema/` directory
- Split into domain files: `users.ts`, `projects.ts`, `finance.ts`, `tasks.ts`, `engineering.ts`, `quality.ts`, `imports.ts`, `mytool.ts`, `collaboration.ts`, `audit.ts`
- Re-export from `shared/schema/index.ts` for backwards compatibility
- No data or runtime change — purely structural

**Risk**: Low | **Pages affected**: 0 | **Breaking**: No

---

### 1.2 Add `project_id` FK to tables that only have `projectName`

**Current**: `finance_revenue_monthly`, `finance_cos_monthly`, `project_plan`, `home_notes`, `qc_warning`, `project_editable_fields` and others link by text.

**Action**:
- Migration: `ALTER TABLE ... ADD COLUMN project_id INTEGER REFERENCES project_info(id)`
- Backfill script: `UPDATE table SET project_id = (SELECT id FROM project_info WHERE project_name = table.project_name)`
- Do NOT remove `projectName` yet — that's Phase 3

**Risk**: Low (additive) | **Pages affected**: 0 | **Breaking**: No

---

### 1.3 Add FK to override tables

**Current**: Override tables link by `projectName` + `rowNumber` with no FK.

**Action**:
- Add `base_row_id INTEGER REFERENCES program_expense(id)` (or equivalent) to each override table
- Backfill by matching `projectName` + `rowNumber` to base table
- Validate: ensure every override resolves to exactly one base row
- Keep text columns temporarily for backwards compatibility

**Risk**: Medium (data resolution may be ambiguous) | **Mitigation**: Validation report before migration

---

### 1.4 Drop orphaned tables

**Action**: Remove `mock_sp_items`, `template_profiles`, `forecast_pipeline` (after confirming zero usage).

**Risk**: Low

---

## Phase 2: Task Consolidation (Weeks 3-6)

### 2.1 Establish `work_items` as canonical task table

**Current**: 4 task tables coexist. `work-items-adapter.ts` and `canonical-boundaries.ts` bridge them.

**Action**:
- Ensure `work_items` has all columns needed for engineering, PM, and PD tasks
- Migrate `operational_tasks` creation to always create `work_items` first (adapter mirrors to operational_tasks)
- Migrate `engineering_tasks` reads to use `work_items` with `workstream = 'Engineering'`
- Keep `mytool_tasks` separate (different domain: personal workspace, not project-scoped)
- Deprecate direct writes to `operational_tasks` and `engineering_tasks`; they become read-only mirrors

**Risk**: High | **Mitigation**: Feature flag per domain; rollback by disabling flag

---

### 2.2 Unify task comment/checklist/attachment FKs

**Current**: `task_comments.taskId` is polymorphic (no FK constraint).

**Action**:
- Add `task_type` discriminator column (`work_item`, `mytool_task`)
- Add FK constraints per type (or use `work_items.id` as sole FK)
- Backfill existing records

**Risk**: Medium

---

## Phase 3: API Consolidation (Weeks 5-10)

### 3.1 Split `routes.ts` monolith

**Current**: ~4000+ lines in one file.

**Action**:
- Extract each domain into its own route file (many already exist but routes.ts duplicates them)
- Move business logic from route handlers into service layer
- Route handlers should: parse request → call service → format response → send

**Risk**: Low (no behavior change) | **Breaking**: No

---

### 3.2 Build consolidated project detail endpoint

**Current**: Frontend makes 10+ API calls to load project detail.

**Action**:
- Create `GET /api/v2/projects/:id` that returns:
  ```json
  {
    "project": { ... },
    "financeSummary": { totalRevenue, totalCost, margin },
    "planSummary": { taskCount, completionPct, criticalPath },
    "qualitySummary": { checklistProgress, openWarnings },
    "team": [ ... ],
    "permissions": { canEdit, canApprove, ... }
  }
  ```
- Tab-specific data stays lazy: `/api/v2/projects/:id/finance`, `/api/v2/projects/:id/plan`, etc.
- Each returns pre-shaped, pre-aggregated data

**Risk**: Medium | **Pages affected**: `/project/:name` + all tabs

---

### 3.3 Move permission resolution to server responses

**Current**: Frontend evaluates permissions client-side.

**Action**:
- Every API response includes `permissions: { canView, canEdit, canApprove, canDelete }`
- Computed server-side by `permission-middleware.ts` (already exists)
- Frontend `PermissionGate` reads from API response instead of computing
- Deprecate `use-access-matrix.ts` complex client-side evaluation

**Risk**: Low-Medium | **Pages affected**: All pages using PermissionGate

---

### 3.4 Deprecate legacy endpoints

**Action** (after Phase 1 backfill is stable):
- Mark GET `/api/expenses`, `/api/revenues`, `/api/tasks`, `/api/budgets` as deprecated
- Add deprecation header
- Frontend export features switch to normalized tables
- Remove after 1 release cycle

**Risk**: Medium | **Breaking**: For any external API consumers

---

### 3.5 Generate typed API contracts

**Action**:
- Use existing Zod schemas (already in `shared/schema.ts`) to generate response types
- Create `shared/api-types.ts` with request/response interfaces per endpoint
- Frontend imports these types for `useQuery<ResponseType>()`
- Eliminates manual type declarations in `client/src/lib/api.ts`

**Risk**: Low | **Breaking**: No

---

## Phase 4: Frontend Cleanup (Weeks 8-14)

### 4.1 Remove ProgramProvider over-fetching

**Current**: `ProgramProvider` loads all dashboard data at app mount.

**Action**:
- Replace `ProgramProvider` with per-page `useQuery` calls
- Dashboard page fetches its own data
- Other pages don't pay the cost
- Remove `use-program-data.tsx` hook

**Risk**: Medium | **Pages affected**: All (ProgramProvider wraps entire app)

---

### 4.2 Convert direct fetch() to useMutation

**Current**: 484+ raw fetch() calls for mutations.

**Action**:
- Systematically convert each `fetch(url, { method: 'POST|PATCH|DELETE' })` to `useMutation`
- Use `useMutationWithToast` wrapper for consistency
- Ensure proper `queryClient.invalidateQueries()` on success

**Risk**: Low per conversion, high volume | **Approach**: One page at a time

---

### 4.3 Create unified Task interface

**Action**:
- Define `interface UnifiedTask { id, title, status, priority, projectId, assignees, type, ... }`
- Create adapter functions: `fromWorkItem(wi): UnifiedTask`, `fromOperationalTask(ot): UnifiedTask`
- `TaskDetailDrawer` uses `UnifiedTask` instead of conditional type checking
- Tab components receive `UnifiedTask[]`

**Risk**: Medium

---

### 4.4 Remove dead code

**Action**:
- Delete `/my-tool/*` redirect routes
- Delete `components/mytool/` if fully replaced by MyWork equivalents
- Delete `/admin/legacy-utilities` page
- Remove unused imports and components

**Risk**: Low

---

### 4.5 Move business logic out of frontend

**Action**:
- `useEngineeringTaskFilters.ts` — move metric computation to server endpoint; keep filter UI logic
- `project-lifecycle-workspace.ts` — remove; use server lifecycle service
- `access-control.ts` — simplify to read permissions from API response

**Risk**: Low-Medium per item

---

## Phase 5: Data Layer Finalization (Weeks 12-16)

### 5.1 Remove `projectName` text columns (after FK is stable)

**Action**:
- After Phase 1.2 has been stable for 2+ releases
- Remove `projectName` text columns from tables that now have `project_id` FK
- Update all queries to JOIN via FK
- Update all indexes

**Risk**: High | **Mitigation**: Shadow period where both columns exist

---

### 5.2 Drop legacy tables

**Action** (after Phase 3.4 deprecation period):
- Drop `projects`, `expenses`, `revenues`, `tasks`, `budgets`
- Remove `safeLegacyQuery` guard
- Remove `legacy-table-guard.ts`

**Risk**: High | **Mitigation**: Backup tables before drop; verify zero consumers

---

### 5.3 Remove bidirectional task sync

**Action** (after Phase 2.1 consolidation):
- Stop mirroring `work_items` → `operational_tasks`
- `operational_tasks` becomes read-only archive
- Remove `canonical-boundaries.ts` sync functions
- Remove `work-items-adapter.ts` — read directly from `work_items`

**Risk**: High | **Mitigation**: Feature flag; gradual rollout per module

---

## Summary Timeline

```
Phase 1 (Weeks 1-4):  Data foundations — FK additions, schema split, cleanup
Phase 2 (Weeks 3-6):  Task consolidation — work_items as canonical
Phase 3 (Weeks 5-10): API consolidation — V2 migration, typed contracts
Phase 4 (Weeks 8-14): Frontend cleanup — state, dead code, adapters
Phase 5 (Weeks 12-16): Data finalization — drop legacy, remove denormalization
```

Each phase can proceed independently once its prerequisites are met. Phases overlap intentionally — backend and frontend work can be parallelized.
